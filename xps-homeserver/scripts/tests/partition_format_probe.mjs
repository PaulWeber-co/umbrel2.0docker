import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createExternalPartitionTable} from '/opt/umbreld/source/modules/files/external-storage.ts'
const root=await fs.mkdtemp(path.join(os.tmpdir(),'xps-gpt-format-'))
try {
 for (const [filesystem,expected] of [['exfat','a2a0d0ebe5b9334487c068b6b72699c7'],['ext4','af3dc60f838472478e793d69d8477de4']]) {
  const image=path.join(root,filesystem+'.img')
  const file=await fs.open(image,'w');await file.truncate(64*1024*1024);await file.close()
  await createExternalPartitionTable(image,filesystem)
  const reader=await fs.open(image,'r');const header=Buffer.alloc(512);await reader.read(header,0,512,512)
  assert.equal(header.subarray(0,8).toString(),'EFI PART')
  const partition=Buffer.alloc(128);
  await reader.read(partition,0,128,Number(header.readBigUInt64LE(72))*512)
  assert.equal(partition.subarray(0,16).toString('hex'),expected)
  assert(partition.readBigUInt64LE(40)>partition.readBigUInt64LE(32))
  await reader.close()
 }
 console.log('PASS: real formatter creates Microsoft Basic Data for exFAT and Linux type for ext4')
} finally {await fs.rm(root,{recursive:true,force:true})}
