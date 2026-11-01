import http from 'node:http'
import {z} from 'zod'
import type {ProgressStatus} from '../apps/schema.js'

const version = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
const image = z.string().regex(/^ghcr\.io\/paulweber-co\/xps-homeserver-umbrelos@sha256:[a-f0-9]{64}$/)
const releaseSchema = z.object({
	available: z.boolean(), version, name: z.string(), releaseNotes: z.string(),
	digest: image.nullable(), upstreamVersion: version, pendingUpstream: z.boolean(),
}).strict().refine((r) => !r.available || r.digest !== null)
const statusSchema = z.object({
	jobId: z.string().uuid().nullable(), version: version.nullable(), digest: image.nullable(),
	phase: z.enum(['idle', 'preflight', 'backup', 'pull', 'switch', 'verify', 'rollback', 'finished']),
	progress: z.number().min(0).max(100), error: z.union([z.literal(false), z.string()]),
	outcome: z.enum(['succeeded', 'rolled-back', 'failed', 'interrupted']).nullable(),
}).strict()
export type ContainerRelease = z.infer<typeof releaseSchema>

export function isContainerUpdateConfigured() {
	return Boolean(process.env.XPS_UMBREL_UPDATER_SOCKET)
}

function request(endpoint: string, method = 'GET'): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const socketPath = process.env.XPS_UMBREL_UPDATER_SOCKET
		if (!socketPath?.startsWith('/')) return reject(new Error('XPS update service unavailable'))
		const fail = () => reject(new Error('XPS update service unavailable'))
		const req = http.request({socketPath, path: endpoint, method, headers: method === 'POST' ? {'Content-Type': 'application/json', 'Content-Length': 2} : {}}, (res) => {
			const chunks: Buffer[] = []; let bytes = 0
			res.on('data', (chunk: Buffer) => {
				bytes += chunk.length
				if (bytes > 1024 * 1024) {res.destroy(); fail(); return}
				chunks.push(chunk)
			})
			res.on('error', fail)
			res.on('end', () => {
				if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) return fail()
				try {resolve(JSON.parse(Buffer.concat(chunks).toString()))} catch {fail()}
			})
		})
		const timer = setTimeout(() => {req.destroy(); fail()}, 10_000)
		req.on('close', () => clearTimeout(timer)); req.on('error', fail)
		req.end(method === 'POST' ? '{}' : undefined)
	})
}

export async function getContainerRelease() {
	return releaseSchema.parse(await request('/v1/release'))
}

export async function startContainerUpdate() {
	return z.object({jobId: z.string().uuid()}).strict().parse(await request('/v1/update', 'POST'))
}

export async function getContainerStatus(): Promise<ProgressStatus> {
	try {
		const status = statusSchema.parse(await request('/v1/status'))
		const failed = status.outcome !== null && status.outcome !== 'succeeded'
		return {
			running: status.phase !== 'idle' && status.phase !== 'finished',
			progress: status.outcome === 'succeeded' ? 100 : status.progress,
			description: status.phase === 'idle' ? '' : `Container update: ${status.phase}`,
			error: status.error || (failed ? 'Container update did not complete; previous state requires review' : false),
		}
	} catch {
		return {running: false, progress: 0, description: '', error: 'XPS update service unavailable'}
	}
}
