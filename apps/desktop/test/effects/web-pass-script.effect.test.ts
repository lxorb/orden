import { createRequire } from 'node:module'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { expect, test } from 'vitest'
import script from '../../src-tauri/src/web_pass.js?raw'

const jsdomUtils = createRequire(join(process.cwd(), 'package.json'))(
  'jsdom/lib/generated/idl/utils.js',
) as {
  implForWrapper(wrapper: unknown): { isTrusted: boolean; _dispatch(event: unknown): boolean }
}

interface Field {
  field: string
  role: string
  visible: boolean
}

interface Form {
  form: string
  kind: string
  fields: Field[]
}

interface Said {
  kind: string
  doc: string
  forms?: Form[]
  form?: string
  field?: string
  formKind?: string
  username?: string | null
  password?: string | null
  newPassword?: string | null
}

type Inside = Window &
  typeof globalThis & {
    nibPass?: (words: string) => void
    __nibPass: { fill(asked: unknown): boolean }
  }

function laidOut(inside: Inside) {
  inside.HTMLElement.prototype.getBoundingClientRect = function box(this: HTMLElement) {
    const width = this.style.width ? parseFloat(this.style.width) : 200
    const height = this.style.height ? parseFloat(this.style.height) : 30
    return {
      x: 10,
      y: 10,
      left: 10,
      top: 10,
      width,
      height,
      right: 10 + width,
      bottom: 10 + height,
      toJSON: () => ({}),
    }
  }
}

async function page(html: string, url = 'https://a.example/login') {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url, pretendToBeVisual: true })
  const inside = dom.window as unknown as Inside
  const said: Said[] = []
  const closed: ShadowRoot[] = []
  const attach = Object.getOwnPropertyDescriptor(inside.Element.prototype, 'attachShadow')
    ?.value as (this: Element, init: ShadowRootInit) => ShadowRoot
  inside.Element.prototype.attachShadow = function attached(this: Element, init: ShadowRootInit) {
    const root = attach.call(this, init)
    if (init.mode === 'closed') closed.push(root)
    return root
  }
  laidOut(inside)
  inside.nibPass = (words: string) => void said.push(JSON.parse(words) as Said)
  inside.eval(script)
  const document = inside.document
  await new Promise<void>((done) => {
    if (document.readyState !== 'loading') done()
    else document.addEventListener('DOMContentLoaded', () => done(), { once: true })
  })
  const forms = () => [...said].reverse().find((one) => one.kind === 'forms')?.forms ?? []
  const only = () => {
    const all = forms()
    expect(all).toHaveLength(1)
    return all[0]!
  }
  const roles = () => only().fields.map((one) => one.role)
  const fieldId = (role: string, form = only()) => {
    const found = form.fields.find((one) => one.role === role)
    if (!found) throw new Error(`no ${role} field`)
    return found.field
  }
  const fill = (asked: unknown) => inside.__nibPass.fill(asked)
  const input = (selector: string) => document.querySelector<HTMLInputElement>(selector)!
  const trusted = (target: EventTarget, event: Event) => {
    const said = jsdomUtils.implForWrapper(event)
    said.isTrusted = true
    jsdomUtils.implForWrapper(target)._dispatch(said)
  }
  return { inside, said, closed, document, forms, only, roles, fieldId, fill, input, trusted }
}

function at(form: Form, index: number): string {
  const field = form.fields[index]
  if (!field) throw new Error(`no field ${index}`)
  return field.field
}

async function settled() {
  await new Promise((done) => setTimeout(done, 400))
}

test('a page with a username and a password is a login, said before anyone types', async () => {
  const { only, roles, said } = await page(`
    <form action="/session">
      <label for="who">Email</label><input id="who" type="email" name="login">
      <input type="password" name="pass">
      <button>Sign in</button>
    </form>`)
  expect(only().kind).toBe('login')
  expect(roles()).toEqual(['email', 'password'])
  expect(said.every((one) => typeof one.doc === 'string' && one.doc.length === 24)).toBe(true)
})

