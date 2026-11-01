// Used only in a disposable container. No real accounts or Apple credentials.
import assert from 'node:assert/strict'
import {createTRPCProxyClient, httpBatchLink} from '@trpc/client'
let token = ''
let cookies = ''
const browserFetch = async (url, init = {}) => {
	const headers = new Headers(init.headers)
	if (cookies) headers.set('cookie', cookies)
	const response = await fetch(url, {...init, headers})
	const set = response.headers.getSetCookie()
	if (set.length) cookies = set.map((c) => c.split(';')[0]).join('; ')
	return response
}
const api = createTRPCProxyClient({links: [httpBatchLink({
	url: 'http://localhost/trpc', fetch: browserFetch,
	headers: () => token ? {Authorization: `Bearer ${token}`} : {},
})]})
const password = 'xps-disposable-validation-only'
if (!(await api.user.exists.query())) await api.user.register.mutate({name: 'XPS Test', password})
token = await api.user.login.mutate({password})
assert.equal(typeof token, 'string')
const providers = await api.files.cloud.providers.query()
assert(providers.some((p) => p.id === 'icloud'))
const settings = await api.mcp.getSettings.query()
const credentials = settings.enabled
	? await api.mcp.createToken.mutate({label: 'Disposable validation'})
	: await api.mcp.enable.mutate({label: 'Disposable validation'})
assert(credentials?.token)
let mcpSession
const mcp = async (body) => {
	const response = await fetch('http://localhost/mcp', {method:'POST',
		headers: {Authorization:`Bearer ${credentials.token}`, 'Content-Type':'application/json', Accept:'application/json, text/event-stream', ...(mcpSession ? {'Mcp-Session-Id':mcpSession} : {})},
		body: JSON.stringify(body), signal: AbortSignal.timeout(20_000)})
	assert(response.ok)
	mcpSession = response.headers.get('mcp-session-id') ?? mcpSession
	if (response.status === 202) return null
	if (response.headers.get('content-type')?.includes('application/json')) return response.json()
	const reader = response.body.getReader(); let text = ''
	try {
		while (true) {
			const chunk = await reader.read()
			if (chunk.done) throw new Error('Missing MCP reply')
			text += new TextDecoder().decode(chunk.value)
			const match = text.match(/^data: ([^\r\n]+)\r?\n/m)
			if (match) return JSON.parse(match[1])
		}
	} finally {await reader.cancel()}
}
const hello = await mcp({jsonrpc:'2.0', id:1, method:'initialize', params:{protocolVersion:'2024-11-05', capabilities:{}, clientInfo:{name:'XPS isolated test',version:'1'}}})
assert.equal(hello.result.serverInfo.version, process.env.EXPECTED_VERSION)
await mcp({jsonrpc:'2.0',method:'notifications/initialized'})
const info = await mcp({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'get_system_info',arguments:{}}})
assert(!info.error && !info.result.isError)
console.log('PASS: owner login, iCloud provider and authenticated read-only MCP')
