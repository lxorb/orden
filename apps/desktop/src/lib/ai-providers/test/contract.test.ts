import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, expectTypeOf, test, vi } from 'vitest'
import { ai, complete, firstModel, isLocal, KIND_NAMES, localCli, MODES, modeIn, modeOfGrant } from '../src/api'
import { noMoreThan, offeredKinds, signOut, sseJson, sseLines, talkable, type Thread, vault } from '../src/api'
import { listModels, providerFetch, type Provider, wasStopped } from '../src/api'
import type { Engine, ToolOutput } from '../src/api'

const kept = vi.hoisted(() => {
  const held = new Map<string, string>()
  const storage = {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
    removeItem: (key: string) => void held.delete(key),
  }
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
  return held
})
const road = vi.hoisted(() => ({
  desktop: false,
  asked: [] as { command: string; args: Record<string, unknown> }[],
  answer: (_args: Record<string, unknown>): Promise<unknown> => Promise.resolve(null),
}))
class FakeChannel {
  onmessage: (value: unknown) => void = () => undefined
}
vi.mock('../../crate/src/native', async (original) => ({
  ...(await original<object>()),
  Channel: FakeChannel,
}))
vi.mock('../../platform/src/tauri', async (original) => {
  const real = await original<{ invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> }>()
  return {
    ...real,
    get isDesktop() {
      return road.desktop
    },
    invoke: (command: string, args: Record<string, unknown> = {}) => {
      if (command === 'secret_read') return Promise.resolve(null)
      if (!command.startsWith('ai_fetch')) return real.invoke(command, args)
      road.asked.push({ command, args })
      return command === 'ai_fetch' ? road.answer(args) : Promise.resolve(null)
    },
  }
})

