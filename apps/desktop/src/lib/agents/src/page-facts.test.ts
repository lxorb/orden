import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, test } from 'vitest'

const source = readFileSync(
  join(import.meta.dirname, '../../../../src-tauri/src/agents/page.rs'),
  'utf8',
)

function constant(name: string): string {
  const found = new RegExp(`const ${name}: &str = r"([\\s\\S]*?)";`).exec(source)?.[1]
  if (found === undefined) throw new Error(`no ${name} in page.rs`)
  return found
}

const script = constant('FIELDS') + constant('FACTS_BODY')

interface Said {
  tag: string
  default_button: string
  name: string
  in_form: boolean
  submit: boolean
  link: boolean
  control: boolean
  dialog: string
  held: string[]
  opaque: boolean
  fields: { type: string; autocomplete: string; said: string }[]
  at: string[]
}

function page(html: string): Document {
  const { window } = new JSDOM(`<!doctype html><body>${html}`, { url: 'https://shop.example/a' })
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    get(this: HTMLElement) {
      return this.textContent
    },
  })
  window.Element.prototype.getClientRects = function (this: Element) {
    const hidden = this.getAttribute('style')?.includes('display:none') === true
    return (hidden ? [] : [{}]) as unknown as DOMRectList
  }
  return window.document
}

function factsOf(element: unknown, heard?: Element): Said {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the script under test is a string in the crate
  return new Function('heard', script).call(element, heard) as Said
}

function maskedText(document: Document, hidden: number[]): string {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the script under test is a string in the crate
  const run = new Function('document', 'hidden', constant('MASKED_TEXT')) as (
    document: Document,
    hidden: number[],
  ) => string
  return run(document, hidden)
}

function pressOn(document: Document): Said {
  const button = document.querySelector('button')
  if (!button) throw new Error('no button')
  return factsOf(button)
}

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
    const facts = pressOn(document)
    expect(facts.fields).toEqual([])
    expect(facts as unknown as { cut: boolean }).toMatchObject({ cut: true })
  })
})

describe('a press no control holds goes to what acts for it', () => {
  const hit = (html: string, at = '#hit') => {
    const element = page(html).querySelector(at)
    if (!element) throw new Error('no element')
    return factsOf(element)
  }

  test.each([
    ['a handler', '<div onclick="pay()"><div>Pay now</div><div id=hit>20.00 EUR</div></div>'],
    [
      'a pointer it sets',
      '<div style="cursor:pointer"><div>Pay now</div><div id=hit>20.00 EUR</div></div>',
    ],
    ['the tab order', '<div tabindex=0><div>Pay now</div><div id=hit>20.00 EUR</div></div>'],
    ['a role', '<div role=option><div>Pay now</div><div id=hit>20.00 EUR</div></div>'],
    [
      'a press handler',
      '<div onmousedown="pay()"><div>Pay now</div><div id=hit>20 EUR</div></div>',
    ],
  ])('%s: a part of it is called what it holds', (_, html) => {
    const facts = hit(html)
    expect(facts.held).toContain('Pay now')
    expect(facts.name).toContain('EUR')
    expect(facts.control).toBe(false)
  })

  test('a listener only the engine can see', () => {
    const document = page('<div id=round><div>Pay now</div><div id=hit>20.00 EUR</div></div>')
    const facts = factsOf(document.querySelector('#hit')!, document.querySelector('#round')!)
    expect(facts.held).toEqual(['Pay now'])
    expect(facts.name).toBe('20.00 EUR')
    expect(factsOf(document.querySelector('#hit')!).held).toEqual([])
  })

  test('a label on it', () => {
    expect(
      hit('<div onclick="pay()" aria-label="Pay now"><div id=hit>20 EUR</div></div>').name,
    ).toContain('Pay now')
  })

  test('the words of one', () => {
    expect(hit('<div onclick="go()"><div>Pay now</div><span id=hit></span></div>').held).toContain(
      'Pay now',
    )
  })

  test.each([
    [
      'a row is not called what its button is',
      '<table><tr onclick="go()"><td id=hit>Bob</td><td>Hi</td><td><button aria-label="Delete">x</button></td></tr></table>',
      'Bob',
    ],
    [
      'words too long to be a name are none',
      '<div onclick="go()"><p id=hit>Open</p><p>Please pay your dues and remove your shoes when you come into the house</p></div>',
      'Open',
    ],
    [
      'a column is no card',
      '<div tabindex=0><h3 id=hit>Todo</h3><div>Pay rent before the end of the month</div><div>Delete the old backups from the attic</div></div>',
      'Todo',
    ],
    [
      'what does not show is not said',
      '<div onclick="go()"><div id=hit>Open</div><div style="display:none">Delete</div></div>',
      'Open',
    ],
    [
      'a place out of the tab order is no press',
      '<div tabindex=-1><p>Pay</p><p id=hit>Open</p></div>',
      'Open',
    ],
    ['plain words are their own', '<div><p>Pay now</p><p id=hit>Open</p></div>', 'Open'],
  ])('%s', (_, html, name) => {
    expect(hit(html).name).toBe(name)
  })

  test('a field and a control are their own', () => {
    expect(hit('<div onclick="go()"><input id=hit aria-label="Qty"><b>Delete</b></div>').name).toBe(
      'Qty',
    )
    expect(hit('<div onclick="pay()"><b>Pay</b><button id=hit>Details</button></div>').name).toBe(
      'Details',
    )
  })

  test('words of a label press its button', () => {
    const facts = hit(
      '<form><label><span id=hit>Confirm</span> <button>Pay now</button></label></form>',
    )
    expect(facts.name).toContain('Pay now')
    expect(facts.control).toBe(true)
    expect(facts.submit).toBe(true)
  })

  test('a link keeps going where it goes', () => {
    const facts = hit('<a id=hit href="/guide">Delete account</a>')
    expect(facts.link).toBe(true)
    expect(facts.control).toBe(true)
  })
})