test('a login asking for its username first, then its password, is two forms', async () => {
  const { only, roles, document } = await page(`
    <form id="step"><input name="identifier" autocomplete="username"><button>Next</button></form>`)
  expect(only().kind).toBe('username')
  expect(roles()).toEqual(['username'])

  document.getElementById('step')?.replaceWith(
    Object.assign(document.createElement('form'), {
      innerHTML: '<input type="password" name="Passwd"><button>Next</button>',
    }),
  )
  await settled()
  expect(only().kind).toBe('password')
  expect(roles()).toEqual(['password'])
})

test('a username page holding a hidden password field is the first of two', async () => {
  const { only } = await page(`
    <form><input type="email" name="email"><input type="password" name="hidden" style="display: none"></form>`)
  expect(only().kind).toBe('username')
  expect(only().fields.map((one) => one.visible)).toEqual([true, false])
})

test('a newsletter box with one email field is no sign-in', async () => {
  const { forms } = await page(
    `
    <form action="/newsletter"><input type="email" name="email"><button>Subscribe</button></form>`,
    'https://a.example/news',
  )
  expect(forms()).toEqual([])
})

test('a text field before the password is the username even when nothing names it', async () => {
  const { roles, only } = await page(
    `<form><input name="x1"><input type="password" name="x2"></form>`,
  )
  expect(only().kind).toBe('login')
  expect(roles()).toEqual(['username', 'password'])
})

test('six boxes of one digit are a 2FA code, and a code fills across them', async () => {
  const boxes = Array.from(
    { length: 6 },
    (_, at) => `<input maxlength="1" inputmode="numeric" name="d${at}">`,
  ).join('')
  const { only, roles, fill, document } = await page(`<form>${boxes}<button>Verify</button></form>`)
  expect(only().kind).toBe('totp')
  expect(roles()).toEqual(Array(6).fill('totp'))

  const first = only().fields[0]!
  expect(fill({ form: only().form, values: { [first.field]: '123456' }, submit: false })).toBe(true)
  const typed = [...document.querySelectorAll('input')].map((one) => one.value).join('')
  expect(typed).toBe('123456')
})

test('a one-time-code field is a 2FA code in any language', async () => {
  for (const html of [
    '<form><input autocomplete="one-time-code"></form>',
    '<form><label for="c">Bestätigungscode</label><input id="c"></form>',
    '<form><input placeholder="验证码"></form>',
    '<form><input aria-label="Code de vérification"></form>',
  ]) {
    const { only, roles } = await page(html)
    expect(only().kind, html).toBe('totp')
    expect(roles(), html).toEqual(['totp'])
  }
})

test('a form with a username, an email and two new passwords is a sign-up', async () => {
  const { only, roles } = await page(`
    <form action="/register">
      <input name="username"><input type="email" name="email">
      <input type="password" name="password"><input type="password" name="confirm_password">
      <button>Create account</button>
    </form>`)
  expect(only().kind).toBe('signup')
  expect(roles()).toEqual(['username', 'email', 'new-password', 'new-password'])
})

test('a current password and two new ones are a change of password', async () => {
  const { only, roles } = await page(`
    <form>
      <input type="password" name="current_password" autocomplete="current-password">
      <input type="password" name="new_password"><input type="password" name="confirm">
    </form>`)
  expect(only().kind).toBe('change')
  expect(roles()).toEqual(['password', 'new-password', 'new-password'])
})

test('a card form says each of its fields, in English and German', async () => {
  const english = await page(`
    <form>
      <input autocomplete="cc-name"><input name="cardnumber"><input placeholder="MM / YY">
      <input name="cvc" maxlength="4">
    </form>`)
  expect(english.only().kind).toBe('card')
  expect(english.roles()).toEqual(['cc-name', 'cc-number', 'cc-exp', 'cc-csc'])

  const german = await page(`
    <form>
      <label for="n">Kartennummer</label><input id="n">
      <label for="m">Ablaufmonat</label><select id="m"><option>01</option><option>12</option></select>
      <label for="s">Sicherheitscode</label><input id="s" maxlength="3">
    </form>`)
  expect(german.only().kind).toBe('card')
  expect(german.roles()).toEqual(['cc-number', 'cc-exp-month', 'cc-csc'])
})

