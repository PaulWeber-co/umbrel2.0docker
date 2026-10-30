import os from 'node:os'
import nodePath from 'node:path'

import fse from 'fs-extra'
import {afterEach, beforeEach, expect, test} from 'vitest'

import {type BlockNode, decodeDevice, syncDeviceFiles, usbBlockNodes, watchContainerDisks} from './container-disks.js'

let root: string
let sysBlock: string
let dev: string

// A block device in /sys/block: its device link points into the USB tree or not
async function addDisk(name: string, numbers: string, {usb = true, partitions = [] as [string, string][]} = {}) {
	const target = nodePath.join(
		root,
		'devices',
		usb ? 'pci0000:00/usb2/2-2/2-2:1.0/host8' : 'pci0000:00/ata1/host0',
		name,
	)
	await fse.ensureDir(target)
	await fse.ensureDir(nodePath.join(sysBlock, name))
	await fse.symlink(target, nodePath.join(sysBlock, name, 'device'))
	await fse.writeFile(nodePath.join(sysBlock, name, 'dev'), `${numbers}\n`)
	for (const [partition, partitionNumbers] of partitions) {
		await fse.outputFile(nodePath.join(sysBlock, name, partition, 'dev'), `${partitionNumbers}\n`)
	}
}

// Stand-ins for mknod and stat: "device files" are text files holding major:minor
const fakeMknod = async (path: string, node: BlockNode) => fse.writeFile(path, `${node.major}:${node.minor}`)
const fakeNumbersAt = async (path: string) => {
	const text = await fse.readFile(path, 'utf8').catch(() => '')
	const [major, minor] = text.split(':').map(Number)
	return text ? {major, minor} : null
}
let probed: string[][] = []
const options = () => ({
	dev,
	mknod: fakeMknod,
	numbersAt: fakeNumbersAt,
	probe: async (names: string[]) => void probed.push(names),
})

beforeEach(async () => {
	probed = []
	root = await fse.mkdtemp(nodePath.join(os.tmpdir(), 'umbrel-container-disks-'))
	sysBlock = nodePath.join(root, 'sys', 'block')
	dev = nodePath.join(root, 'dev')
	await fse.ensureDir(sysBlock)
	await fse.ensureDir(dev)
	await fse.ensureDir(nodePath.join(sysBlock, 'nvme0n1'))
	await fse.writeFile(nodePath.join(sysBlock, 'nvme0n1', 'dev'), '259:0\n')
})

afterEach(async () => {
	await fse.remove(root)
})

test('finds USB disks and their partitions, not internal ones', async () => {
	await addDisk('sda', '8:0', {
		partitions: [
			['sda2', '8:2'],
			['sda1', '8:1'],
			['sda10', '8:10'],
			['sda1x', '8:3'],
		],
	})
	await addDisk('sdb', '8:16', {usb: false, partitions: [['sdb1', '8:17']]})
	expect(await usbBlockNodes(sysBlock)).toEqual([
		{name: 'sda', major: 8, minor: 0},
		{name: 'sda1', major: 8, minor: 1},
		{name: 'sda2', major: 8, minor: 2},
		{name: 'sda10', major: 8, minor: 10},
	])
})

test('creates missing device files, leaves right ones, removes its own when the drive is gone', async () => {
	await addDisk('sda', '8:0', {partitions: [['sda1', '8:1']]})
	// Docker made /dev/sdz at start (an internal disk): never ours to remove
	await fse.writeFile(nodePath.join(dev, 'sdz'), '8:200')
	const managed = new Set<string>()

	expect(await syncDeviceFiles(await usbBlockNodes(sysBlock), managed, options())).toEqual(['sda', 'sda1'])
	expect(await fse.readFile(nodePath.join(dev, 'sda1'), 'utf8')).toBe('8:1')
	expect([...managed].sort()).toEqual(['sda', 'sda1'])
	expect(
		await syncDeviceFiles(await usbBlockNodes(sysBlock), managed, options()),
		'nothing new the second time',
	).toEqual([])

	// A stale file with other numbers (a different drive got the name) is replaced
	await fse.writeFile(nodePath.join(dev, 'sda1'), '8:99')
	await syncDeviceFiles(await usbBlockNodes(sysBlock), managed, options())
	expect(await fse.readFile(nodePath.join(dev, 'sda1'), 'utf8')).toBe('8:1')

	// Unplugged
	await fse.remove(nodePath.join(sysBlock, 'sda'))
	await syncDeviceFiles(await usbBlockNodes(sysBlock), managed, options())
	expect(await fse.pathExists(nodePath.join(dev, 'sda'))).toBe(false)
	expect(await fse.pathExists(nodePath.join(dev, 'sda1'))).toBe(false)
	expect(await fse.pathExists(nodePath.join(dev, 'sdz'))).toBe(true)
	expect(managed.size).toBe(0)
})

test('reports a change once when a drive comes and once when it goes', async () => {
	let changes = 0
	const stop = watchContainerDisks(() => changes++, {sysBlock, ...options(), interval: 20})
	await new Promise((resolve) => setTimeout(resolve, 60))
	expect(changes).toBe(1) // the first look at start
	await addDisk('sda', '8:0', {partitions: [['sda1', '8:1']]})
	await new Promise((resolve) => setTimeout(resolve, 80))
	expect(changes).toBe(2)
	expect(await fse.pathExists(nodePath.join(dev, 'sda1'))).toBe(true)
	expect(probed, 'udev looks at the new device files').toEqual([['sda', 'sda1']])
	// A device file that went missing is made again on the next round
	await fse.remove(nodePath.join(dev, 'sda1'))
	await new Promise((resolve) => setTimeout(resolve, 80))
	expect(await fse.pathExists(nodePath.join(dev, 'sda1'))).toBe(true)
	expect(changes).toBe(3)
	expect(probed.at(-1)).toEqual(['sda1'])
	await fse.remove(nodePath.join(sysBlock, 'sda'))
	await new Promise((resolve) => setTimeout(resolve, 80))
	expect(changes).toBe(4)
	stop()
})

test('decodes Linux device numbers', () => {
	expect(decodeDevice(8 * 256 + 1)).toEqual({major: 8, minor: 1})
	expect(decodeDevice(259 * 256)).toEqual({major: 259, minor: 0})
	// Minors above 255 sit higher up in dev_t
	expect(decodeDevice((300 & 0xff) + 8 * 256 + ((300 & ~0xff) << 12))).toEqual({major: 8, minor: 300})
})

test('a lasting failure is logged once', async () => {
	await addDisk('sda', '8:0')
	const logged: string[] = []
	const failing = async () => {
		throw new Error('Operation not permitted')
	}
	const stop = watchContainerDisks(() => {}, {
		sysBlock,
		...options(),
		mknod: failing,
		interval: 10,
		log: (m) => logged.push(m),
	})
	await new Promise((resolve) => setTimeout(resolve, 80))
	stop()
	expect(logged).toEqual(['Failed to sync USB device files: Operation not permitted'])
})