describe('what a press lands on that is no element', () => {
  test('a pseudo-element is the element it hangs on', () => {
    const button = page('<button>Pay now</button>').querySelector('button')
    class Pseudo {
      get element() {
        return button
      }
    }
    expect(factsOf(new Pseudo()).name).toBe('Pay now')
  })

  test('so is a shadow root, and a document its root', () => {
    const document = page('<div id="host"></div>')
    const root = rooted(document, '<button>Pay now</button>')
    expect(factsOf(root).tag).toBe('div')
    expect(factsOf(document).tag).toBe('html')
  })

  test('what is nothing says nothing, for the crate to ask about', () => {
    expect(factsOf({})).toEqual({})
  })
})

describe('what acts for a press, by its first line', () => {
  const hit = (html: string, at = '#hit') => {
    const element = page(html).querySelector(at)
    if (!element) throw new Error('no element')
    return factsOf(element)
  }

  test('a long part under a short first line', () => {
    const terms = 'Your plan renews automatically every month until you cancel it in your account'
    const facts = hit(`<div onclick="pay()"><div>Pay now</div><div id=hit>${terms}</div></div>`)
    expect(facts.held).toContain('Pay now')
  })

  test('a price goes before it', () => {
    expect(
      hit('<div onclick="pay()"><div id=hit>20.00 EUR</div><div>Pay now</div></div>').held,
    ).toContain('Pay now')
  })

  test.each(['open', 'closed'] as const)('through a %s shadow root', (mode) => {
    const document = page('<div id="host" onclick="pay()"></div>')
    const root = rooted(document, '<div>Pay now</div><div id="hit">20.00 EUR</div>', mode)
    expect(factsOf(root.querySelector('#hit')).held).toContain('Pay now')
  })

  test('from outside an open one', () => {
    const document = page('<div onclick="pay()"><p id="hit">x</p><div id="host"></div></div>')
    rooted(document, '<div>Pay now</div>')
    expect(factsOf(document.querySelector('#hit')).name).toContain('x')
  })

  test.each([
    [
      'a listener round a short app',
      '<div id=root><span id=hit>Home</span><div>Delete account</div></div>',
      'Home',
    ],
    [
      'a row',
      '<table><tr tabindex=0 onclick="go()"><td id=hit>Stripe</td><td>Pay now</td></tr></table>',
      'Stripe',
    ],
    [
      'a help card, from its other line',
      '<article onclick="go()" style="cursor:pointer"><p id=hit>Help center</p><h3>How to delete your account</h3></article>',
      'Help center',
    ],
    [
      'a card with a word further down',
      '<div style="cursor:pointer" onclick="go()"><div id=hit>Delivery details</div><div><div>Home</div><div>Pay on delivery</div></div></div>',
      'Delivery details',
    ],
  ])('%s is not called its other lines', (_, html, name) => {
    expect(hit(html).name).toBe(name)
  })

  test('what holds many controls is no one control', () => {
    expect(
      hit(
        '<div onclick="go()"><h3>Pay</h3><p id=hit>Open</p><a></a><button></button><button></button></div>',
      ).name,
    ).toBe('Open')
  })
})

