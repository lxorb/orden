import { afterEach, beforeEach, expect } from 'vitest'
import app from '../src'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { type Live, live } from './sync2'

export interface Core {
  spaces: Map<string, { outbox: unknown[]; entries: Map<string, { name: string }> }>
  held: Map<string, unknown>
  addSpace(id: string, root: string, role: string): unknown[]
  commit(changes: unknown[]): Promise<void>
}
export interface Device {
  root: string
  store: { rows(table: 'log'): { failed: string | null }[]; open(): unknown }
  disk: {
    bytes: Map<string, Uint8Array>
    files: Map<string, string>
    kept: unknown[]
    read(path: string): Promise<string | null>
    exists(path: string): Promise<boolean>
    readBytes(path: string): Promise<Uint8Array | null>
    writeBytes(path: string, bytes: Uint8Array): Promise<void>
    write(path: string, text: string): Promise<void>
    remove(path: string): Promise<void>
    mkdir(path: string): Promise<void>
    move(from: string, to: string): Promise<void>
  }
  engine: {
    core: Core & { world: unknown }
    pass(space: string): Promise<{ finished: boolean; full: boolean; pulled: number } | null>
    quit(): Promise<void>
    created(path: string, dir: boolean, text?: string): Promise<string | null>
    foreign(path: string): Promise<void>
    removed(path: string): Promise<void>
    moved(from: string, to: string): Promise<void>
    waiting(space: string): boolean
    stamped(path: string, mtime: number, size: number): Promise<void>
    stop(): void
    on(type: 'unsynced', listener: (event: { name: string }) => void): () => void
    held: {
      notes: readonly { id: string }[]
      answer(id: string, answer: string): Promise<string | undefined>
    }
  }
}
export interface Kit {
  testDevice(making: {
    fetch: (request: Request) => Promise<Response>
    token: string
    name?: string
    files?: Record<string, string | Uint8Array>
  }): Promise<Device>
  firstPass(core: Core, space: unknown, v1: unknown): Promise<boolean>
  mirrorsFrom(core: Core, listings: null): Promise<Record<string, { notes: Record<string, unknown> }>>
  Engine: { start(world: unknown, store: unknown): Promise<Device['engine']> }
}
export async function kit(): Promise<Kit> {
  const at = (file: string) => new URL(`../../../apps/desktop/src/lib/sync-client/${file}`, import.meta.url).href
  const [device, migrate, engine] = await Promise.all([
    import(/* @vite-ignore */ at('test/test-device.ts')),
    import(/* @vite-ignore */ at('src/migrate.ts')),
    import(/* @vite-ignore */ at('src/engine.ts')),
  ])
  return { ...(device as object), ...(migrate as object), ...(engine as object) } as Kit
}
export function engineSpace() {
  const at = {} as { env: TestEnv; rooms: Live; token: string; space: string }
  beforeEach(async () => {
    at.env = testEnv()
    at.rooms = live(at.env)
    at.token = await signIn(at.env, 'pictures@example.com')
    at.space = (await call(at.env, '/v1/spaces', { token: at.token, body: { name: 'Pictures' } })).json.space.id
  })
  afterEach(() => at.env.close())
  async function device(
    name: string,
    files: Record<string, string | Uint8Array> = {},
    as = { token: at.token, role: 'owner' },
  ): Promise<Device> {
    const made = await (
      await kit()
    ).testDevice({
      fetch: async (request) => await app.fetch(request, at.env),
      token: as.token,
      name,
      files,
    })
    const core = made.engine.core
    await core.commit(core.addSpace(at.space, made.root, as.role))
    expect(await (await kit()).firstPass(core, core.spaces.get(at.space), null)).toBe(true)
    await at.rooms.settle()
    return made
  }
  async function passed(...devices: Device[]) {
    for (let round = 0; round < 2; round += 1) {
      for (const one of devices) {
        await one.engine.pass(at.space)
        await at.rooms.settle()
      }
    }
  }
  return { at, device, passed }
}
