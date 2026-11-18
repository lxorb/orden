import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  AGENT_COMMANDS,
  AGENT_EVENT,
  AGENT_WINDOW_VERBS,
  BROWSER_VERBS,
  CAPTURE_AS,
  type Captured,
  CRATE_ASKS,
} from './verbs'

function crate(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../../src-tauri/crates/agents/src/${name}`, import.meta.url)),
    'utf8',
  )
}

describe('the mirror of the crate agent verbs', () => {
  it('names every verb of the crate table, in its order', () => {
    const table = crate('verbs.rs').split('verbs! {')[1] ?? ''
    const named = [...table.matchAll(/^\s*"([a-z_]+)" =>/gm)].map((one) => one[1])

    expect(named).toEqual([...BROWSER_VERBS])
  })

  it('names the window verbs an agent may call, with the scopes the crate checks', () => {
    const table = crate('verbs.rs').split('AGENT_VERBS')[1]?.split('];')[0] ?? ''
    const rows = [...table.matchAll(/\("([a-z_]+)", (None|Some\(Scope::(\w+)\))\)/g)].map(
      (one) => [one[1], one[3] ?? null] as const,
    )
    const scopes = crate('grants.rs')
    const scopeOf = (variant: string | null) =>
      variant === null
        ? null
        : new RegExp(`rename = "([a-z.]+)"\\)\\]\\s*${variant},`).exec(scopes)?.[1]

    expect(Object.fromEntries(rows.map(([verb, variant]) => [verb, scopeOf(variant)]))).toEqual(
      AGENT_WINDOW_VERBS,
    )
  })

  it('hears on the event the crate emits on', () => {
    expect(crate('verbs.rs')).toContain(`pub const EVENT: &str = "${AGENT_EVENT}";`)
  })

  it('names the commands the crate registers for the window', () => {
    const registered = readFileSync(
      fileURLToPath(new URL('../../../../src-tauri/src/lib.rs', import.meta.url)),
      'utf8',
    )
    const named = [...registered.matchAll(/agents?(?:_web)?::(?:[a-z]+::)?(agents_[a-z_]+),/g)].map(
      (one) => one[1],
    )
    expect(named).toEqual([...AGENT_COMMANDS])
  })

  it('reads a capture as the crate answers it', () => {
    const shapes = crate('verbs.rs').split('pub enum CaptureAs {')[1]?.split('}')[0] ?? ''
    const named = [...shapes.matchAll(/^\s*([A-Z]\w*),$/gm)].map((one) => one[1]?.toLowerCase())
    expect(named).toEqual([...CAPTURE_AS])

    const fields = crate('verbs.rs').split('pub struct Captured {')[1]?.split('\n}')[0] ?? ''
    const written = [...fields.matchAll(/^\s*pub (\w+):/gm)].map((one) => one[1])
    const read: Required<Captured> = { url: '', title: '', html: '', png: '', pdf: '' }
    expect(written).toEqual(Object.keys(read))
  })

  it('names the window verbs the crate asks as the crate does', () => {
    const source = crate('verbs.rs')
    for (const verb of Object.values(CRATE_ASKS)) {
      expect(source).toContain(`&str = "${verb}";`)
    }
  })
})