test('an address form is an identity, and a select is filled by what it shows', async () => {
  const { only, roles, fill, input, document } = await page(`
    <form>
      <input name="firstName"><input name="lastName"><input name="street">
      <input name="zip"><input name="city">
      <select name="country"><option value="">-</option><option value="CH">Switzerland</option></select>
    </form>`)
  expect(only().kind).toBe('identity')
  expect(roles()).toEqual([
    'given-name',
    'family-name',
    'street-address',
    'postal-code',
    'address-level2',
    'country',
  ])
  const form = only()
  expect(
    fill({
      form: form.form,
      values: { [at(form, 0)]: 'Ada', [at(form, 5)]: 'switzerland' },
      submit: false,
    }),
  ).toBe(true)
  expect(input('[name=firstName]').value).toBe('Ada')
  expect(document.querySelector<HTMLSelectElement>('select')?.value).toBe('CH')
})

test('a field nobody can see is said as unseen and never filled', async () => {
  const { only, fill, input } = await page(`
    <form>
      <input name="username">
      <input name="trap" style="visibility: hidden">
      <input name="tiny" style="width: 1px">
      <input type="password" name="password">
      <div style="display: none"><input type="password" name="old" autocomplete="current-password"></div>
    </form>`)
  const form = only()
  expect(form.kind).toBe('login')
  expect(form.fields.map((one) => one.visible)).toEqual([true, false, false, true, false])
  const values = Object.fromEntries(form.fields.map((one) => [one.field, 'x']))
  expect(fill({ form: form.form, values, submit: false })).toBe(true)
  expect(input('[name=username]').value).toBe('x')
  expect(input('[name=trap]').value).toBe('')
  expect(input('[name=tiny]').value).toBe('')
  expect(input('[name=old]').value).toBe('')
})

test('a field faint, covered, out of view or too small to read is never filled', async () => {
  const { only, fill, input, document } = await page(`
    <form>
      <input name="username">
      <div style="opacity: 0.3"><input name="faint" autocomplete="email"></div>
      <input name="small" style="width: 8px" autocomplete="tel">
      <input type="password" name="password">
    </form>`)
  const form = only()
  expect(form.kind).toBe('login')
  const values = Object.fromEntries(form.fields.map((one) => [one.field, 'x']))
  expect(fill({ form: form.form, values, submit: false })).toBe(true)
  expect(input('[name=username]').value).toBe('x')
  expect(input('[name=faint]').value).toBe('')
  expect(input('[name=small]').value).toBe('')
  expect(input('[name=password]').value).toBe('x')

  const password = input('[name=password]')
  const box = password.getBoundingClientRect()
  password.getBoundingClientRect = () => ({
    x: box.x,
    y: 5000,
    left: box.left,
    top: 5000,
    width: box.width,
    height: box.height,
    right: box.right,
    bottom: 5000 + box.height,
    toJSON: () => ({}),
  })
  const cover = document.createElement('div')
  document.body.append(cover)
  Object.assign(document, { elementFromPoint: () => cover })
  const again = Object.fromEntries(form.fields.map((one) => [one.field, 'y']))
  expect(fill({ form: form.form, values: again, submit: false })).toBe(false)
  expect(input('[name=username]').value).toBe('x')
  expect(password.value).toBe('x')

  Object.assign(document, { elementFromPoint: () => input('[name=username]') })
  expect(fill({ form: form.form, values: again, submit: false })).toBe(true)
  expect(input('[name=username]').value).toBe('y')
  expect(password.value).toBe('x')
})

test('fields inside open shadow roots are found, each in a design system element of its own', async () => {
  const { only, roles, document } = await page(`<form id="f"></form>`)
  const form = document.getElementById('f') as HTMLFormElement
  for (const [name, type] of [
    ['username', 'text'],
    ['password', 'password'],
  ] as const) {
    const host = document.createElement('fancy-input')
    host.setAttribute('name', name)
    const root = host.attachShadow({ mode: 'open' })
    const field = document.createElement('input')
    field.type = type
    root.append(field)
    form.append(host)
  }
  return settled().then(() => {
    expect(only().kind).toBe('login')
    expect(roles()).toEqual(['username', 'password'])
  })
})

