// umbrelOS in a container (the Docker image, see packages/os/overlay-container)
// gets no word of USB drives plugged in after it started: Docker fills the
// container's /dev once at start, and systemd inside keeps no device units, so
// the UnitNew signal the D-Bus listener waits for never comes. A drive plugged
// in later then shows as needing to be formatted, and formatting it fails,
// since /dev/sdX is missing. This poller reads /sys/block instead, creates the
// device files of USB disks and their partitions, removes the ones it made
// when the drive is gone, and reports each change like the listener does.
// lsblk, which external storage reads, takes the file system and label from
// udev's database, so udev inside is asked once to look at each USB device it
// has no entry for, also one whose device file Docker made at start.

import nodePath from 'node:path'

import {$} from 'execa'
import fse from 'fs-extra'

export const CONTAINER_MARKER = '/opt/umbrel-container'
export const POLL_MS = 5000

export type BlockNode = {name: string; major: number; minor: number}

type Options = {
	sysBlock?: string
	dev?: string
	mknod?: (path: string, node: BlockNode) => Promise<void>
	// Major and minor of the block device file at path, or null (tests replace it)
	numbersAt?: (path: string) => Promise<{major: number; minor: number} | null>
	// Has udev probe the new device files, so lsblk knows their file systems
	probe?: (names: string[]) => Promise<void>
	// udev's database, one file per device (b<major>:<minor>)
	udevData?: string
}

const realProbe = async (names: string[]) => {
	for (const name of names) await $({reject: false})`udevadm trigger --action=change --sysname-match=${name}`
	await $({reject: false})`udevadm settle --timeout=10`
}

const realMknod = async (path: string, node: BlockNode) => {
	await $`mknod -m 660 ${path} b ${node.major} ${node.minor}`
	await $({reject: false})`chgrp disk ${path}`
}

// Linux dev_t → major and minor, as in the kernel's new_decode_dev()
export const decodeDevice = (rdev: number) => ({
	major: Math.floor(rdev / 256) % 4096,
	minor: (rdev % 256) + (Math.floor(rdev / 4096) & ~0xff),
})

const realNumbersAt = async (path: string) => {
	const stat = await fse.lstat(path).catch(() => null)
	return stat?.isBlockDevice() ? decodeDevice(stat.rdev) : null
}

async function readNumbers(directory: string) {
	const text = await fse.readFile(nodePath.join(directory, 'dev'), 'utf8').catch(() => '')
	const match = /^(\d+):(\d+)$/.exec(text.trim())
	return match ? {major: Number(match[1]), minor: Number(match[2])} : null
}

// /sys/block → the USB disks and their partitions. Internal disks are left
// alone: Docker gave the container those at start.
export async function usbBlockNodes(sysBlock = '/sys/block'): Promise<BlockNode[]> {
	const nodes: BlockNode[] = []
	const disks = (await fse.readdir(sysBlock).catch(() => [] as string[])).filter((name) => /^sd[a-z]+$/.test(name))
	for (const disk of disks.sort()) {
		const diskDirectory = nodePath.join(sysBlock, disk)
		const device = await fse.realpath(nodePath.join(diskDirectory, 'device')).catch(() => '')
		if (!device.split(nodePath.sep).some((part) => /^usb\d*$/.test(part))) continue
		const partitions = (await fse.readdir(diskDirectory).catch(() => [] as string[]))
			// Only names like sda1: never anything that could point elsewhere in /dev
			.filter((name) => name.startsWith(disk) && /^sd[a-z]+\d+$/.test(name))
			.sort((a, b) => Number(a.slice(disk.length)) - Number(b.slice(disk.length)))
		for (const [name, directory] of [
			[disk, diskDirectory],
			...partitions.map((partition) => [partition, nodePath.join(diskDirectory, partition)]),
		]) {
			const numbers = await readNumbers(directory)
			if (numbers) nodes.push({name, ...numbers})
		}
	}
	return nodes
}

// Makes /dev match: a missing or stale file is (re)created, the files of
// USB drives that are gone are removed. Returns the names it created.
export async function syncDeviceFiles(
	nodes: BlockNode[],
	managed: Set<string>,
	{dev = '/dev', mknod = realMknod, numbersAt = realNumbersAt}: Options = {},
) {
	const created: string[] = []
	const wanted = new Set(nodes.map((node) => node.name))
	for (const name of managed) {
		if (wanted.has(name)) continue
		await fse.remove(nodePath.join(dev, name)).catch(() => {})
		managed.delete(name)
	}
	for (const node of nodes) {
		const path = nodePath.join(dev, node.name)
		const numbers = await numbersAt(path)
		// A USB device's file is ours to remove once the drive is gone, also when
		// Docker made it at start: else external storage takes the drive for still there
		managed.add(node.name)
		// Already right (made by Docker at start, or by us before)
		if (numbers?.major === node.major && numbers.minor === node.minor) continue
		await fse.remove(path).catch(() => {})
		await mknod(path, node)
		managed.add(node.name)
		created.push(node.name)
	}
	return created
}

// Polls every POLL_MS: restores missing device files on every round and calls
// onChange once a drive came or went or a file had to be made. Returns a stop function.
export function watchContainerDisks(
	onChange: () => void,
	{
		interval = POLL_MS,
		log = (_message: string) => {},
		...options
	}: Options & {interval?: number; log?: (message: string) => void} = {},
) {
	const managed = new Set<string>()
	const probed = new Set<string>()
	let last: string | undefined
	let lastError: string | undefined
	let running = false
	const tick = async () => {
		if (running) return
		running = true
		try {
			const nodes = await usbBlockNodes(options.sysBlock)
			const key = JSON.stringify(nodes)
			const created = await syncDeviceFiles(nodes, managed, options)
			// Each device once: new files, and ones udev knows nothing about yet
			const toProbe: string[] = []
			for (const node of nodes) {
				const id = `${node.name}:${node.major}:${node.minor}`
				const known = await fse.pathExists(
					nodePath.join(options.udevData ?? '/run/udev/data', `b${node.major}:${node.minor}`),
				)
				if (created.includes(node.name) || (!known && !probed.has(id))) toProbe.push(node.name)
				probed.add(id)
			}
			for (const id of probed)
				if (!nodes.some((node) => id === `${node.name}:${node.major}:${node.minor}`)) probed.delete(id)
			if (toProbe.length) await (options.probe ?? realProbe)(toProbe)
			if (key !== last || toProbe.length) {
				if (last !== undefined) log(`USB drives now: ${nodes.map((node) => node.name).join(', ') || 'none'}`)
				last = key
				onChange()
			}
			lastError = undefined
		} catch (error) {
			// Once per problem, not every POLL_MS
			const message = `Failed to sync USB device files: ${(error as Error).message}`
			if (message !== lastError) log(message)
			lastError = message
		} finally {
			running = false
		}
	}
	void tick()
	const timer = setInterval(tick, interval)
	timer.unref?.()
	return () => clearInterval(timer)
}