describe('a link that goes somewhere, and one that does more', () => {
  const on = (html: string) => {
    const link = page(html).querySelector('a')
    if (!link) throw new Error('no link')
    return factsOf(link)
  }

  test('a plain address is a link', () => {
    expect(on('<a href="/delete-account">Delete account</a>').link).toBe(true)
  })

  test.each([
    '<a href="/users/1" data-method="delete">Delete account</a>',
    '<a href="/users/1" data-turbo-method="delete">Delete account</a>',
    '<a href="/users/1" role="button">Delete account</a>',
    '<a href="x" onclick="del()">Delete account</a>',
  ])('%s is a press', (html) => {
    expect(on(html).link).toBe(false)
  })
})

describe('a control in a dialog', () => {
  test.each([
    [
      'its label',
      '<div role=dialog aria-label="Delete your account?"><button>Confirm</button></div>',
    ],
    ['its heading', '<dialog open><h2>Delete your account?</h2><button>Confirm</button></dialog>'],
    [
      'its first words',
      '<div role=alertdialog><p>Delete your account?</p><button>Confirm</button></div>',
    ],
  ])('says what the dialog says: %s', (_, html) => {
    expect(pressOn(page(html)).dialog).toBe('Delete your account?')
  })

  test('and anything else says nothing of one', () => {
    expect(pressOn(page('<button>Confirm</button>')).dialog).toBe('')
  })
})

describe('a control named by a label as well as by its words', () => {
  test('a label elsewhere does not hide them', () => {
    const facts = pressOn(
      page('<label for=b>Continue reading</label><button id=b>Pay now</button>'),
    )
    expect(facts.name).toContain('Pay now')
    expect(facts.name).toContain('Continue reading')
  })

  test('a label that says them is not said twice', () => {
    expect(pressOn(page('<button aria-label="Pay now">Pay</button>')).name).toBe('Pay now')
  })
})

describe('a secret region in what is read', () => {
  const read = maskedText

  test('is a mark, and every other word stays', () => {
    const document = page(
      '<p>Total: 120.00 EUR, invoice 12-7712</p><div contenteditable aria-label="PIN">12</div><p>due 2031-12-01</p>',
    )
    const text = read(document, [0])
    expect(text).toContain('Total: 120.00 EUR, invoice 12-7712')
    expect(text).toContain('due 2031-12-01')
    expect(text).toContain('[hidden]')
    expect(text.replace(/\[hidden\]/, '')).not.toMatch(/(^|\s)12(\s|$)/)
  })

  test('only the one the policy named', () => {
    const document = page('<div contenteditable>a draft</div><div contenteditable>4111</div>')
    const text = read(document, [1])
    expect(text).toContain('a draft')
    expect(text).not.toContain('4111')
  })

  test('from markup too', () => {
    const document = page('<p>not</p><div contenteditable>not</div><div contenteditable>4111</div>')
    const copy = document.body.cloneNode(true) as Element
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the script under test is a string in the crate
    const run = new Function('copy', 'hidden', constant('MASKED_CLONE')) as (
      copy: Element,
      hidden: number[],
    ) => void
    run(copy, [0, 1])
    expect(copy.querySelector('p')?.textContent).toBe('not')
    expect(copy.innerHTML).not.toContain('4111')
    expect(copy.innerHTML).toContain('[hidden]')
  })
})

