/** Builds the extension, twice, and packs the result.
 *
 *  Twice because Chrome runs the two halves differently: the pages and the
 *  service worker are ES modules and may share chunks, while a content script
 *  is a classic script in the page and has to be one self-contained file. Vite
 *  cannot emit both from one pass, so `vite.config.ts` does the first and
 *  `vite.content.config.ts` the second, into the same folder.
 *
 *  What comes out is `dist/`, which is what "Load unpacked" wants, and
 *  `nib-clipper.zip` beside it, which is what the Chrome Web Store wants.
 *  The zip is written here rather than shelled out to a platform's own archiver
 *  so that the same command works wherever it is run, and so the archive has no
 *  timestamps in it and is the same bytes for the same sources. */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'
import { build } from 'vite'

const here = resolve(import.meta.dirname, '..')
const dist = join(here, 'dist')
const archive = join(here, 'nib-clipper.zip')

/** 1980-01-01 in the two packed words MS-DOS used, which is what a zip carries
 *  when it is meant to say nothing about when it was made. */
const DOS_TIME = 0
const DOS_DATE = 33

/** Deflate, the one method every unpacker has understood for thirty years. */
const DEFLATED = 8

/**
 * @typedef {{ name: string; bytes: Buffer }} Found
 * @typedef {Found & { crc: number; packed: Buffer; offset: number }} Entry
 */

/**
 * @param {string} folder
 * @param {string} prefix
 * @returns {Promise<Found[]>}
 */
async function filesUnder(folder, prefix = '') {
  /** @type {Found[]} */
  const found = []

  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) found.push(...(await filesUnder(join(folder, entry.name), name)))
    else found.push({ name, bytes: await readFile(join(folder, entry.name)) })
  }

  return found.sort((one, other) => (one.name < other.name ? -1 : 1))
}

/**
 * @param {Entry} entry
 * @param {number} offset
 */
function localHeader(entry, offset) {
  const head = Buffer.alloc(30)
  head.writeUInt32LE(0x04034b50, 0)
  head.writeUInt16LE(20, 4)
  head.writeUInt16LE(0, 6)
  head.writeUInt16LE(DEFLATED, 8)
  head.writeUInt16LE(DOS_TIME, 10)
  head.writeUInt16LE(DOS_DATE, 12)
  head.writeUInt32LE(entry.crc, 14)
  head.writeUInt32LE(entry.packed.length, 18)
  head.writeUInt32LE(entry.bytes.length, 22)
  head.writeUInt16LE(entry.name.length, 26)
  head.writeUInt16LE(0, 28)

  entry.offset = offset
  return Buffer.concat([head, Buffer.from(entry.name, 'utf8'), entry.packed])
}

/** @param {Entry} entry */
function centralEntry(entry) {
  const head = Buffer.alloc(46)
  head.writeUInt32LE(0x02014b50, 0)
  head.writeUInt16LE(20, 4)
  head.writeUInt16LE(20, 6)
  head.writeUInt16LE(0, 8)
  head.writeUInt16LE(DEFLATED, 10)
  head.writeUInt16LE(DOS_TIME, 12)
  head.writeUInt16LE(DOS_DATE, 14)
  head.writeUInt32LE(entry.crc, 16)
  head.writeUInt32LE(entry.packed.length, 20)
  head.writeUInt32LE(entry.bytes.length, 24)
  head.writeUInt16LE(entry.name.length, 28)
  head.writeUInt32LE(entry.offset, 42)

  return Buffer.concat([head, Buffer.from(entry.name, 'utf8')])
}

/**
 * @param {number} count
 * @param {number} size
 * @param {number} offset
 */
function endOfCentral(count, size, offset) {
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(count, 8)
  end.writeUInt16LE(count, 10)
  end.writeUInt32LE(size, 12)
  end.writeUInt32LE(offset, 16)

  return end
}

/** @param {string} folder */
async function zipOf(folder) {
  /** @type {Entry[]} */
  const entries = (await filesUnder(folder)).map((file) => ({
    ...file,
    crc: crc32(file.bytes),
    packed: deflateRawSync(file.bytes, { level: 9 }),
    offset: 0,
  }))

  /** @type {Buffer[]} */
  const parts = []
  let offset = 0

  for (const entry of entries) {
    const part = localHeader(entry, offset)
    parts.push(part)
    offset += part.length
  }

  const central = entries.map(centralEntry)
  const size = central.reduce((total, part) => total + part.length, 0)

  return Buffer.concat([...parts, ...central, endOfCentral(entries.length, size, offset)])
}

await build({ root: here, configFile: join(here, 'vite.config.ts') })
await build({ root: here, configFile: join(here, 'vite.content.config.ts') })
await writeFile(archive, await zipOf(dist))

// A build script's output is the point of running it; the rule against writing
// to the console is about the extension, which has a person in front of it.
process.stdout.write(`\n  unpacked  ${dist}\n  store     ${archive}\n\n`)
