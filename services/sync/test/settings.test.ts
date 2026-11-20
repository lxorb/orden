import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { call, signIn, testEnv, type TestEnv } from './harness'
import { computer, hubs } from './hub-fakes'

let env: TestEnv
let token: string
beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')
})
afterEach(() => env.close())
function patch(body: unknown, as = token) {
  return call(env, '/v1/settings', { method: 'PATCH', token: as, body })
}
describe('account settings', () => {
  test('start empty', async () => {
    const response = await call(env, '/v1/settings', { token })
    expect(response.status).toBe(200)
    expect(response.json.settings).toEqual({})
  })
  test('keep what is chosen', async () => {
    const set = await patch({ ligatures: true })
    expect(set.status).toBe(200)
    expect(set.json.settings).toEqual({ ligatures: true })
    const read = await call(env, '/v1/settings', { token })
    expect(read.json.settings).toEqual({ ligatures: true })
  })
  test('a change leaves the rest as it was', async () => {
    await patch({ ligatures: true })
    expect((await patch({})).json.settings).toEqual({ ligatures: true })
    expect((await patch({ ligatures: false })).json.settings).toEqual({ ligatures: false })
  })
  test('refuse what the app does not know', async () => {
    expect((await patch({ colour: 'red' })).status).toBe(400)
    expect((await patch({ ligatures: 'yes' })).status).toBe(400)
    expect((await patch([true])).status).toBe(400)
    expect((await call(env, '/v1/settings', { token })).json.settings).toEqual({})
  })
  test('the ligature scope is one of the three the app offers', async () => {
    for (const scope of ['off', 'code', 'all']) {
      const set = await patch({ ligatures: scope })
      expect(set.status, scope).toBe(200)
      expect(set.json.settings.ligatures).toBe(scope)
    }
  })
  test('and a switch from an older build still reads', async () => {
    expect((await patch({ ligatures: true })).json.settings.ligatures).toBe(true)
    expect((await patch({ ligatures: false })).json.settings.ligatures).toBe(false)
  })
  test('but not a scope nobody has heard of', async () => {
    expect((await patch({ ligatures: 'sometimes' })).status).toBe(400)
    expect((await patch({ ligatures: 2 })).status).toBe(400)
  })
  describe('how long a note keeps its earlier versions', () => {
    test('is one of the intervals the app offers', async () => {
      for (const minutes of [0, 1, 5, 15]) {
        const set = await patch({ recoveryEvery: minutes })
        expect(set.status, String(minutes)).toBe(200)
        expect(set.json.settings.recoveryEvery).toBe(minutes)
      }
      for (const days of [1, 7, 30]) {
        const set = await patch({ recoveryDays: days })
        expect(set.status, String(days)).toBe(200)
        expect(set.json.settings.recoveryDays).toBe(days)
      }
    })
    test('and nothing else', async () => {
      expect((await patch({ recoveryEvery: 3 })).status).toBe(400)
      expect((await patch({ recoveryEvery: '5' })).status).toBe(400)
      expect((await patch({ recoveryDays: 0 })).status).toBe(400)
      expect((await patch({ recoveryDays: 365 })).status).toBe(400)
    })
  })
  test('are the account’s alone', async () => {
    const other = await signIn(env, 'c@d.dev')
    await patch({ ligatures: true })
    expect((await call(env, '/v1/settings', { token: other })).json.settings).toEqual({})
    expect((await call(env, '/v1/settings')).status).toBe(401)
  })
})
describe('where a pasted picture goes', () => {
  test('is one of the three folders the app offers', async () => {
    for (const folder of ['space', 'note', 'named']) {
      const set = await patch({ attachments: folder })
      expect(set.status, folder).toBe(200)
      expect(set.json.settings.attachments).toBe(folder)
    }
  })
  test('is nothing else', async () => {
    expect((await patch({ attachments: 'vault' })).status).toBe(400)
    expect((await patch({ attachments: true })).status).toBe(400)
    expect((await patch({ attachments: null })).status).toBe(400)
    expect((await call(env, '/v1/settings', { token })).json.settings).toEqual({})
  })
  test('says which names it takes', async () => {
    expect((await patch({ attachments: 'vault' })).json.error).toContain('space, note, named')
  })
})
describe('the keyboard an account is on', () => {
  test('is one of the ones the app has', async () => {
    for (const preset of ['default', 'notion', 'obsidian', 'vscode', 'vim', 'custom']) {
      const set = await patch({ preset })
      expect(set.status, preset).toBe(200)
      expect(set.json.settings.preset).toBe(preset)
    }
  })
  test('is nothing else', async () => {
    expect((await patch({ preset: 'emacs' })).status).toBe(400)
    expect((await patch({ preset: '' })).status).toBe(400)
    expect((await patch({ preset: 7 })).status).toBe(400)
    expect((await patch({ preset: null })).status).toBe(400)
    expect((await patch({ preset: ['vim'] })).status).toBe(400)
  })
  test('says which names it takes', async () => {
    expect((await patch({ preset: 'emacs' })).json.error).toContain('default, notion, obsidian')
  })
  test('travels beside the map it names', async () => {
    await patch({ preset: 'custom', shortcuts: { 'format.bold': 'Mod-Alt-b' } })
    const read = await call(env, '/v1/settings', { token })
    expect(read.json.settings).toEqual({
      preset: 'custom',
      shortcuts: { 'format.bold': 'Mod-Alt-b' },
    })
  })
})
describe('the formatting marks kept quiet on an account', () => {
  test('is on or off', async () => {
    expect((await patch({ quietMarks: true })).json.settings.quietMarks).toBe(true)
    expect((await patch({ quietMarks: false })).json.settings.quietMarks).toBe(false)
  })
  test('is nothing else', async () => {
    expect((await patch({ quietMarks: 'yes' })).status).toBe(400)
  })
})
describe('Silent mode on an account', () => {
  test('is on or off', async () => {
    expect((await patch({ silent: true })).json.settings.silent).toBe(true)
    expect((await patch({ silent: false })).json.settings.silent).toBe(false)
  })
  test('is nothing else', async () => {
    expect((await patch({ silent: 1 })).status).toBe(400)
  })
})
describe('the spaces an account put away', () => {
  test('are a list of space ids', async () => {
    const kept = await patch({ archivedSpaces: ['a1B2-c3', 'x_9'] })
    expect(kept.json.settings.archivedSpaces).toEqual(['a1B2-c3', 'x_9'])
    expect((await patch({ archivedSpaces: [] })).json.settings.archivedSpaces).toEqual([])
  })
  test('and nothing else', async () => {
    expect((await patch({ archivedSpaces: 'a1' })).status).toBe(400)
    expect((await patch({ archivedSpaces: ['a/b'] })).status).toBe(400)
    expect((await patch({ archivedSpaces: ['a1', 'a1'] })).status).toBe(400)
    expect((await patch({ archivedSpaces: Array.from({ length: 101 }, (_, at) => `s${at}`) })).status).toBe(400)
  })
})
describe('turning a canvas with two fingers, on an account (#351)', () => {
  test('is on or off', async () => {
    expect((await patch({ canvasTurns: true })).json.settings.canvasTurns).toBe(true)
    expect((await patch({ canvasTurns: false })).json.settings.canvasTurns).toBe(false)
  })
  test('is nothing else', async () => {
    const refused = await patch({ canvasTurns: 'yes' })
    expect(refused.status).toBe(400)
    expect(refused.json.error).toBe('canvasTurns must be true or false')
  })
  test('and its snap to right angles is on or off (#487)', async () => {
    expect((await patch({ canvasTurnSnaps: false })).json.settings.canvasTurnSnaps).toBe(false)
    expect((await patch({ canvasTurnSnaps: 'no' })).status).toBe(400)
  })
})
describe('modal editing on an account', () => {
  test('is on or off', async () => {
    expect((await patch({ vim: true })).json.settings.vim).toBe(true)
    expect((await patch({ vim: false })).json.settings.vim).toBe(false)
  })
  test('is nothing else', async () => {
    expect((await patch({ vim: 'yes' })).status).toBe(400)
    expect((await patch({ vim: 1 })).status).toBe(400)
    expect((await patch({ vim: null })).status).toBe(400)
  })
  test('sits beside the keyboard rather than inside it', async () => {
    await patch({ preset: 'obsidian' })
    await patch({ vim: true })
    const read = await call(env, '/v1/settings', { token })
    expect(read.json.settings).toEqual({ preset: 'obsidian', vim: true })
  })
})
describe('what an account lets ping about its chats', () => {
  test('keeps keywords, hours, previews and sound', async () => {
    const hours = { days: [1, 2, 3, 4, 5], from: 540, to: 1080 }
    const set = await patch({
      chatKeywords: ['thesis', 'final draft'],
      chatHours: hours,
      chatPreviews: false,
      chatSound: true,
    })
    expect(set.status).toBe(200)
    expect(set.json.settings).toEqual({
      chatKeywords: ['thesis', 'final draft'],
      chatHours: hours,
      chatPreviews: false,
      chatSound: true,
    })
    const cleared = await patch({ chatHours: null })
    expect(cleared.json.settings.chatHours).toBeNull()
  })
  test('refuses what the decision could not read', async () => {
    expect((await patch({ chatKeywords: 'thesis' })).status).toBe(400)
    expect((await patch({ chatKeywords: [''] })).status).toBe(400)
    expect((await patch({ chatKeywords: ['x'.repeat(61)] })).status).toBe(400)
    expect((await patch({ chatHours: { days: [8], from: 0, to: 60 } })).status).toBe(400)
    expect((await patch({ chatHours: { days: [1], from: 0, to: 1440 } })).status).toBe(400)
    expect((await patch({ chatPreviews: 'no' })).status).toBe(400)
    expect((await call(env, '/v1/settings', { token })).json.settings).toEqual({})
  })
})
describe('the glasses settings an older app still sends', () => {
  const OLD = {
    glassesBreak: 2,
    glassesLineNumbers: false,
    glassesPageNumber: true,
    glassesVoice: true,
    glassesCompaction: 'collapse',
    glassesScroll: 'paged',
    glassesMarks: { bold: true },
    glassesWords: { next: 'vorwärts' },
    glassesSeen: true,
    glassesModel: 'gpt-6-astra',
    glassesEffort: 'high',
  }
  test('are let go of quietly, so the rest of the same write still lands', async () => {
    const set = await patch({ ...OLD, vim: true })
    expect(set.status).toBe(200)
    expect(set.json.settings.vim).toBe(true)
    for (const name of Object.keys(OLD)) expect(set.json.settings, name).not.toHaveProperty(name)
  })
  test('are let go of even when what was sent is not what the glasses took', async () => {
    expect((await patch({ glassesBreak: 7, glassesWords: { next: 12 } })).status).toBe(200)
  })
  test('are left where an older version stored them, and no longer read', async () => {
    env.db.prepare('update users set settings = ?').run(JSON.stringify({ glassesModel: 'gpt-6-astra', vim: true }))
    expect((await call(env, '/v1/settings', { token })).json.settings).toEqual({ vim: true })
    await patch({ vim: false })
    const held = env.db.prepare('select settings from users').get() as { settings: string }
    expect(JSON.parse(held.settings)).toEqual({ glassesModel: 'gpt-6-astra', vim: false })
  })
  test('leave remembering that a phone or a tablet has been used', async () => {
    expect((await patch({ mobileSeen: true })).status).toBe(200)
    expect((await call(env, '/v1/settings', { token })).json.settings.mobileSeen).toBe(true)
    expect((await patch({ mobileSeen: 'yes' })).status).toBe(400)
  })
  test('never carried the key, and the settings say only whether there is one', async () => {
    expect((await patch({ glassesKey: 'sk-proj-AbC123-_xyz' })).status).toBe(400)
    const read = await call(env, '/v1/settings', { token })
    expect(read.json.settings.glassesKey).toBeUndefined()
    expect(read.json.key).toEqual({ set: false, tail: '' })
  })
})
describe('a name that is not a setting', () => {
  test('is refused even when Object has one of its own', async () => {
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      const response = await call(env, '/v1/settings', {
        method: 'PATCH',
        token,
        raw: JSON.stringify({ [name]: true }),
        headers: { 'content-type': 'application/json' },
      })
      expect(response.status, name).toBe(400)
      expect(response.json.error, name).toContain('unknown setting')
    }
  })
  test('says back as much of it as is worth saying and no more', async () => {
    const long = `weather${'A'.repeat(5000)}`
    const response = await call(env, '/v1/settings', {
      method: 'PATCH',
      token,
      raw: JSON.stringify({ [long]: true }),
      headers: { 'content-type': 'application/json' },
    })
    expect(response.status).toBe(400)
    expect(response.json.error).toContain('unknown setting weather')
    expect(response.json.error.length).toBeLessThanOrEqual('unknown setting '.length + 64)
  })
  test('leaves the settings as they were', async () => {
    await patch({ ligatures: true })
    await call(env, '/v1/settings', {
      method: 'PATCH',
      token,
      raw: '{"__proto__":{"ligatures":false}}',
      headers: { 'content-type': 'application/json' },
    })
    expect((await call(env, '/v1/settings', { token })).json.settings).toEqual({ ligatures: true })
  })
})
describe('the kinds an account turned off', () => {
  test('are kept as a list of words', async () => {
    const set = await patch({ hiddenKinds: ['canvas', 'online'] })
    expect(set.status).toBe(200)
    expect((await call(env, '/v1/settings', { token })).json.settings.hiddenKinds).toEqual(['canvas', 'online'])
  })
  test('take null, which is every kind offered', async () => {
    expect((await patch({ hiddenKinds: null })).status).toBe(200)
    expect((await call(env, '/v1/settings', { token })).json.settings.hiddenKinds).toBeNull()
  })
  test('keep a kind this version has never heard of', async () => {
    expect((await patch({ hiddenKinds: ['something-new'] })).status).toBe(200)
  })
  test('refuse what is not a list of kinds', async () => {
    expect((await patch({ hiddenKinds: 'canvas' })).status).toBe(400)
    expect((await patch({ hiddenKinds: ['Canvas'] })).status).toBe(400)
    expect((await patch({ hiddenKinds: ['canvas', 'canvas'] })).status).toBe(400)
    expect((await patch({ hiddenKinds: [1] })).status).toBe(400)
    const letter = (at: number) => String.fromCharCode(97 + at)
    const many = Array.from({ length: 33 }, (_, at) => `k${letter(at % 26)}${letter(at >> 4)}`)
    expect((await patch({ hiddenKinds: many })).status).toBe(400)
  })
})
describe('the phone bar an account carries', () => {
  test('keeps the commands on it, in order', async () => {
    const set = await patch({ toolbar: ['format.bold', 'paragraph.quote'] })
    expect(set.status).toBe(200)
    expect(set.json.settings.toolbar).toEqual(['format.bold', 'paragraph.quote'])
    const read = await call(env, '/v1/settings', { token })
    expect(read.json.settings.toolbar).toEqual(['format.bold', 'paragraph.quote'])
  })
  test('takes null, which is the default bar', async () => {
    expect((await patch({ toolbar: null })).status).toBe(200)
    expect((await call(env, '/v1/settings', { token })).json.settings.toolbar).toBeNull()
  })
  test('takes a bar with nothing on it', async () => {
    expect((await patch({ toolbar: [] })).status).toBe(200)
  })
  test('keeps a command this version has never heard of', async () => {
    expect((await patch({ toolbar: ['something.new'] })).status).toBe(200)
  })
  test('refuses what is not a command id', async () => {
    expect((await patch({ toolbar: ['Format Bold'] })).status).toBe(400)
    expect((await patch({ toolbar: ['../etc'] })).status).toBe(400)
    expect((await patch({ toolbar: [7] })).status).toBe(400)
    expect((await patch({ toolbar: 'format.bold' })).status).toBe(400)
  })
  test('refuses the same command twice', async () => {
    expect((await patch({ toolbar: ['format.bold', 'format.bold'] })).status).toBe(400)
  })
  test('refuses more than a bar holds', async () => {
    const many = Array.from({ length: 25 }, (_unused, index) => `app.thing-${index}`)
    expect((await patch({ toolbar: many })).status).toBe(400)
  })
})
describe('the shortcuts an account carries', () => {
  test('keep a map of keys', async () => {
    const set = await patch({ shortcuts: { 'format.bold': 'Mod-Alt-b', 'app.save': 'F2' } })
    expect(set.status).toBe(200)
    expect(set.json.settings.shortcuts).toEqual({ 'format.bold': 'Mod-Alt-b', 'app.save': 'F2' })
    const read = await call(env, '/v1/settings', { token })
    expect(read.json.settings.shortcuts).toEqual({ 'format.bold': 'Mod-Alt-b', 'app.save': 'F2' })
  })
  test('take a key that was taken away', async () => {
    const set = await patch({ shortcuts: { 'format.bold': null } })
    expect(set.status).toBe(200)
    expect(set.json.settings.shortcuts).toEqual({ 'format.bold': null })
  })
  test('take the awkward combinations the app really writes', async () => {
    const keys = {
      'paragraph.heading-down': 'Mod--',
      'paragraph.ordered-list': 'Mod-Shift-[',
      'format.clear': 'Mod-\\',
      'format.code': 'Mod-Shift-`',
      'app.zoom-in': 'Mod-Shift-=',
      'table.below': 'ArrowDown',
      'edit.redo.alt': 'Ctrl-Shift-z',
    }
    expect((await patch({ shortcuts: keys })).status).toBe(200)
  })
  test('keep an id this version has never heard of', async () => {
    expect((await patch({ shortcuts: { 'something.new': 'Mod-9' } })).status).toBe(200)
  })
  test('refuse an id that is not one', async () => {
    expect((await patch({ shortcuts: { 'Format Bold': 'Mod-b' } })).status).toBe(400)
    expect((await patch({ shortcuts: { '../etc': 'Mod-b' } })).status).toBe(400)
    expect((await patch({ shortcuts: { ['a'.repeat(65)]: 'Mod-b' } })).status).toBe(400)
  })
  test('refuse a value that is not a key', async () => {
    expect((await patch({ shortcuts: { 'format.bold': 'Hyper-b' } })).status).toBe(400)
    expect((await patch({ shortcuts: { 'format.bold': 'Mod b' } })).status).toBe(400)
    expect((await patch({ shortcuts: { 'format.bold': '' } })).status).toBe(400)
    expect((await patch({ shortcuts: { 'format.bold': 7 } })).status).toBe(400)
    expect((await patch({ shortcuts: { 'format.bold': { key: 'Mod-b' } } })).status).toBe(400)
  })
  test('refuse anything but a map', async () => {
    expect((await patch({ shortcuts: [] })).status).toBe(400)
    expect((await patch({ shortcuts: 'Mod-b' })).status).toBe(400)
    expect((await patch({ shortcuts: null })).status).toBe(400)
  })
  test('refuse more than an account holds', async () => {
    const many = Object.fromEntries(Array.from({ length: 201 }, (_, index) => [`app.thing-${index}`, 'Mod-b']))
    expect((await patch({ shortcuts: many })).status).toBe(400)
  })
  test('refuse a body too big for the column', async () => {
    const big = Object.fromEntries(
      Array.from({ length: 199 }, (_, index) => [`app.${'thing'.repeat(10)}-${index}`, 'Mod-Alt-Shift-ArrowDown']),
    )
    expect((await patch({ shortcuts: big })).status).toBe(413)
  })
  test('leave nothing behind when they are refused', async () => {
    await patch({ shortcuts: { 'format.bold': 'Mod-Alt-b' } })
    await patch({ shortcuts: { 'format.bold': 'nonsense key' } })
    const read = await call(env, '/v1/settings', { token })
    expect(read.json.settings.shortcuts).toEqual({ 'format.bold': 'Mod-Alt-b' })
  })
  test('sit beside the other settings rather than replacing them', async () => {
    await patch({ ligatures: true })
    await patch({ shortcuts: { 'app.save': 'F2' } })
    const read = await call(env, '/v1/settings', { token })
    expect(read.json.settings).toEqual({ ligatures: true, shortcuts: { 'app.save': 'F2' } })
  })
})
describe('the theme kept with the account', () => {
  const LOOK = {
    theme: 'file:rose',
    scheme: 'dark',
    values: { '*': { accent: 'teal' }, 'file:rose': { dim: 20 } },
    css: '[data-theme=dark] { --bg: #000; }',
  }
  test('is kept and read back as it was sent', async () => {
    expect((await patch({ look: LOOK })).status).toBe(200)
    expect((await call(env, '/v1/settings', { token })).json.settings).toEqual({ look: LOOK })
  })
  test('refuses one the app could not wear', async () => {
    expect((await patch({ look: { ...LOOK, scheme: 'sepia' } })).status).toBe(400)
    expect((await patch({ look: { ...LOOK, theme: 'file:../x' } })).status).toBe(400)
    expect((await patch({ look: 'dark' })).status).toBe(400)
    expect((await call(env, '/v1/settings', { token })).json.settings).toEqual({})
  })
  test('takes a sheet larger than the room the other settings share', async () => {
    const css = `:root { --bg: #000; }${' '.repeat(20 * 1024)}`
    expect((await patch({ look: { ...LOOK, css } })).status).toBe(200)
    expect((await patch({ ligatures: true })).status).toBe(200)
  })
  test('leaves an older build that knows nothing of it working', async () => {
    await patch({ look: LOOK })
    expect((await patch({ vim: true })).json.settings).toEqual({ look: LOOK, vim: true })
  })
  test('tells every device of the account that the settings moved', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const running = hubs(env)
      env.HUB = running.HUB
      const laptop = await computer(env, running, 'owner@example.com', 'Laptop')
      const phone = await computer(env, running, 'owner@example.com', 'Phone')
      const stranger = await computer(env, running, 'stranger@example.com', 'Stranger')
      const sent = await patch({ look: LOOK }, laptop.token)
      expect(sent.status).toBe(200)
      expect(phone.socket.take()).toEqual([{ t: 'settings' }])
      expect(laptop.socket.take()).toEqual([{ t: 'settings' }])
      expect(stranger.socket.take()).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})
describe('a setting the app no longer has', () => {
  const RETIRED: Record<string, unknown> = {
    spellWords: ['orden', 'tauri'],
    pull: 'app.palette',
    undatedInToday: false,
  }
  test('is taken from an older build and kept nowhere', async () => {
    for (const [name, value] of Object.entries(RETIRED)) {
      const set = await patch({ [name]: value, ligatures: true })
      expect(set.status, name).toBe(200)
      expect(set.json.settings, name).toEqual({ ligatures: true })
    }
    expect((await call(env, '/v1/settings', { token })).json.settings).toEqual({ ligatures: true })
  })
  test('is taken whatever shape it has', async () => {
    for (const name of Object.keys(RETIRED)) {
      expect((await patch({ [name]: { not: 'what it was' } })).status, name).toBe(200)
    }
  })
  test('is not handed back where an account stored it before', async () => {
    env.db.exec(`update users set settings = '${JSON.stringify({ ...RETIRED, vim: true })}'`)
    expect((await call(env, '/v1/settings', { token })).json.settings).toEqual({ vim: true })
  })
})
