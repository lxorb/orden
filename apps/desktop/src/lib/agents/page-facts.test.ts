import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, test } from 'vitest'

/** What the crate's script says about an element, run on a document of its own: the words
 *  the policy judges a press by, whatever the page built its button or its form out of.
 *  The script is page.rs's, read off the disk, because it is a string there no Rust test
 *  can run. */

const source = readFileSync(
  join(import.meta.dirname, '../../../src-tauri/src/agents/page.rs'),
  'utf8',
)

function constant(name: string): string {
  const found = new RegExp(`const ${name}: &str = r"([\\s\\S]*?)";`).exec(source)?.[1]
  if (found === undefined) throw new Error(`no ${name} in page.rs`)
  return found
}

const script = constant('FIELDS') + constant('FACTS_BODY')

interface Said {
  name: string
  in_form: boolean
  submit: boolean
  link: boolean
  control: boolean
  fields: { type: string; autocomplete: string; said: string }[]
  at: string[]
}

function page(html: string): Document {
  const { window } = new JSDOM(`<!doctype html><body>${html}`, { url: 'https://shop.example/a' })
  // jsdom lays nothing out, so it has no innerText.
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    get(this: HTMLElement) {
      return this.textContent
    },
  })
  return window.document
}

function factsOf(element: Element): Said {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the script under test is a string in the crate
  return new Function(script).call(element) as Said
}

function pressOn(document: Document): Said {
  const button = document.querySelector('button')
  if (!button) throw new Error('no button')
  return factsOf(button)
}

/** Puts an open or closed shadow root on `#host` with these contents. */
function rooted(document: Document, html: string, mode: 'open' | 'closed' = 'open'): ShadowRoot {
  const host = document.querySelector('#host')
  if (!host) throw new Error('no host')
  const root = host.attachShadow({ mode })
  root.innerHTML = html
  return root
}

describe('a button named by what is inside it', () => {
  test.each([
    ['a picture', '<button><img alt="Pay now" src="x.png"></button>'],
    ['a picture in a span', '<button><span><img alt="Pay now"></span></button>'],
    ['a label on a child', '<button><i aria-label="Pay now"></i></button>'],
    ['an svg title', '<button><svg><title>Pay now</title></svg></button>'],
    ['a title on a child', '<button><span title="Pay now"></span></button>'],
    ['words and a picture', '<button>OK <img alt="Pay now"></button>'],
  ])('%s', (_how, html) => {
    expect(pressOn(page(html)).name).toContain('Pay now')
  })

  test('its own words stand as they are', () => {
    expect(pressOn(page('<button>Continue</button>')).name).toBe('Continue')
    expect(pressOn(page('<button aria-label="Continue"><b>x</b></button>')).name).toBe('Continue')
  })
})

describe('a form with its fields in a shadow root', () => {
  test('a password in one is a field of the form', () => {
    const document = page('<form><div id="host"></div><button>Log in</button></form>')
    rooted(document, '<input type="password" name="pw">')
    expect(pressOn(document).fields.map((one) => one.type)).toContain('password')
  })

  test('a card in one, deeper down, is a field of the form', () => {
    const document = page('<form><div id="host"></div><button>Continue</button></form>')
    const root = rooted(document, '<div id="inner"></div>')
    const inner = root.querySelector('#inner')
    const deeper = inner?.attachShadow({ mode: 'open' })
    if (deeper) deeper.innerHTML = '<input autocomplete="cc-number">'
    expect(pressOn(document).fields.map((one) => one.autocomplete)).toContain('cc-number')
  })

  test('a button in one is still in the form around its host', () => {
    const document = page('<form><input type="password"><div id="host"></div></form>')
    const root = rooted(document, '<button>Log in</button>')
    const button = root.querySelector('button')
    if (!button) throw new Error('no button')
    const facts = factsOf(button)
    expect(facts.in_form).toBe(true)
    expect(facts.fields.map((one) => one.type)).toContain('password')
  })

  test('with no form, the page has them', () => {
    const document = page('<div id="host"></div><button>Send</button>')
    rooted(document, '<textarea name="message"></textarea>')
    expect(pressOn(document).fields.map((one) => one.type)).toContain('textarea')
  })

  test('a field outside the form stays out of it', () => {
    const document = page(
      '<div id="host"></div><form><input name="q"><button>Search</button></form>',
    )
    rooted(document, '<input type="password">')
    expect(pressOn(document).fields.map((one) => one.type)).not.toContain('password')
  })
})