describe('what acts for a press offers its lines to the policy', () => {
  const hit = (html: string, at = '#hit') => {
    const element = page(html).querySelector(at)
    if (!element) throw new Error('no element')
    return factsOf(element)
  }

  test('every short line of something built to be pressed', () => {
    const facts = hit(
      '<div onclick="pay()"><div id=hit>Order summary</div><div>Pay now</div></div>',
    )
    expect(facts.held).toEqual(['Order summary', 'Pay now'])
  })

  test('a line with a number is a line', () => {
    expect(
      hit('<div onclick="x()"><div>Delete 3 files</div><div id=hit>Cannot be undone</div></div>')
        .held,
    ).toContain('Delete 3 files')
  })

  test('short ones past a long one, and the first ones of a long card', () => {
    const long = 'Your plan renews automatically every month until you cancel it in your account'
    expect(
      hit(`<div onclick="x()"><div id=hit>${long}</div><div>Pay now</div></div>`).held,
    ).toEqual(['Pay now'])
    expect(
      hit(`<div onclick="x()"><div>Pay now</div><div id=hit>${long.repeat(8)}</div></div>`).held,
    ).toEqual(['Pay now'])
  })

  test('only its first, of a row and of what only a listener round it says', () => {
    expect(
      hit('<table><tr onclick="x()"><td id=hit>Stripe</td><td>Pay now</td></tr></table>').held,
    ).toEqual(['Stripe'])
    const document = page('<div id=round><span id=hit>Home</span><div>Delete account</div></div>')
    expect(factsOf(document.querySelector('#hit'), document.querySelector('#round')!).held).toEqual(
      ['Home'],
    )
  })

  test('nothing of what is no one control, and nothing for a control', () => {
    expect(
      hit(
        '<div onclick="x()"><h3>Pay</h3><p id=hit>Open</p><a></a><button></button><button></button></div>',
      ).held,
    ).toEqual([])
    expect(hit('<button id=hit>Pay now</button>').held).toEqual([])
  })

  test('the words of its pseudo-elements, which is all some labels are', () => {
    const document = page('<div id=hit onclick="x()"></div>')
    const element = document.querySelector('#hit')!
    const view = document.defaultView!
    const native = view.getComputedStyle.bind(view)
    view.getComputedStyle = ((one: Element, pseudo?: string) => {
      const said = native(one)
      return pseudo === '::before'
        ? Object.assign(Object.create(said) as CSSStyleDeclaration, { content: '"Pay now"' })
        : said
    }) as typeof view.getComputedStyle
    expect(factsOf(element).held).toEqual(['Pay now'])
  })
})

describe('what draws its own face asks', () => {
  const on = (html: string) => {
    const element = page(html).querySelector('#hit')
    if (!element) throw new Error('no element')
    return factsOf(element)
  }

  test.each([
    ['a canvas with a handler', '<canvas id=hit onclick="x()"></canvas>'],
    ['a component with nothing readable', '<x-pay id=hit onclick="x()"></x-pay>'],
  ])('%s', (_, html) => {
    expect(on(html).opaque).toBe(true)
  })

  test.each([
    ['a canvas nothing listens to', '<canvas id=hit></canvas>'],
    ['a canvas that says what it is', '<canvas id=hit onclick="x()" aria-label="Chart"></canvas>'],
    ['an empty div with a handler', '<div id=hit onclick="x()"></div>'],
    ['a component that says', '<x-b id=hit onclick="x()">Open</x-b>'],
  ])('and not %s', (_, html) => {
    expect(on(html).opaque).toBe(false)
  })
})

describe('a dialog is its words, for the policy', () => {
  const dialog = (html: string) => pressOn(page(html)).dialog

  test('its heading and its body', () => {
    expect(
      dialog(
        '<dialog open><h2>Are you sure?</h2><p>This will delete your account.</p><button>OK</button></dialog>',
      ),
    ).toBe('Are you sure? This will delete your account.')
  })

  test('its label first', () => {
    expect(
      dialog(
        '<div role=dialog aria-label="Confirmation"><p>Pay 20.00 EUR?</p><button>OK</button></div>',
      ),
    ).toBe('Confirmation Pay 20.00 EUR?')
  })

  test('a div built as its Confirm too', () => {
    const element = page(
      '<div role=dialog aria-label="Delete it?"><div id=hit onclick="x()">Confirm</div></div>',
    ).querySelector('#hit')
    expect(factsOf(element).dialog).toBe('Delete it?')
  })

  test('its controls are no part of what it says', () => {
    expect(dialog('<dialog open><p>Are you sure?</p><button>Delete</button></dialog>')).toBe(
      'Are you sure?',
    )
  })
})