test('a form a single-page app draws late is said once it is there', async () => {
  const { forms, document, said } = await page('<div id="app"></div>')
  expect(said).toEqual([])
  setTimeout(() => {
    const app = document.getElementById('app')!
    app.innerHTML = '<form><input name="user"><input type="password" name="pw"></form>'
  }, 20)
  await settled()
  expect(forms().map((one) => one.kind)).toEqual(['login'])
})

test('a form is said again only when what it is changes', async () => {
  const { said, document } = await page('<form><input name="user"><input type="password"></form>')
  const before = said.length
  document.body.setAttribute('class', 'busy')
  document.querySelector('form')?.setAttribute('class', 'x')
  await settled()
  expect(said.length).toBe(before)
})

test('nothing of the page is written: field names live in the script alone', async () => {
  const html = '<form><input name="user"><input type="password" name="pw"></form>'
  const { document } = await page(html)
  expect(document.body.innerHTML).toBe(html)
  for (const one of document.querySelectorAll('input')) {
    expect([...one.attributes].map((attribute) => attribute.name).sort()).toEqual(
      one.type === 'password' ? ['name', 'type'] : ['name'],
    )
  }
})

test('a fillable field wears a mark in a closed root, and only a person pressing it asks', async () => {
  const { closed, document, said, only, trusted, inside } = await page(
    '<form><input name="user"><input type="password" name="pw"></form>',
  )
  const marks = document.documentElement.querySelectorAll(':scope > nib-pass-mark')
  expect(marks).toHaveLength(2)
  expect([...marks].every((one) => one.shadowRoot === null)).toBe(true)
  expect(closed).toHaveLength(2)
  expect(closed[0]?.textContent).toBe('')

  const button = closed[1]!.querySelector('button')!
  button.dispatchEvent(new inside.MouseEvent('click', { bubbles: true, composed: true }))
  expect(said.filter((one) => one.kind === 'mark')).toEqual([])

  trusted(button, new inside.MouseEvent('click', { bubbles: true, composed: true }))
  const mark = said.filter((one) => one.kind === 'mark')
  expect(mark).toHaveLength(1)
  expect(mark[0]?.form).toBe(only().form)
  expect(mark[0]?.field).toBe(only().fields[1]?.field)
})

test('Ctrl+Shift+L asks for the field that has the keyboard', async () => {
  const { said, only, trusted, inside, input } = await page(
    '<form><input name="user"><input type="password" name="pw"></form>',
  )
  input('[name=pw]').focus()
  const key = { key: 'L', code: 'KeyL', ctrlKey: true, shiftKey: true, bubbles: true }
  input('[name=pw]').dispatchEvent(new inside.KeyboardEvent('keydown', key))
  expect(said.filter((one) => one.kind === 'mark')).toEqual([])

  trusted(input('[name=pw]'), new inside.KeyboardEvent('keydown', key))
  const asked = said.filter((one) => one.kind === 'mark')
  expect(asked.map((one) => one.field)).toEqual([only().fields[1]?.field])
})

test('a fill goes past a framework that watches the value it set itself', async () => {
  const { only, fill, input, inside } = await page(
    '<form><input name="user"><input type="password" name="pw"></form>',
  )
  const field = input('[name=user]')
  const native = Object.getOwnPropertyDescriptor(inside.HTMLInputElement.prototype, 'value')
  let tracked = ''
  Object.defineProperty(field, 'value', {
    configurable: true,
    get: () => native?.get?.call(field) as string,
    set: (value: string) => {
      tracked = value
      native?.set?.call(field, value)
    },
  })
  const changed: string[] = []
  const heard: string[] = []
  for (const type of ['input', 'change', 'keyup', 'blur'])
    field.addEventListener(type, () => heard.push(type))
  field.addEventListener('input', () => {
    const now = native?.get?.call(field) as string
    if (now !== tracked) changed.push(now)
  })

  const form = only()
  expect(fill({ form: form.form, values: { [at(form, 0)]: 'alice' }, submit: false })).toBe(true)
  expect(changed).toEqual(['alice'])
  expect(heard).toEqual(['input', 'change', 'keyup', 'blur'])
})

