#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'

const API = (process.env.ORDEN_API || process.env.NIB_API || 'https://orden.so').replace(/\/$/, '')
const TOKEN = process.env.ORDEN_TOKEN ?? process.env.NIB_TOKEN ?? ''

const AT_ONCE = 6

const TRIES = 6

const LINKED = /\/i\/([a-f0-9]{64})(\.[a-z0-9]{1,8})?/gi

function say(words) {
  process.stdout.write(`${words}\n`)
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function get(path, { auth = true, bytes = false } = {}) {
  for (let attempt = 1; ; attempt++) {
    let response
    try {
      response = await fetch(`${API}${path}`, {
        headers: auth ? { authorization: `Bearer ${TOKEN}`, 'x-nib-device': 'backup' } : {},
      })
    } catch (error) {
      if (attempt >= TRIES) throw new Error(`GET ${path}: ${error.message}`, { cause: error })
      await pause(500 * 2 ** attempt)
      continue
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt >= TRIES) throw new Error(`GET ${path}: ${response.status}`)
      const after = Number(response.headers.get('retry-after'))
      await pause(Number.isFinite(after) && after > 0 ? after * 1000 : 500 * 2 ** attempt)
      continue
    }

    if (bytes) {
      if (!response.ok) return { status: response.status, body: null }
      return { status: response.status, body: Buffer.from(await response.arrayBuffer()) }
    }

    const text = await response.text()
    let body
    try {
      body = text ? JSON.parse(text) : {}
    } catch {
      body = { error: text.slice(0, 200) }
    }
    return { status: response.status, body }
  }
}

async function need(path) {
  const { status, body } = await get(path)
  if (status !== 200) throw new Error(`GET ${path}: ${body.error ?? status}`)
  return body
}

