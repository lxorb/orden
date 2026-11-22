import { beforeEach, describe, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'

vi.stubGlobal('localStorage', memoryStorage())
const calls: { command: string; args: Record<string, unknown> }[] = []
let took = 0
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    if (command === 'take_keyboard') took += 1
    else calls.push({ command, args })
    return Promise.resolve(undefined)
  },
}))
const { DIVIDER } = await import('../../ui-kit/src/api')
const { asked, menuRows, readDialog, readMenu, readPermission, readSelect } = await import('./asked.svelte')
const { grants, siteOf } = await import('./permissions.svelte')
beforeEach(() => {
  calls.length = 0
})
describe('a page’s context menu', () => {
  const said = {
    tab: 't',
    id: 7,
    x: 10,
    y: 20,
    zoom: 1.2,
    link: 'https://example.com/next',
    image: 'https://example.com/a.png',
    media: 'image',
    selection: '',
    editable: false,
    keys: true,
    misspelled: null,
    suggestions: [],
    items: [
      { command: 98, label: 'Open link in new tab', kind: 'command', enabled: true, checked: false, does: 'open-link' },
      {
        command: 99,
        label: 'Open image in new tab',
        kind: 'command',
        enabled: true,
        checked: false,
        does: 'open-image',
      },
      { command: 100, label: 'Copy image', kind: 'command', enabled: true, checked: false },
      { command: -1, label: '', kind: 'separator', enabled: true, checked: false },
      { command: 101, label: 'Spell check', kind: 'check', enabled: false, checked: true },
      {
        command: 102,
        label: 'Writing direction',
        kind: 'submenu',
        enabled: true,
        checked: false,
        items: [{ command: 103, label: 'Left to right', kind: 'radio', enabled: true, checked: true }],
      },
    ],
  }
  test('is read whole, and nothing that is not one', () => {
    expect(readMenu(said)?.items.map((one) => one.kind)).toEqual([
      'command',
      'command',
      'command',
      'separator',
      'check',
      'submenu',
    ])
    expect(readMenu(said)?.items.map((one) => one.does)).toEqual(['open-link', 'open-image', null, null, null, null])
    expect([readMenu(said)?.keys, readMenu({ ...said, keys: undefined })?.keys]).toEqual([true, false])
    expect(readMenu({ ...said, id: 'x' })).toBeNull()
    expect(readMenu({ ...said, items: [{ command: 1, kind: 'dance' }] })?.items).toEqual([])
  })
  test('shows its rows as Orden’s in Chromium’s order: a new tab opens in Orden, any other row picks its command', async () => {
    const menu = readMenu(said)
    if (!menu) throw new Error('no menu')
    const picked: number[] = []
    const opened: string[] = []
    const rows = menuRows(menu, (one) => picked.push(one), { open: (url) => opened.push(url) })
    expect(rows.map((one) => (one === DIVIDER ? '-' : one.label))).toEqual([
      'Open link in new tab',
      'Open image in new tab',
      'Copy image',
      '-',
      'Spell check',
      'Writing direction',
    ])
    const [link, image, copy, , check, sub] = rows
    if (!link || !image || !copy || !check || !sub) throw new Error('rows missing')
    link.run()
    image.run()
    copy.run()
    expect([opened, picked]).toEqual([['https://example.com/next', 'https://example.com/a.png'], [100]])
    expect([check.disabled, check.checked]).toEqual([true, true])
    const inner = await sub.more?.()
    expect(inner?.map((one) => (one === DIVIDER ? '-' : [one.label, one.checked]))).toEqual([['Left to right', true]])
  })
  test('a new-tab row with nothing to open stays off', () => {
    const menu = readMenu({ ...said, link: null, image: null })
    if (!menu) throw new Error('no menu')
    const rows = menuRows(menu, () => undefined, { open: () => undefined })
    expect(rows.slice(0, 2).map((one) => one !== DIVIDER && one.disabled)).toEqual([true, true])
  })
  test('with no page placed to show it over is dismissed at once', async () => {
    const menu = readMenu({ ...said, tab: 'nowhere' })
    if (!menu) throw new Error('no menu')
    await asked.showMenu(menu)
    expect(calls).toEqual([{ command: 'web_menu_pick', args: { tab: 'nowhere', id: 7, command: null } }])
  })
})
describe('a page’s alert, confirm and prompt', () => {
  const base = { tab: 't', id: 3, message: 'Sure?', default: null, origin: 'https://example.com', reload: false }
  test('waits in its tab and is answered once', () => {
    const confirm = readDialog({ ...base, kind: 'confirm' })
    if (!confirm) throw new Error('no dialog')
    asked.heardDialog(confirm)
    expect(asked.dialogOf('t')).toEqual(confirm)
    expect(asked.dialogOf('other')).toBeNull()
    asked.answerDialog(confirm, false)
    expect(asked.dialogOf('t')).toBeNull()
    expect(calls).toEqual([{ command: 'web_dialog_answer', args: { tab: 't', id: 3, ok: false, text: null } }])
  })
  test('a prompt hands back what was typed, an alert is always fine', () => {
    const prompt = readDialog({ ...base, id: 4, kind: 'prompt', default: 'Ada' })
    const alert = readDialog({ ...base, id: 5, kind: 'alert' })
    if (!prompt || !alert) throw new Error('no dialog')
    asked.answerDialog(prompt, true, 'Grace')
    asked.answerDialog(alert, false)
    expect(calls.map((one) => one.args)).toEqual([
      { tab: 't', id: 4, ok: true, text: 'Grace' },
      { tab: 't', id: 5, ok: true, text: null },
    ])
  })
  test('goes when the page says so, unanswered', () => {
    const one = readDialog({ ...base, id: 6, kind: 'beforeunload' })
    if (!one) throw new Error('no dialog')
    asked.heardDialog(one)
    asked.dialogGone('t', 6)
    expect(asked.dialogOf('t')).toBeNull()
    expect(calls).toEqual([])
  })
})
describe('a page asking for a permission', () => {
  const site = 'https://meet.example.com'
  test('is answered at once when the site was answered before, and asked otherwise', () => {
    grants.remember(siteOf(site), 'camera', 'allow')
    const camera = readPermission({ tab: 't', id: 1, origin: site, asks: ['camera'] })
    const both = readPermission({ tab: 't', id: 2, origin: site, asks: ['camera', 'microphone', 'nonsense'] })
    if (!camera || !both) throw new Error('no ask')
    asked.heardPermission(camera)
    expect(calls).toEqual([{ command: 'web_permission_answer', args: { tab: 't', id: 1, allow: true } }])
    calls.length = 0
    asked.heardPermission(both)
    expect(both.asks).toEqual(['camera', 'microphone'])
    expect(asked.permissionOf('t')).toEqual(both)
    expect(calls).toEqual([])
    asked.answerPermission(both, true)
    expect(calls).toEqual([{ command: 'web_permission_answer', args: { tab: 't', id: 2, allow: true } }])
    expect(grants.said(siteOf(site), 'microphone')).toBe('allow')
  })
  test('one blocked before blocks the whole ask, unasked', () => {
    grants.remember(siteOf('https://cam.example.com'), 'microphone', 'block')
    const one = readPermission({ tab: 't', id: 9, origin: 'https://cam.example.com', asks: ['camera', 'microphone'] })
    if (!one) throw new Error('no ask')
    asked.heardPermission(one)
    expect(asked.permissionOf('t')).toBeNull()
    expect(calls).toEqual([{ command: 'web_permission_answer', args: { tab: 't', id: 9, allow: false } }])
  })
})
describe('a page’s select', () => {
  const said = {
    tab: 't',
    id: 11,
    x: 4,
    y: 8,
    width: 120,
    height: 24,
    zoom: 1,
    selected: 1,
    options: [
      { index: 0, label: 'Red', disabled: false, group: 'Warm' },
      { index: 1, label: 'Blue', disabled: false, group: null },
      { index: 2, label: 'Grey', disabled: true, group: null },
    ],
  }
  test('is read with its box, groups and disabled choices', () => {
    expect(readSelect(said)).toMatchObject({ box: { x: 4, y: 8, width: 120, height: 24 }, selected: 1 })
    expect(readSelect(said)?.options.map((one) => one.group)).toEqual(['Warm', null, null])
  })
  test('a pick or a dismissal answers it once, and a new one dismisses the last', () => {
    const first = readSelect(said)
    const second = readSelect({ ...said, id: 12 })
    if (!first || !second) throw new Error('no select')
    asked.heardSelect(first)
    asked.heardSelect(second)
    asked.pickSelect(second, 0)
    asked.pickSelect(second, 2)
    expect(calls.map((one) => one.args)).toEqual([
      { tab: 't', id: 11, index: null },
      { tab: 't', id: 12, index: 0 },
    ])
  })
})
test('the window takes over what it shows of a page, and listens for each', async () => {
  const { hearAsks } = await import('./asked.svelte')
  const heard: string[] = []
  await hearAsks((name) => {
    heard.push(name)
    return Promise.resolve(() => undefined)
  })
  expect(heard).toEqual([
    'orden://web-menu',
    'orden://web-dialog',
    'orden://web-dialog-gone',
    'orden://web-permission',
    'orden://web-permission-gone',
    'orden://web-select',
  ])
  expect(calls.at(-1)).toEqual({ command: 'web_page_ui', args: { kinds: ['menu', 'dialog', 'permission', 'select'] } })
})
test('a page asking for a sheet, a list or a menu hands the keyboard to the app, so Escape and the arrows are Orden’s', () => {
  took = 0
  const dialog = readDialog({
    tab: 't',
    id: 40,
    kind: 'alert',
    message: 'Hi',
    default: null,
    origin: null,
    reload: false,
  })
  const select = readSelect({ tab: 't', id: 41, x: 0, y: 0, width: 10, height: 10, zoom: 1, selected: 0, options: [] })
  if (!dialog || !select) throw new Error('nothing asked')
  asked.heardDialog(dialog)
  asked.heardSelect(select)
  expect(took).toBe(2)
  asked.dialogGone('t', 40)
  asked.pickSelect(asked.selectOf('t') ?? select, null)
})