test('a fill for another document, another site or another form fills nothing', async () => {
  const { only, fill, input, said } = await page(
    '<form><input name="user"><input type="password" name="pw"></form>',
  )
  const form = only()
  const values = { [at(form, 0)]: 'alice' }
  expect(fill({ form: form.form, values, submit: false, doc: 'another' })).toBe(false)
  expect(fill({ form: form.form, values, submit: false, origin: 'https://b.example' })).toBe(false)
  expect(fill({ form: 'f999', values, submit: false })).toBe(false)
  expect(input('[name=user]').value).toBe('')
  expect(
    fill({
      form: form.form,
      values,
      submit: false,
      doc: said[0]?.doc,
      origin: 'https://a.example',
    }),
  ).toBe(true)
  expect(input('[name=user]').value).toBe('alice')
})

test('a fill that sends submits the form, and what was sent is said once', async () => {
  const { only, fill, document, said } = await page(
    '<form><input name="user"><input type="password" name="pw"><button>Sign in</button></form>',
  )
  let submitted = 0
  document.querySelector('form')?.addEventListener('submit', (event) => {
    event.preventDefault()
    submitted += 1
  })
  const form = only()
  const values = { [at(form, 0)]: 'alice', [at(form, 1)]: 'hunter2' }
  expect(fill({ form: form.form, values, submit: true })).toBe(true)
  expect(submitted).toBe(1)
  const sent = said.filter((one) => one.kind === 'submitted')
  expect(sent).toEqual([
    {
      kind: 'submitted',
      doc: said[0]?.doc,
      form: form.form,
      formKind: 'login',
      username: 'alice',
      password: 'hunter2',
      newPassword: null,
    },
  ])
})

test('what a person typed is read only when the form is sent', async () => {
  const { input, said, trusted, inside, document } = await page(
    '<form><input name="user"><input type="password" name="pw"></form><button id="away">x</button>',
  )
  input('[name=user]').value = 'bob'
  input('[name=pw]').value = 'swordfish'
  document.body.append(document.createElement('p'))
  await settled()
  expect(JSON.stringify(said)).not.toContain('swordfish')

  trusted(
    input('[name=pw]'),
    new inside.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }),
  )
  const sent = said.filter((one) => one.kind === 'submitted')
  expect(sent.map((one) => [one.formKind, one.username, one.password])).toEqual([
    ['login', 'bob', 'swordfish'],
  ])
})

test('a sign-up sent says its new password', async () => {
  const { input, said, document, inside } = await page(`
    <form action="/signup"><input name="username"><input type="email" name="email">
    <input type="password" name="password"><input type="password" name="password2"></form>`)
  input('[name=username]').value = 'carol'
  input('[name=password]').value = 'n3w'
  input('[name=password2]').value = 'n3w'
  document.querySelector('form')?.dispatchEvent(new inside.Event('submit', { bubbles: true }))
  const sent = said.filter((one) => one.kind === 'submitted')
  expect(sent.map((one) => [one.formKind, one.username, one.password, one.newPassword])).toEqual([
    ['signup', 'carol', null, 'n3w'],
  ])
})

test('a sign-in a single-page app takes away once it is sent is said as sent', async () => {
  const { input, said, document } = await page(
    '<div id="app"><input name="user"><input type="password" name="pw"><div role="button">Log in</div></div>',
  )
  input('[name=user]').value = 'dan'
  input('[name=pw]').value = 'secret'
  document.getElementById('app')?.replaceChildren(document.createElement('main'))
  await settled()
  const sent = said.filter((one) => one.kind === 'submitted')
  expect(sent.map((one) => [one.formKind, one.username, one.password])).toEqual([
    ['login', 'dan', 'secret'],
  ])
})

test('a message waits for the channel when the engine has not put it in yet', async () => {
  const dom = new JSDOM('<form><input name="user"><input type="password"></form>', {
    runScripts: 'outside-only',
    url: 'https://a.example/',
  })
  const inside = dom.window as unknown as Inside
  laidOut(inside)
  inside.eval(script)
  const said: string[] = []
  inside.nibPass = (words: string) => void said.push(words)
  await settled()
  expect(said.map((one) => (JSON.parse(one) as Said).kind)).toEqual(['forms'])
})
