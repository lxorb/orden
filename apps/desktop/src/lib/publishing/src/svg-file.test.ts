import { describe, expect, test } from 'vitest'
import { shapesOnly } from './svg-file'

const drawing = (inner: string) =>
  `<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`

describe('a handler', () => {
  test('goes, in double quotes, in single quotes and in none', () => {
    for (const said of ['onload="run()"', "onload='run()'", 'onload=run()']) {
      const out = shapesOnly(drawing(`<g ${said}><rect/></g>`))

      expect(out, said).not.toContain('onload')
      expect(out, said).not.toContain('run()')
      expect(out, said).toContain('<rect/>')
    }
  })

  test('goes whatever it is called', () => {
    const out = shapesOnly(drawing('<circle onmouseover="a" ONCLICK="b" onfocusin="c" r="4"/>'))

    expect(out).toBe(drawing('<circle r="4"/>'))
  })
})

describe('a target outside the picture', () => {
  test('goes, in every way of writing an attribute', () => {
    for (const said of [
      'href="https://elsewhere.example/x"',
      "href='https://elsewhere.example/x'",
      'href=https://elsewhere.example/x',
      'xlink:href="https://elsewhere.example/x"',
      "xlink:href='https://elsewhere.example/x'",
      'xlink:href=https://elsewhere.example/x',
    ]) {
      const out = shapesOnly(drawing(`<a ${said}>words</a>`))

      expect(out, said).not.toContain('elsewhere.example')
      expect(out, said).toContain('words')
    }
  })

  test('while a place in the picture stays', () => {
    expect(shapesOnly(drawing('<a href="#inside">in</a>'))).toBe(
      drawing('<a href="#inside">in</a>'),
    )
    expect(shapesOnly(drawing('<path fill="url(#grad)" d="M0 0"/>'))).toContain('url(#grad)')
  })
})

describe('an element that is not a shape', () => {
  test('goes, and takes what is inside it', () => {
    for (const [name, said] of [
      ['script', "<script>fetch('https://elsewhere.example')</script>"],
      ['image', '<image href="https://elsewhere.example/x.png"/>'],
      ['use', '<use xlink:href="https://elsewhere.example/y.svg#a"/>'],
      ['foreignObject', '<foreignObject><div>a page of HTML</div></foreignObject>'],
      ['iframe', '<iframe src="https://elsewhere.example"></iframe>'],
      ['animate', '<animate attributeName="href" to="https://elsewhere.example"/>'],
      ['animateTransform', '<animateTransform attributeName="transform" to="1"/>'],
      ['set', '<set attributeName="href" to="https://elsewhere.example"/>'],
      ['filter', '<filter id="f"><feImage href="https://elsewhere.example/x"/></filter>'],
      ['symbol', '<symbol id="s"><rect/></symbol>'],
    ] as const) {
      const out = shapesOnly(drawing(said))

      expect(out, name).toBe(drawing(''))
    }
  })

  test('and a `<script>` that closes itself oddly leaves nothing behind', () => {
    const out = shapesOnly(drawing('<script >run()</script  >'))
    expect(out).not.toContain('run()')
    expect(out).not.toContain('script')
  })

  test('and one nobody closed takes the rest of the drawing with it', () => {
    const out = shapesOnly('<svg viewBox="0 0 10 10"><foreignObject><b>x')
    expect(out).toBe('<svg viewBox="0 0 10 10">')
  })
})

describe('the drawing itself', () => {
  test('comes through as it was written', () => {
    const drawn =
      '<svg viewBox="0 0 300 120" width="100%" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><marker id="arrow" orient="auto"><path d="M0 0 5 5"/></marker>' +
      '<linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>' +
      '<style>.node { fill: #eee; }</style>' +
      '<g class="node" transform="translate(4,4)"><rect x="0" y="0" width="8" height="8"/>' +
      '<text x="2" y="6" text-anchor="middle">hi<tspan dy="2">there</tspan></text></g></svg>'

    expect(shapesOnly(drawn)).toBe(drawn)
  })

  test('and a `>` inside an attribute does not end a tag', () => {
    const out = shapesOnly(drawing('<text font-family="a>b" onload="x">hi</text>'))

    expect(out).toBe(drawing('<text font-family="a>b">hi</text>'))
  })

  test('and a name written the way SVG writes it stays that way', () => {
    const drawn = drawing(
      '<defs><linearGradient id="g"><stop offset="0"/></linearGradient>' +
        '<clipPath id="c"><rect/></clipPath></defs>' +
        '<text><textPath href="#p" startOffset="4">hi</textPath></text>',
    )

    expect(shapesOnly(drawn)).toBe(drawn)
  })

  test('while a comment, a doctype and an instruction say nothing worth keeping', () => {
    const out = shapesOnly(
      '<svg viewBox="0 0 10 10"><!-- drawn by mermaid --><?xml-stylesheet href="x"?><rect/></svg>',
    )

    expect(out).toBe('<svg viewBox="0 0 10 10"><rect/></svg>')
  })
})
