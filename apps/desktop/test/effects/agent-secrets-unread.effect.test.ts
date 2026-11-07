import { JSDOM } from 'jsdom'
import { expect, test } from 'vitest'
import agent from '../../src-tauri/src/agents/engines/snapshot.js?raw'
import page from '../../src-tauri/src/agents/page.rs?raw'

function rawString(name: string): string {
  const start = page.indexOf(`const ${name}: &str = r"`)
  if (start < 0) throw new Error(`no ${name} in page.rs`)
  const from = page.indexOf('r"', start) + 2
  return page.slice(from, page.indexOf('\n";', from))
}

const FIELDS = rawString('FIELDS')
const FACTS = `function (heard) {${FIELDS}${rawString('FACTS_BODY')}}`

const SECRET = 'hunter2-hunter2'

function window(html: string) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://a.example/' })
  return dom.window as unknown as Window &
    typeof globalThis & { ordenAgent: { tree(most: number): { nodes: Record<string, unknown>[] } } }
}

test("an agent's facts never name a field after what was typed in it", () => {
  const inside = window('<input id="secret" type="password"><input id="card" name="x">')
  const facts = inside.eval(`(${FACTS})`) as (this: Element, heard: unknown[]) => { name: string }
  for (const id of ['secret', 'card']) {
    const field = inside.document.getElementById(id) as HTMLInputElement
    field.value = SECRET
    expect(JSON.stringify(facts.call(field, []))).not.toContain(SECRET)
  }
})

test("an agent's facts still name a button by the words on it", () => {
  const inside = window('<form><input id="go" type="reset" value="Start over"></form>')
  const facts = inside.eval(`(${FACTS})`) as (this: Element, heard: unknown[]) => { name: string }
  const button = inside.document.getElementById('go') as HTMLInputElement
  expect(facts.call(button, []).name).toBe('Start over')
})

test("an agent's snapshot of a password field says it is filled and not how long it is", () => {
  const inside = window('<label>Password <input type="password"></label><input type="password">')
  const [first, second] = inside.document.querySelectorAll('input')
  if (!first || !second) throw new Error('no fields')
  first.value = SECRET
  inside.eval(`${FIELDS}\n${agent}\nglobalThis.ordenAgent = globalThis.ordenAgentOf(describe, 1)`)
  const said = JSON.stringify(inside.ordenAgent.tree(1000))
  expect(said).not.toContain(SECRET)
  expect(said).not.toContain('•'.repeat(2))
  expect(said).toContain('"value":{"value":"•"}')
})

test("an agent's snapshot hides a card's number, its code and a one-time code as it hides a password", () => {
  const inside = window(`
    <input id="number" autocomplete="cc-number">
    <input id="csc" name="cardCvc">
    <input id="otp" name="otp-code" inputmode="numeric">
    <input id="named" aria-label="Verification code">
    <input id="city" name="city">`)
  for (const id of ['number', 'csc', 'otp', 'named']) {
    const field = inside.document.getElementById(id) as HTMLInputElement
    field.value = SECRET
  }
  const city = inside.document.getElementById('city') as HTMLInputElement
  city.value = 'Zurich'
  inside.eval(`${FIELDS}\n${agent}\nglobalThis.ordenAgent = globalThis.ordenAgentOf(describe, 1)`)
  const said = JSON.stringify(inside.ordenAgent.tree(1000))
  expect(said).not.toContain(SECRET)
  expect(said.split('"value":{"value":"•"}')).toHaveLength(5)
  expect(said).toContain('Zurich')
})

test("an agent's facts never name a text field acting as a button after what is in it", () => {
  const inside = window(
    '<input id="field" role="button"><input id="go" type="submit" value="Send">',
  )
  const facts = inside.eval(`(${FACTS})`) as (this: Element, heard: unknown[]) => { name: string }
  const field = inside.document.getElementById('field') as HTMLInputElement
  field.value = SECRET
  expect(JSON.stringify(facts.call(field, []))).not.toContain(SECRET)
  const go = inside.document.getElementById('go') as HTMLInputElement
  expect(facts.call(go, []).name).toBe('Send')
})
