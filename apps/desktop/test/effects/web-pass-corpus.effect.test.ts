import { JSDOM } from 'jsdom'
import { expect, test } from 'vitest'
import script from '../../src-tauri/crates/web/src/web_pass.js?raw'
import corpus from './pass-corpus.json'

interface Page {
  url: string
  title: string
  html: string
}
interface Said {
  kind: string
  forms?: { form: string; kind: string; fields: { field: string; role: string }[] }[]
}
type Inside = Window & typeof globalThis & { ordenPass?: (words: string) => void }
const SIGNING = new Set(['login', 'username', 'password', 'signup', 'change', 'totp'])
const CLASS: Record<string, string> = {
  username: 'user',
  email: 'user',
  password: 'password',
  'new-password': 'new-password',
  totp: 'totp',
}
const FLOOR = { precision: 1, recall: 1, kinds: 0.99 }
interface Seen {
  page: string
  field: string
  truth: string
  got: string
}
async function read(page: Page) {
  const dom = new JSDOM(`<!doctype html><title>${page.title}</title><body>${page.html}</body>`, {
    runScripts: 'outside-only',
    url: page.url,
    pretendToBeVisual: true,
  })
  const inside = dom.window as unknown as Inside
  inside.HTMLElement.prototype.getBoundingClientRect = () => ({
    x: 10,
    y: 10,
    left: 10,
    top: 10,
    width: 200,
    height: 30,
    right: 210,
    bottom: 40,
    toJSON: () => ({}),
  })
  const names = new Map<object, string>()
  const Native = inside.WeakMap
  inside.WeakMap = class Naming<K extends WeakKey, V> extends Native<K, V> {
    override set(key: K, value: V) {
      if (typeof value === 'string') names.set(key, value)
      return super.set(key, value)
    }
  }
  const said: Said[] = []
  inside.ordenPass = (words: string) => void said.push(JSON.parse(words) as Said)
  inside.eval(script)
  await new Promise((done) => setTimeout(done, 0))
  const forms = [...said].reverse().find((one) => one.kind === 'forms')?.forms ?? []
  const byField = new Map(
    forms.flatMap((form) => form.fields.map((one) => [one.field, { kind: form.kind, role: one.role }])),
  )
  return [...inside.document.querySelectorAll<HTMLElement>('[data-truth]')].map((el) => {
    const kind = el.closest<HTMLElement>('[data-truth-kind]')?.dataset.truthKind ?? 'none'
    const got = byField.get(names.get(el) ?? '') ?? { kind: 'none', role: 'none' }
    return {
      hidden: el.hidden,
      truth: SIGNING.has(kind) ? (CLASS[el.dataset.truth ?? ''] ?? 'none') : 'none',
      truthKind: kind,
      got: SIGNING.has(got.kind) ? (CLASS[got.role] ?? 'none') : 'none',
      gotKind: got.kind,
      field: el.getAttribute('name') ?? el.id,
    }
  })
}
test('the corpus of real pages is filled where it signs in and nowhere else', async () => {
  const wrong: Seen[] = []
  const missed: Seen[] = []
  let right = 0
  let kinds = 0
  let kindsRight = 0
  for (const page of corpus as Page[]) {
    for (const one of await read(page)) {
      if (one.hidden) continue
      const seen = { page: page.url, field: one.field, truth: one.truth, got: one.got }
      if (one.got !== 'none' && one.got === one.truth) right++
      else if (one.got !== 'none') wrong.push(seen)
      else if (one.truth !== 'none') missed.push(seen)
      if (one.truthKind !== 'none') {
        kinds++
        if (one.gotKind === one.truthKind) kindsRight++
      }
    }
  }
  const precision = right / Math.max(1, right + wrong.length)
  const recall = right / Math.max(1, right + missed.length)
  const kindShare = kindsRight / Math.max(1, kinds)
  const report = { pages: corpus.length, right, wrong, missed, precision, recall, kinds: kindShare }
  console.info(JSON.stringify(report, null, 1))
  expect(precision, JSON.stringify(wrong)).toBeGreaterThanOrEqual(FLOOR.precision)
  expect(recall, JSON.stringify(missed)).toBeGreaterThanOrEqual(FLOOR.recall)
  expect(kindShare).toBeGreaterThanOrEqual(FLOOR.kinds)
})
