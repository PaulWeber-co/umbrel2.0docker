import {afterEach, expect, test, vi} from 'vitest'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {getContainerRelease, getContainerStatus, startContainerUpdate, isContainerUpdateConfigured} from './container-update.js'

let server: http.Server | undefined
let directory: string | undefined
afterEach(async () => {
	vi.unstubAllEnvs()
	if (server) await new Promise<void>((resolve) => server!.close(() => resolve()))
	if (directory) await fs.rm(directory, {recursive: true, force: true})
	server = undefined
})
async function serve(body: unknown, status = 200) {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xps-api-'))
	const socket = path.join(directory, 's')
	server = http.createServer((_req, res) => {res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(body))})
	await new Promise<void>((resolve) => server!.listen(socket, resolve))
	vi.stubEnv('XPS_UMBREL_UPDATER_SOCKET', socket)
}
test('does not auto-detect a socket without explicit configuration', () => {
	vi.stubEnv('XPS_UMBREL_UPDATER_SOCKET', '')
	expect(isContainerUpdateConfigured()).toBe(false)
})
test('returns only a well formed approved release', async () => {
	await serve({available: true, version: '2.0.1', name: 'umbrelOS 2.0.1', releaseNotes: 'Fixes', digest: 'ghcr.io/paulweber-co/xps-homeserver-umbrelos@sha256:'+'a'.repeat(64), upstreamVersion: '2.0.1', pendingUpstream: false})
	expect((await getContainerRelease()).available).toBe(true)
})
test('accepted job is distinct from completed installation', async () => {
	await serve({jobId: '45cdf188-ea3e-4e6d-a857-a473a271ca76'}, 202)
	expect((await startContainerUpdate()).jobId).toBe('45cdf188-ea3e-4e6d-a857-a473a271ca76')
})
test('rollback remains a visible failure after reconnect', async () => {
	await serve({jobId: '45cdf188-ea3e-4e6d-a857-a473a271ca76', version: '2.0.1', digest: null, phase: 'finished', progress: 85, outcome: 'rolled-back', error: 'Previous version restored'})
	const status = await getContainerStatus()
	expect(status.running).toBe(false); expect(status.error).toBe('Previous version restored'); expect(status.progress).not.toBe(100)
})
test('missing service fails closed', async () => {
	vi.stubEnv('XPS_UMBREL_UPDATER_SOCKET', '/nonexistent/xps.sock')
	await expect(getContainerRelease()).rejects.toThrow('XPS update service unavailable')
})
test('malformed release is not installable', async () => {
	await serve({available: true, version: '9.0.0', digest: 'attacker:latest'})
	await expect(getContainerRelease()).rejects.toThrow()
})