describe('where an element is', () => {
  test('its document says, for the frame it is in', () => {
    expect(pressOn(page('<button>Go</button>')).at[0]).toBe('https://shop.example/a')
  })
})

function named(document: Document, selector: string): Said {
  const found = document.querySelector(selector)
  if (!found) throw new Error(`no ${selector}`)
  return factsOf(found)
}

describe('what is no control is not named by all it holds', () => {
  test('a column of cards', () => {
    const facts = named(
      page(
        '<div id="c"><h3>To do</h3><div class="card">Pay rent</div><div class="card">Buy milk</div></div>',
      ),
      '#c',
    )
    expect(facts.control).toBe(false)
    expect(facts.name).not.toContain('Pay')
    expect(facts.name).not.toContain('Buy')
  })

  test('a mail row with an icon labelled Delete', () => {
    for (const icon of [
      '<button aria-label="Delete"></button>',
      '<svg aria-label="Delete"></svg>',
      '<img alt="Delete">',
    ]) {
      const facts = named(page(`<div id="r"><span>Ann</span> Lunch? ${icon}</div>`), '#r')
      expect(facts.name, icon).not.toContain('Delete')
      expect(facts.name, icon).toContain('Lunch')
    }
  })

  test('a long stretch of words is no name', () => {
    const words =
      'Pay attention to this long paragraph of writing about nothing much at all, please'
    expect(named(page(`<div id="p">${words}</div>`), '#p').name).toBe('')
  })

  test.each([
    ['its own words', '<div id="x" onclick="pay()">Pay now</div>'],
    ['a span in it', '<div id="x"><span>Pay now</span></div>'],
    ['one thing inside one thing', '<div id="x"><div><b>Pay now</b></div></div>'],
    ['its own label', '<div id="x" aria-label="Pay now"><i></i><i></i></div>'],
    ['nothing but a picture', '<div id="x"><img alt="Pay now"></div>'],
  ])('and the true asks stay: %s', (_how, html) => {
    expect(named(page(html), '#x').name).toContain('Pay now')
  })

  test('a control says it is one', () => {
    for (const html of [
      '<button id="x">a</button>',
      '<a id="x" href="/y">a</a>',
      '<div id="x" role="button">a</div>',
    ]) {
      expect(named(page(html), '#x').control, html).toBe(true)
    }
    expect(named(page('<div id="x">a</div>'), '#x').control).toBe(false)
  })

  test('a link around a picture is a link', () => {
    const facts = named(page('<a id="x" href="/h"><img alt="How to delete things"></a>'), '#x')
    expect(facts.link).toBe(true)
  })
})

describe('a name from round a shadow root', () => {
  test('the inner button of a host with a label', () => {
    const document = page('<div id="host" aria-label="Pay now"></div>')
    const button = rooted(document, '<button></button>').querySelector('button')
    if (!button) throw new Error('no button')
    expect(factsOf(button).name).toContain('Pay now')
  })

  test('aria-labelledby inside the root', () => {
    const document = page('<div id="host"></div>')
    const button = rooted(
      document,
      '<span id="n">Pay now</span><button aria-labelledby="n"></button>',
    ).querySelector('button')
    if (!button) throw new Error('no button')
    expect(factsOf(button).name).toContain('Pay now')
  })
})

describe('a huge page', () => {
  test('is walked only so far', () => {
    const document = page('<div id="x">a</div><button>Go</button>')
    const body = document.body
    for (let at = 0; at < 60_000; at++) body.append(document.createElement('i'))
    const input = document.createElement('input')
    body.append(input)
    const started = performance.now()
    const facts = pressOn(document)
    // Stopped short of the field, and it says it did.
    expect(facts.fields).toEqual([])
    expect(facts as unknown as { cut: boolean }).toMatchObject({ cut: true })
    expect(performance.now() - started).toBeLessThan(30_000)
  })
})