describe('a read with a secret on the way', () => {
  test('leaves out what does not show round it', () => {
    const document = page(
      '<div style="display:none">123456<div contenteditable aria-label="PIN">9876</div></div><p>after</p>',
    )
    const text = maskedText(document, [0])
    expect(text).not.toContain('123456')
    expect(text).toContain('after')
  })

  test('counts a textbox built of a div as a region', () => {
    const document = page('<div role="textbox" aria-label="PIN">123456</div><p>after</p>')
    expect(maskedText(document, [0])).not.toContain('123456')
  })
})

describe('a form that names a field after what is read of it', () => {
  const clobbered = (form: Element, names: Record<string, unknown>) => {
    for (const [name, value] of Object.entries(names)) {
      Object.defineProperty(form, name, { value, configurable: true })
    }
  }

  test('`elements` does not hide its default button', () => {
    const document = page('<form><input id=b><button>Delete account</button></form>')
    const form = document.querySelector('form') as Element
    clobbered(form, { elements: document.querySelector('#b') })
    expect(factsOf(document.querySelector('#b')).default_button).toBe('Delete account')
  })

  test('`nodeType` does not send it to its parent', () => {
    const document = page(
      '<div id=out><form onclick="pay()">Pay now<input id=h type=hidden></form></div>',
    )
    const form = document.querySelector('form') as Element
    clobbered(form, { nodeType: document.querySelector('#h') })
    expect(factsOf(form).tag).toBe('form')
    expect(factsOf(form).name).toContain('Pay now')
  })

  test.each(['getRootNode', 'closest', 'matches', 'tagName'])(
    '`%s` does not turn the walk round',
    (name) => {
      const document = page('<form><span id=hit>Open</span><input id=h></form>')
      const form = document.querySelector('form') as Element
      clobbered(form, { [name]: document.querySelector('#h') })
      expect(factsOf(document.querySelector('#hit')).name).toBe('Open')
    },
  )
})

describe('a line broken by hand', () => {
  test('is two', () => {
    const element = page(
      '<div onclick="x()"><span>Your file</span><br><span id=hit>Delete it</span></div>',
    ).querySelector('#hit')
    expect(factsOf(element).held).toEqual(['Your file', 'Delete it'])
  })
})

describe('a long dialog', () => {
  test('is read to its end', () => {
    const long = 'Please read all of this. '.repeat(12)
    const facts = pressOn(
      page(
        `<div role=dialog><p>${long}</p><p>This will permanently delete your account.</p><button>Confirm</button></div>`,
      ),
    )
    expect(facts.dialog).toContain('permanently delete')
  })
})

describe('a dialog with a field in it', () => {
  test.each([
    ['an editable region', '<div contenteditable aria-label="Password">hunter2secret</div>'],
    ['a text box by its role', '<div role=textbox aria-label="One-time code">hunter2secret</div>'],
    ['a text area', '<textarea autocomplete=cc-number>hunter2secret</textarea>'],
  ])('does not say what is in %s', (_, field) => {
    const facts = pressOn(
      page(`<div role=dialog><h2>Delete account</h2>${field}<button>Next</button></div>`),
    )
    expect(facts.dialog).toBe('Delete account')
  })

  test('tells a field in it what it says, for the Enter that submits its form', () => {
    const element = page(
      '<dialog open><p>Delete your account?</p><form><input id=hit></form></dialog>',
    ).querySelector('#hit')
    expect(factsOf(element).dialog).toBe('Delete your account?')
  })
})

describe('more fields than are described', () => {
  test('say so, as what is past them is unread', () => {
    const fields = Array.from({ length: 205 }, (_, at) => `<input name=a${String(at)}>`).join('')
    const facts = pressOn(page(`<form>${fields}<input id=card><button>Save</button></form>`))
    expect(facts as unknown as { cut: boolean }).toMatchObject({ cut: true })
  })
})