describe('the module stands on its own', () => {
  test('signing in to a local program answers no while no module lends a terminal', async () => {
    const { signIn } = await localCli()
    await expect(signIn('claude-code', '/usr/bin/claude')).resolves.toBe(false)
  })
})
describe('what a mode allows', () => {
  test('a mode asked for is never more than the one held', () => {
    expect(noMoreThan('full', 'auto')).toBeNull()
    expect(noMoreThan('auto', 'approve')).toBeNull()
    expect(noMoreThan('plan', 'approve')).toBeNull()
    expect(noMoreThan('approve', 'auto')).toBe('approve')
    for (const asked of MODES) expect(noMoreThan(asked, 'full')).toBe(asked)
  })
  test('a grant that asks for confirmation acts only on approval', () => {
    expect(modeOfGrant('confirm')).toBe('approve')
    expect(modeOfGrant('unsupervised')).toBe('auto')
    expect(modeOfGrant('autonomous')).toBe('full')
  })
  test('the older words for a mode still read, and nothing else does', () => {
    expect(modeIn('ask')).toBe('approve')
    expect(modeIn('agent')).toBe('full')
    expect(modeIn('everything')).toBeNull()
  })
})
describe('the providers', () => {
  test('every kind has a name, and the local ones are offered only on a desktop', () => {
    for (const kind of offeredKinds(true, true)) expect(KIND_NAMES[kind]).toBeTruthy()
    expect(offeredKinds(false, true).some((kind) => isLocal(kind))).toBe(false)
  })
  test('models that cannot chat are left out, and the newest one is first', () => {
    expect(talkable('openai', ['gpt-4.1', 'whisper-1', 'text-embedding-3-small'])).toEqual(['gpt-4.1'])
    expect(firstModel('anthropic', ['claude-sonnet-4-5', 'claude-sonnet-4'])).toBe('claude-sonnet-4-5')
  })
  test('a stream is read line by line, with a part line kept for the next chunk', () => {
    const first = sseLines('', 'data: {"a":1}\ndata: {"b"')
    expect(first.payloads).toEqual(['{"a":1}'])
    const second = sseLines(first.rest, ':2}\n')
    expect(second.payloads.map((one) => sseJson(one))).toEqual([{ b: 2 }])
    expect(sseJson('[DONE]')).toBeNull()
  })
})
describe('a thread', () => {
  test('may name the only tools it can list and call, and an empty list names none', () => {
    expectTypeOf<Thread['only']>().toEqualTypeOf<string[] | undefined>()
    const none: Pick<Thread, 'only'> = { only: [] }
    expect(none.only).toEqual([])
  })
})
describe('a tool’s output', () => {
  test('may carry the line a reader is asked to approve, apart from what the model is told', () => {
    expectTypeOf<ToolOutput['asks']>().toEqualTypeOf<string | undefined>()
    const asked: ToolOutput = { text: '', images: [], error: false, approval: 'a1', asks: 'Copy a.md to b.md' }
    expect(asked.asks).toBe('Copy a.md to b.md')
  })
})
describe('an engine', () => {
  test('may be told a thread is asked no more, so it can let its session go', () => {
    expectTypeOf<Engine['release']>().toEqualTypeOf<((thread: Thread) => void) | undefined>()
  })
})
describe('an Orden account leaving the device', () => {
  test('takes the AI accounts of its vault and their keys with it, and leaves the ones only ever here', async () => {
    const theirs = ai.add('anthropic')
    const mine = ai.add('openai')
    await ai.written()
    const accounts = { accounts: [theirs], active: {}, defaultVendor: '', uses: {} }
    kept.set('orden:ai-vault-account', 'u1')
    kept.set('orden:ai-vault-base:u1', JSON.stringify({ accounts, keys: {}, seen: {} }))
    vault.seen = { [theirs.id]: 'a@example.com' }
    await signOut()
    await vi.waitFor(() => expect(ai.accounts.map((one) => one.id)).toEqual([mine.id]))
    expect(vault.seen).toEqual({})
    expect(kept.has('orden:ai-vault-base:u1')).toBe(false)
  })
})
describe('a request to a provider', () => {
  const local: Provider = {
    id: 'compatible-1',
    kind: 'compatible',
    name: 'Ollama',
    model: 'llama',
    baseUrl: 'http://localhost:11434/v1',
  }
  const said = (text: string) => ({ data: btoa(text) })
  function answering(status: number, chunks: unknown[], after = true) {
    road.asked.length = 0
    road.answer = (args) => {
      const output = args.output as FakeChannel
      if (!after) for (const one of chunks) output.onmessage(one)
      if (after) setTimeout(() => chunks.forEach((one) => output.onmessage(one)), 0)
      return Promise.resolve({ status, headers: [['content-type', 'text/event-stream']] })
    }
  }
  const fetchAsked = () => road.asked.filter((one) => one.command === 'ai_fetch')
  const headersOf = (index = 0) => new Map(fetchAsked()[index]?.args.headers as [string, string][])
  test('leaves a desktop from the app, not the page, so no server sees the page’s origin, and the answer streams piece by piece in order', async () => {
    road.desktop = true
    const page = vi.spyOn(globalThis, 'fetch')
    const pieces = ['Hel', 'lo', ' there']
    const lines = pieces.map((one) => said(`data: ${JSON.stringify({ choices: [{ delta: { content: one } }] })}\n\n`))
    answering(200, [...lines, { end: true }], false)
    const heard: string[] = []
    await expect(
      complete({
        provider: local,
        model: 'llama',
        messages: [{ role: 'user', content: 'hi' }],
        stream: (one) => heard.push(one),
      }),
    ).resolves.toBe('Hello there')
    expect(heard).toEqual(pieces)
    expect(fetchAsked()[0]?.args).toMatchObject({ url: 'http://localhost:11434/v1/chat/completions', method: 'POST' })
    const id = fetchAsked()[0]?.args.id
    expect(Number.isInteger(id) && (id as number) >= 0 && (id as number) < 2 ** 32).toBe(true)
    expect(headersOf().has('origin')).toBe(false)
    answering(200, [said(JSON.stringify({ data: [{ id: 'llama' }] })), { end: true }])
    await expect(listModels(local)).resolves.toEqual(['llama'])
    expect(fetchAsked()[0]?.args).toMatchObject({ url: 'http://localhost:11434/v1/models', method: 'GET', body: null })
    expect(headersOf().has('origin')).toBe(false)
    expect(page).not.toHaveBeenCalled()
    page.mockRestore()
    road.desktop = false
  })
  test('leaves anywhere else by the page’s own fetch, and never asks the app', async () => {
    road.desktop = false
    road.asked.length = 0
    const page = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'llama' }] }), { status: 200 }))
    await expect(listModels(local)).resolves.toEqual(['llama'])
    expect(page).toHaveBeenCalledOnce()
    expect(road.asked).toEqual([])
    page.mockRestore()
  })
  test('sends a form as multipart, with its boundary named', async () => {
    road.desktop = true
    answering(200, [{ end: true }])
    const form = new FormData()
    form.append('model', 'whisper-1')
    await providerFetch('http://localhost:8000/v1/audio/transcriptions', { method: 'POST', body: form })
    const type = headersOf().get('content-type') ?? ''
    expect(type).toMatch(/^multipart\/form-data; boundary=/)
    const body = atob(String(fetchAsked()[0]?.args.body))
    expect(body).toContain(type.split('boundary=')[1])
    expect(body).toContain('whisper-1')
    road.desktop = false
  })
  test('stopped, says AbortError and stops the app’s request, before the answer starts and in the middle of it', async () => {
    road.desktop = true
    road.asked.length = 0
    road.answer = () => new Promise(() => undefined)
    const before = new AbortController()
    const waiting = providerFetch('http://localhost:11434/v1/models', { signal: before.signal })
    await vi.waitFor(() => expect(fetchAsked()).toHaveLength(1))
    before.abort()
    const early = await waiting.catch((error: unknown) => error)
    expect(wasStopped(early)).toBe(true)
    const id = fetchAsked()[0]?.args.id
    expect(road.asked).toContainEqual({ command: 'ai_fetch_stop', args: { id } })
    answering(200, [said('data: one\n\n')], false)
    const during = new AbortController()
    const response = await providerFetch('http://localhost:11434/v1/chat/completions', {
      method: 'POST',
      body: '{}',
      signal: during.signal,
    })
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: one\n\n')
    during.abort()
    expect(wasStopped(await reader.read().catch((error: unknown) => error))).toBe(true)
    expect(road.asked).toContainEqual({ command: 'ai_fetch_stop', args: { id: fetchAsked()[0]?.args.id } })
    road.desktop = false
  })
  test('that cannot reach the server fails as fetch does, with a TypeError', async () => {
    road.desktop = true
    road.answer = () => Promise.reject(new Error('connection refused'))
    await expect(providerFetch('http://localhost:1/v1/models')).rejects.toBeInstanceOf(TypeError)
    road.desktop = false
  })
  test('is never the page’s own fetch anywhere in the module but the one road', () => {
    const root = join(import.meta.dirname, '../src')
    const files = (readdirSync(root, { recursive: true }) as string[]).filter(
      (one) => /\.(ts|svelte)$/.test(one) && !one.endsWith('.test.ts') && one !== 'fetching.ts',
    )
    const bare = files.filter((one) =>
      /(?<![.\w]|async\s|function\s)fetch\(/.test(readFileSync(join(root, one), 'utf8')),
    )
    expect(bare).toEqual([])
  })
})
