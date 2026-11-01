import {afterEach, beforeEach, expect, test, vi} from 'vitest'
import type Umbreld from '../../index.js'
import {getLatestRelease, getUpdateStatus, performUpdate} from './update.js'
import * as host from './container-update.js'
vi.mock('./system.js', () => ({detectDevice: async () => ({deviceId: 'unknown'}), isUmbrelOS: async () => true}))
vi.mock('./container-update.js', () => ({
	isContainerUpdateConfigured: vi.fn(),
	getContainerRelease: vi.fn(),
	getContainerStatus: vi.fn(),
	startContainerUpdate: vi.fn(),
}))
vi.mock('execa', () => ({
	$: vi.fn(() => {
		throw new Error('device updater must not run')
	}),
}))
const umbrella = {
	version: '2.0.1',
	store: {get: async () => 'stable'},
	logger: {error: vi.fn(), log: vi.fn()},
} as unknown as Umbreld
beforeEach(() => {
	vi.mocked(host.isContainerUpdateConfigured).mockReturnValue(true)
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({json: async () => ({version: '2.0.9', name: 'Device release', releaseNotes: 'Device'})})),
	)
})
afterEach(() => {
	vi.unstubAllGlobals()
	vi.resetAllMocks()
})
test('configured container uses only host approved release', async () => {
	vi.mocked(host.getContainerRelease).mockResolvedValue({
		available: false,
		version: '2.0.1',
		name: 'Fork',
		releaseNotes: '',
		digest: null,
		upstreamVersion: '2.0.9',
		pendingUpstream: true,
	})
	expect((await getLatestRelease(umbrella)).version).toBe('2.0.1')
	expect(fetch).not.toHaveBeenCalled()
})
test('configured container accepts host job without fetching executable script', async () => {
	vi.mocked(host.startContainerUpdate).mockResolvedValue({jobId: '45cdf188-ea3e-4e6d-a857-a473a271ca76'})
	expect(await performUpdate(umbrella)).toBe(true)
	expect(fetch).not.toHaveBeenCalled()
})
test('missing host never falls back to remote device script', async () => {
	vi.mocked(host.startContainerUpdate).mockRejectedValue(new Error('unavailable'))
	expect(await performUpdate(umbrella)).toBe(false)
	expect(fetch).not.toHaveBeenCalled()
})
test('durable host status is read after reconnect', async () => {
	vi.mocked(host.getContainerStatus).mockResolvedValue({
		running: true,
		progress: 60,
		description: 'Switching',
		error: false,
	})
	expect((await getUpdateStatus()).progress).toBe(60)
})
test('ordinary devices keep the official release query', async () => {
	vi.mocked(host.isContainerUpdateConfigured).mockReturnValue(false)
	expect((await getLatestRelease(umbrella)).version).toBe('2.0.9')
	expect(fetch).toHaveBeenCalledOnce()
})
