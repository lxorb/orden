import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Grant, Scope } from '../../../agent-protocol/src/api'
import { readGrant, readHeard } from './crate'
import { CATEGORY_WORDS } from './words'
import {
  asks,
  ownGrant,
  reaches,
  sidebars,
  sitesOf,
  thirdPartyGrant,
  trifecta,
  withEverySpace,
  withLimit,
  withListed,
  withName,
  withoutAlways,
  withScope,
  withSite,
  withSpace,
} from './grant'

const own = () => ownGrant('claude-code', 'Claude Code', 1)
const only = (...scopes: Scope[]): Grant => ({ ...own(), scopes })
describe('the defaults', () => {
  it('are Emil’s for his own client: everything but scripts, storage and settings', () => {
    const grant = own()
    expect(grant.scopes).toEqual([
      'context',
      'notes.read',
      'notes.write',
      'chats.read',
      'chats.write',
      'tree',
      'workspace',
      'workspace.focus',
      'browser',
      'browser.reader',
      'browser.network',
      'terminal',
      'files',
      'processes',
      'network',
      'clipboard',
      'ask',
      'editor',
      'agents',
    ])
    expect(grant.spaces).toBe('all')
    expect(grant.mode).toBe('unsupervised')
    expect(grant.limits).toEqual({ tabs: 4, calls: 600, navigations: 60, memory: 0 })
    expect(asks(grant, 'paying')).toBe(true)
  })
  it('keep somebody else’s tool off the screen, the reader’s tabs and chats, and asking for every write', () => {
    const grant = thirdPartyGrant('script', 'A script', 1)
    expect(grant.scopes).not.toContain('context')
    expect(grant.scopes).not.toContain('browser.reader')
    expect(grant.scopes).not.toContain('chats.read')
    expect(grant.scopes).not.toContain('chats.write')
    expect(grant.scopes).toContain('notes.read')
    expect(grant.mode).toBe('confirm')
  })
  it('are the crate’s own, as grants.rs writes them', () => {
    const crate = readFileSync(
      fileURLToPath(new URL('../../../../../src-tauri/crates/agents/src/grants.rs', import.meta.url)),
      'utf8',
    )
    expect(crate).toMatch(/Scope::BrowserScript\s*\|\s*Scope::BrowserStorage\s*\|\s*Scope::Settings\s*\)/)
    expect(crate).toMatch(/Scope::Context\s*\|\s*Scope::BrowserReader/)
    expect(crate).toMatch(/tabs: 4,\s*calls: 600,\s*navigations: 60,\s*memory: 0\b/)
  })
})
describe('a switch means what it says', () => {
  it('brings what a scope needs when it is turned on', () => {
    expect(withScope(only(), 'notes.write', true).scopes).toEqual(['notes.read', 'notes.write'])
    expect(withScope(only(), 'workspace.focus', true).scopes).toEqual(['workspace', 'workspace.focus'])
    expect(withScope(only(), 'browser.storage', true).scopes).toEqual(['browser.reader', 'browser.storage'])
    expect(withScope(only(), 'browser.script', true).scopes).toEqual(['browser', 'browser.script'])
    expect(withScope(only('browser.reader'), 'browser.script', true).scopes).toEqual([
      'browser.reader',
      'browser.script',
    ])
  })
  it('takes what needed a scope when it is turned off', () => {
    expect(withScope(only('notes.read', 'notes.write'), 'notes.read', false).scopes).toEqual([])
    expect(withScope(only('browser', 'browser.reader', 'browser.script'), 'browser', false).scopes).toEqual([
      'browser.reader',
      'browser.script',
    ])
    expect(
      withScope(only('browser', 'browser.reader', 'browser.script', 'browser.storage'), 'browser.reader', false).scopes,
    ).toEqual(['browser', 'browser.script'])
    expect(withScope(only('browser', 'browser.network'), 'browser', false).scopes).toEqual([])
  })
  it('keeps the crate’s order, and never a scope twice', () => {
    const grant = withScope(withScope(only('terminal'), 'context', true), 'context', true)
    expect(grant.scopes).toEqual(['context', 'terminal'])
  })
})
describe('the AI sidebar’s own agents', () => {
  it('are told apart by the name the crate gives them, and ask as their thread’s mode says', () => {
    expect(sidebars(ownGrant('orden-anthropic', 'Orden Claude', 1))).toBe(true)
    expect(sidebars(own())).toBe(false)
    expect(sidebars(ownGrant('orden-notes', 'Nib Notes', 1))).toBe(false)
  })
})
describe('the rest of a grant', () => {
  it('names itself, but never with nothing', () => {
    expect(withName(own(), '  Research  ').name).toBe('Research')
    expect(withName(own(), '   ').name).toBe('Claude Code')
  })
  it('holds a limit to what a slider could say', () => {
    expect(withLimit(own(), 'tabs', 12).limits.tabs).toBe(8)
    expect(withLimit(own(), 'calls', 95).limits.calls).toBe(120)
    expect(withLimit(own(), 'navigations', 0).limits.navigations).toBe(10)
    expect(withLimit(own(), 'memory', 5000).limits.memory).toBe(5120)
    expect(withLimit(own(), 'memory', 99999).limits.memory).toBe(32768)
  })
  it('sets no memory ceiling unless the reader does', () => {
    expect(own().limits.memory).toBe(0)
    expect(thirdPartyGrant('script', 'A script', 1).limits.memory).toBe(0)
    const set = withLimit(own(), 'memory', 4096)
    expect(set.limits.memory).toBe(4096)
    expect(withLimit(set, 'memory', 0).limits.memory).toBe(0)
    const before = { tabs: 4, calls: 600, navigations: 60 }
    expect(readGrant({ ...own(), limits: before })?.limits.memory).toBe(0)
    expect(readGrant(set)?.limits.memory).toBe(4096)
    const crate = readFileSync(
      fileURLToPath(new URL('../../../../../src-tauri/crates/agent-web/src/memory.rs', import.meta.url)),
      'utf8',
    )
    expect(crate).not.toMatch(/const CEILING/)
    expect(crate).toMatch(/if ceiling == 0 \{\s*return None;/)
  })
  it('leaves every space for the spaces there are, then one at a time', () => {
    const some = withEverySpace(own(), false, ['Work', 'Home'])
    expect(some.spaces).toEqual(['Work', 'Home'])
    expect(reaches(some, 'Home')).toBe(true)
    const less = withSpace(some, 'Home', false)
    expect(reaches(less, 'Home')).toBe(false)
    expect(withSpace(less, 'Home', true).spaces).toEqual(['Work', 'Home'])
    expect(withSpace(own(), 'Home', false).spaces).toBe('all')
    expect(withEverySpace(less, true, []).spaces).toBe('all')
  })
  it('keeps one rule a site, and lists every site once with its answers', () => {
    const grant = withSite(withSite(own(), 'bank.example', 'deny'), 'bank.example', 'agent-store')
    expect(grant.sites).toEqual({ 'bank.example': 'agent-store' })
    const always = {
      ...grant,
      always: { 'shop.example': ['paying' as const], 'bank.example': ['sending' as const] },
    }
    expect(sitesOf(always)).toEqual([
      { site: 'bank.example', rule: 'agent-store', always: ['sending'] },
      { site: 'shop.example', rule: null, always: ['paying'] },
    ])
    expect(withSite(grant, 'bank.example', null).sites).toEqual({})
  })
  it('takes an "always" back, and the site with its last one', () => {
    const grant = { ...own(), always: { 'shop.example': ['paying' as const, 'sending' as const] } }
    const one = withoutAlways(grant, 'shop.example', 'paying')
    expect(one.always).toEqual({ 'shop.example': ['sending'] })
    expect(withoutAlways(one, 'shop.example', 'sending').always).toEqual({})
  })
  it('adds a word to a list once, and takes it away', () => {
    const grant = withListed(withListed(own(), 'programs', ' git ', true), 'programs', 'git', true)
    expect(grant.programs).toEqual(['git'])
    expect(withListed(grant, 'programs', 'git', false).programs).toEqual([])
    expect(withListed(own(), 'scripts', '   ', true).scripts).toEqual([])
  })
})
describe('the trifecta', () => {
  it('is notes and a browser in the reader’s store, together', () => {
    expect(trifecta(own())).toBe(true)
    expect(trifecta(only('notes.read', 'browser'))).toBe(true)
    expect(trifecta(only('context', 'browser.reader'))).toBe(true)
  })
  it('is not either leg alone', () => {
    expect(trifecta(only('notes.read', 'notes.write', 'tree'))).toBe(false)
    expect(trifecta(only('browser', 'browser.reader'))).toBe(false)
    expect(trifecta(withScope(own(), 'notes.read', false))).toBe(true)
    expect(trifecta(withScope(withScope(own(), 'notes.read', false), 'context', false))).toBe(false)
  })
})
describe('the questions an agent is asked', () => {
  it('names every category the crate asks under, and reads each one back', () => {
    const verbs = readFileSync(
      fileURLToPath(new URL('../../../../../src-tauri/crates/agents/src/verbs.rs', import.meta.url)),
      'utf8',
    )
    const body = /pub enum Category \{([^}]*)\}/.exec(verbs)?.[1] ?? ''
    const crate = [...body.matchAll(/(\w+),/g)].map((one) =>
      (one[1] ?? '').replace(/(?<!^)([A-Z])/g, '_$1').toLowerCase(),
    )
    expect(crate).toContain('tools')
    expect(Object.keys(CATEGORY_WORDS).sort()).toEqual([...crate].sort())
    expect(CATEGORY_WORDS.tools()).toBe('Tools from MCP servers')
    const asks = Object.fromEntries(crate.map((one) => [one, false]))
    const read = readGrant({ ...own(), asks, always: { 'shop.example': crate } })
    expect(read?.asks).toEqual(asks)
    expect(read?.always['shop.example']).toEqual(crate)
  })
})
describe('a grant saved before a scope was taken away', () => {
  it('reads with the scope dropped and the rest kept', () => {
    const before = { ...own(), scopes: ['applications', ...own().scopes, 'someday'] }
    expect(readGrant(before)?.scopes).toEqual(own().scopes)
  })
})
describe('the crate news the settings hear', () => {
  it('names the thread a chat stop ended, and the thread a question was raised in', () => {
    expect(readHeard({ kind: 'ended', thread: 'thread-a' })).toEqual({ kind: 'ended', agent: null, thread: 'thread-a' })
    expect(readHeard({ kind: 'asked', approval: { agent: 'orden-cc', thread: 'thread-b' } })).toEqual({
      kind: 'asked',
      agent: 'orden-cc',
      thread: 'thread-b',
    })
    expect(readHeard({ kind: 'paused', agent: 'orden-cc' })).toEqual({
      kind: 'paused',
      agent: 'orden-cc',
      thread: null,
    })
    expect(readHeard({ kind: 'something new' })).toBeNull()
  })
})
