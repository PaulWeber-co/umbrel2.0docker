// Host health for the XPS dashboard. These values come from the Linux host,
// not from the Umbrel container, so the widget remains useful while Umbrel is
// updating or unavailable.
import * as os from 'node:os';
import { readdir, readFile, statfs } from 'node:fs/promises';
import { join } from 'node:path';

const GIB = 1024 ** 3;
const THERMAL_DIR = '/sys/class/thermal';

function cpuTimes() {
  const cpus = os.cpus();
  if (!cpus.length) return null;
  return cpus.reduce(
    (total, cpu) => {
      const times = cpu.times;
      total.idle += times.idle;
      total.total += Object.values(times).reduce((sum, value) => sum + value, 0);
      return total;
    },
    { idle: 0, total: 0 },
  );
}

export async function readCpuPercent(sampleMs = 200) {
  const before = cpuTimes();
  if (!before) return null;
  await new Promise((resolve) => setTimeout(resolve, sampleMs));
  const after = cpuTimes();
  if (!after) return null;
  const total = after.total - before.total;
  if (total <= 0) return null;
  const idle = after.idle - before.idle;
  return Math.round(Math.max(0, Math.min(100, ((total - idle) / total) * 100)));
}

export function parseMeminfo(text) {
  const kib = (name) => {
    const match = text.match(new RegExp(`^${name}:\\s+(\\d+)\\s+kB$`, 'm'));
    return match ? Number(match[1]) * 1024 : null;
  };
  const totalBytes = kib('MemTotal');
  const availableBytes = kib('MemAvailable') ?? kib('MemFree');
  if (!(totalBytes > 0) || availableBytes === null) return null;
  return { totalBytes, availableBytes };
}

async function readMemory() {
  try {
    const memory = parseMeminfo(await readFile('/proc/meminfo', 'utf8'));
    if (memory) return memory;
  } catch {
    // On non-Linux development machines, use the portable Node.js values.
  }
  return { totalBytes: os.totalmem(), availableBytes: os.freemem() };
}

async function readStorage() {
  try {
    const filesystem = await statfs('/');
    const totalBytes = filesystem.blocks * filesystem.bsize;
    const availableBytes = filesystem.bavail * filesystem.bsize;
    return totalBytes > 0 ? { totalBytes, availableBytes } : null;
  } catch {
    return null;
  }
}

async function readTemperature() {
  if (process.platform !== 'linux') return null;
  let zones;
  try {
    zones = (await readdir(THERMAL_DIR)).filter((name) => /^thermal_zone\d+$/.test(name));
  } catch {
    return null;
  }

  const temperatures = await Promise.all(
    zones.map(async (zone) => {
      try {
        const milliCelsius = Number(await readFile(join(THERMAL_DIR, zone, 'temp'), 'utf8'));
        const celsius = milliCelsius / 1000;
        return Number.isFinite(celsius) && celsius >= -20 && celsius <= 150 ? celsius : null;
      } catch {
        return null;
      }
    }),
  );
  const available = temperatures.filter((value) => value !== null);
  return available.length ? Math.round(Math.max(...available) * 10) / 10 : null;
}

function usage(totalBytes, availableBytes) {
  if (!(totalBytes > 0) || !Number.isFinite(availableBytes)) return null;
  const usedBytes = Math.max(0, Math.min(totalBytes, totalBytes - availableBytes));
  return {
    usedGiB: Math.round((usedBytes / GIB) * 10) / 10,
    totalGiB: Math.round((totalBytes / GIB) * 10) / 10,
    percent: Math.round((usedBytes / totalBytes) * 100),
  };
}

export function toWidgetData({ cpuPercent, memory, storage, temperatureC, uptimeSeconds }) {
  return {
    cpuPercent: Number.isFinite(cpuPercent) ? Math.round(Math.max(0, Math.min(100, cpuPercent))) : null,
    memory: usage(memory?.totalBytes, memory?.availableBytes),
    storage: usage(storage?.totalBytes, storage?.availableBytes),
    temperatureC: Number.isFinite(temperatureC) ? Math.round(temperatureC) : null,
    uptimeSeconds: Number.isFinite(uptimeSeconds) ? Math.max(0, Math.round(uptimeSeconds)) : 0,
  };
}

export default {
  id: 'server',
  intervalMs: 10_000,

  async fetch() {
    const [cpuPercent, memory, storage, temperatureC] = await Promise.all([
      readCpuPercent(),
      readMemory(),
      readStorage(),
      readTemperature(),
    ]);
    return toWidgetData({ cpuPercent, memory, storage, temperatureC, uptimeSeconds: os.uptime() });
  },

  demo: () => ({
    cpuPercent: 18,
    memory: { usedGiB: 7.5, totalGiB: 16, percent: 47 },
    storage: { usedGiB: 128.4, totalGiB: 476, percent: 27 },
    temperatureC: 52,
    uptimeSeconds: 2 * 86_400 + 5 * 3_600 + 18 * 60,
  }),
};