async function pool(items, work) {
  let next = 0
  const lanes = Array.from({ length: Math.min(AT_ONCE, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      await work(item)
    }
  })
  await Promise.all(lanes)
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i
const FORBIDDEN = '<>:"\\|?*'

function safeName(name) {
  let out = Array.from(name.normalize('NFC'), (char) =>
    char < ' ' || FORBIDDEN.includes(char) ? '_' : char,
  ).join('')
  if (RESERVED.test(out)) out = `_${out}`
  out = out.replace(/[. ]+$/, (tail) => '_'.repeat(tail.length))
  return out || '_'
}

function namer() {
  const taken = new Set()
  return (path, id) => {
    const safe = path.split('/').map(safeName).join('/')
    let local = safe
    if (taken.has(local.toLowerCase())) {
      const ext = extname(safe)
      local = `${safe.slice(0, safe.length - ext.length)} ~${id.slice(0, 8)}${ext}`
    }
    taken.add(local.toLowerCase())
    return local
  }
}

async function put(root, local, data) {
  const where = join(root, ...local.split('/'))
  if (existsSync(where)) {
    const held = await readFile(where)
    if (held.equals(Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'))) return
  }
  await mkdir(dirname(where), { recursive: true })
  await writeFile(where, data)
}

async function earlier(root) {
  try {
    const index = JSON.parse(await readFile(join(root, 'index.json'), 'utf8'))
    const notes = new Map()
    for (const space of index.spaces ?? [])
      for (const note of space.notes ?? []) notes.set(note.id, note)
    return notes
  } catch {
    return new Map()
  }
}

async function feedOf(space) {
  const notes = new Map()
  let cursor = 0
  for (;;) {
    const page = await need(`/v1/spaces/${encodeURIComponent(space.id)}/changes?since=${cursor}`)
    for (const note of page.notes) notes.set(note.id, note)
    if (!page.more || page.cursor === cursor) break
    cursor = page.cursor
  }
  return [...notes.values()]
}

async function backup(root, { history }) {
  const before = await earlier(root)
  const problems = []
  const blobs = new Map()
  const counts = { notes: 0, deleted: 0, versions: 0, fetched: 0 }

  const listing = await need('/v1/spaces')

  const trash = await get('/v1/trash')
  const deletedSpaces = trash.status === 200 ? (trash.body.spaces ?? []) : null

  const folders = namer()
  const spaces = []
  for (const space of listing.spaces) {
    const folder = folders(space.name.replaceAll('/', '_'), space.id)
    const live = namer()
    const gone = namer()
    const notes = []

    const rows = (await feedOf(space))
      .sort((one, two) => (one.path + one.id < two.path + two.id ? -1 : 1))
      .map((row) => ({
        row,
        local: row.deleted
          ? `deleted/${folder}/${gone(row.path, row.id)}`
          : `spaces/${folder}/${live(row.path, row.id)}`,
      }))

    await pool(rows, async ({ row, local }) => {
      const kept = before.get(row.id)
      const entry = {
        id: row.id,
        path: row.path,
        version: row.version,
        hash: row.hash,
        size: row.size,
        updatedAt: row.updatedAt,
        deleted: row.deleted,
        file: local,
        versions: [],
      }

      const same =
        kept && kept.version === row.version && kept.hash === row.hash && kept.file === local
      let content = null
      if (same && existsSync(join(root, ...local.split('/')))) {
        content = await readFile(join(root, ...local.split('/')), 'utf8')
      } else {
        const { status, body } = await get(`/v1/notes/${encodeURIComponent(row.id)}`)
        if (status !== 200) {
          problems.push(`${space.name}/${row.path}: ${body.error ?? status}`)
          entry.file = null
        } else {
          content = body.content ?? ''
          counts.fetched++
        }
      }

      if (content !== null) {
        if (sha256(content) !== row.hash) {
          if (row.deleted && content === '') entry.purged = true
          else
            problems.push(
              `${space.name}/${row.path}: words do not match the hash the account lists`,
            )
        }
        if (!entry.purged) await put(root, local, content)
        else entry.file = null
        linkedIn(content, blobs)
      }

      if (history) await versionsOf(root, entry, kept, problems, counts, blobs)
      if (row.deleted) counts.deleted++
      else counts.notes++
      notes.push(entry)
    })

    notes.sort((one, two) => (one.path < two.path ? -1 : one.path > two.path ? 1 : 0))
    spaces.push({ id: space.id, name: space.name, role: space.role, folder, notes })
  }

  const linked = []
  await pool([...blobs], async ([hash, ext]) => {
    const local = `blobs/${hash}${ext}`
    if (existsSync(join(root, ...local.split('/')))) {
      linked.push({ hash, file: local })
      return
    }
    const { status, body } = await get(`/i/${hash}${ext}`, { auth: false, bytes: true })
    if (status !== 200 || !body) {
      linked.push({ hash, file: null, status })
      return
    }
    if (sha256(body) !== hash) problems.push(`/i/${hash}: bytes do not match their hash`)
    await put(root, local, body)
    linked.push({ hash, file: local })
  })

  const index = {
    at: new Date().toISOString(),
    api: API,
    history,
    spaces,
    deletedSpaces:
      deletedSpaces ?? 'not listed: a program token cannot read Recently deleted spaces',
    blobs: linked.sort((one, two) => (one.hash < two.hash ? -1 : 1)),
    problems,
  }
  await put(root, 'index.json', `${JSON.stringify(index, null, 2)}\n`)
  await sums(root, index)

  const unserved = linked.filter((one) => !one.file).length
  say(
    `${spaces.length} spaces, ${counts.notes} notes, ${counts.deleted} in Recently deleted, ` +
      `${counts.versions} versions, ${linked.length - unserved} files` +
      `${unserved ? ` (${unserved} linked but not served)` : ''} ` +
      `(${counts.fetched} notes fetched) into ${root}`,
  )
  for (const problem of problems) say(`  ! ${problem}`)
  if (problems.length) process.exitCode = 2
}

function linkedIn(text, blobs) {
  for (const match of text.matchAll(LINKED))
    blobs.set(match[1].toLowerCase(), (match[2] ?? '').toLowerCase())
}

async function versionsOf(root, entry, kept, problems, counts, blobs) {
  const { status, body } = await get(`/v1/notes/${encodeURIComponent(entry.id)}/versions`)
  if (status !== 200) {
    problems.push(`${entry.path}: versions: ${body.error ?? status}`)
    return
  }
  const known = new Map((kept?.versions ?? []).map((one) => [one.at, one]))

  for (const version of body.versions ?? []) {
    const had = known.get(version.at)
    const file = had?.hash ? join(root, 'versions', `${had.hash}.txt`) : null
    if (file && existsSync(file)) {
      linkedIn(await readFile(file, 'utf8'), blobs)
      entry.versions.push(had)
      counts.versions++
      continue
    }
    const words = await get(`/v1/notes/${encodeURIComponent(entry.id)}/versions/${version.at}`)
    if (words.status !== 200) {
      problems.push(`${entry.path}: version ${version.at}: ${words.body.error ?? words.status}`)
      continue
    }
    const content = words.body.content ?? ''
    const hash = sha256(content)
    await put(root, `versions/${hash}.txt`, content)
    linkedIn(content, blobs)
    entry.versions.push({ at: version.at, by: version.by, size: version.size, hash })
    counts.versions++
  }
}

async function sums(root, index) {
  const files = new Set(['index.json'])
  for (const space of index.spaces) {
    for (const note of space.notes) {
      if (note.file) files.add(note.file)
      for (const version of note.versions) files.add(`versions/${version.hash}.txt`)
    }
  }
  for (const blob of index.blobs) if (blob.file) files.add(blob.file)

  const lines = []
  for (const file of [...files].sort()) {
    lines.push(`${sha256(await readFile(join(root, ...file.split('/'))))}  ${file}`)
  }
  await put(root, 'SHA256SUMS', `${lines.join('\n')}\n`)
}

async function main() {
  const args = process.argv.slice(2)
  const root = args.find((one) => !one.startsWith('--'))
  if (!TOKEN) throw new Error('ORDEN_TOKEN is not set')
  if (!root) throw new Error('usage: account-backup.mjs <folder> [--no-history]')

  await mkdir(root, { recursive: true })
  await backup(root, { history: !args.includes('--no-history') })
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
