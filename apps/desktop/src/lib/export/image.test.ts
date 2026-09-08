/** The two halves of the picture export that can be reasoned about: how a long
 *  note is cut into pages, and the SVG the browser is handed.
 *
 *  The canvas itself is not here. Node has no canvas and no `foreignObject`, and
 *  a stub of either would only prove that the stub agrees with the code; the
 *  drawing is covered end to end in a browser instead. What is left is worth
 *  testing on its own, because both of the ways this export fails are in it: the
 *  arithmetic decides how many files the person ends up with, and markup that is
 *  not well-formed XML makes the whole SVG fail to parse without a word, leaving
 *  a blank picture and nothing to read. */

import { describe, expect, test } from 'vitest'
import { pagesOf, svgOf } from './image'

/** A complete, self-contained document, which is the only kind `toImages` takes:
 *  the stylesheet inline, the picture a `data:` URI, nothing fetched. */
const PAGE = `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<title>Handbook &amp; friends</title>
<style>
#write { max-width: 40em; }
#write > p { margin: 0 0 1em; }
</style>
</head>
<body>
<div id="write">
<h1 id="handbook">Handbook</h1>
<p>Guard: a &lt; b &amp;&amp; c &gt; d</p>
<p><input checked disabled type="checkbox"> done</p>
<p><img src="data:image/png;base64,iVBORw0KGgo=" alt="One"></p>
<!--nib:toc-->
</div>
</body>
</html>
`

// The five names XML defines by itself, plus any number. Anything else needs a
// DTD, which a `foreignObject` has not got.
const REFERENCE = /&(?:#\d+|#x[0-9a-fA-F]+|amp|lt|gt|quot|apos);/y
const CLOSE_TAG = /<\/([^\s>]+)\s*>/y
const OPEN_TAG = /<([A-Za-z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/y
const ATTRIBUTE = /\s+([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g

function strayReference(text: string): string | null {
  for (let at = text.indexOf('&'); at >= 0; at = text.indexOf('&', at + 1)) {
    REFERENCE.lastIndex = at
    if (!REFERENCE.test(text)) return `a bare & at ${JSON.stringify(text.slice(at, at + 24))}`
  }

  return null
}

function badAttributes(source: string): string | null {
  const seen = new Set<string>()

  for (const found of source.matchAll(ATTRIBUTE)) {
    const name = found[1] ?? ''
    const value = found[2]

    if (value === undefined) return `the bare attribute ${name}`
    if (!value.startsWith('"')) return `an unquoted value on ${name}`
    if (seen.has(name)) return `${name} written twice`
    seen.add(name)

    const stray = strayReference(value)
    if (stray) return `${stray} in ${name}`
  }

  return source.replace(ATTRIBUTE, '').trim() === ''
    ? null
    : `something that is not an attribute in ${JSON.stringify(source)}`
}

/** Everything that has to be true for an XML parser to take the markup. Null
 *  means well formed; anything else names what is wrong.
 *
 *  The same scanner as `epub.test.ts`, written out again rather than shared:
 *  importing one test file into another registers its whole suite a second
 *  time. */
function malformed(xml: string): string | null {
  const open: string[] = []
  let at = 0

  while (at < xml.length) {
    const next = xml.indexOf('<', at)
    const stray = strayReference(xml.slice(at, next < 0 ? xml.length : next))
    if (stray) return stray
    if (next < 0) break

    if (xml.startsWith('<!--', next)) {
      const end = xml.indexOf('-->', next + 4)
      if (end < 0) return 'a comment that never ends'

      const inner = xml.slice(next + 4, end)
      if (inner.includes('--') || inner.endsWith('-')) return `a comment XML forbids: ${inner}`
      at = end + 3
      continue
    }

    if (xml.startsWith('<!', next) || xml.startsWith('<?', next)) {
      const end = xml.indexOf('>', next)
      if (end < 0) return 'a declaration that never ends'
      at = end + 1
      continue
    }

    CLOSE_TAG.lastIndex = next
    const close = CLOSE_TAG.exec(xml)
    if (close) {
      const name = close[1] ?? ''
      if (open.pop() !== name) return `</${name}> closes nothing that is open`
      at = CLOSE_TAG.lastIndex
      continue
    }

    OPEN_TAG.lastIndex = next
    const found = OPEN_TAG.exec(xml)
    const name = found?.[1]
    if (name === undefined) {
      return `a < that starts no tag: ${JSON.stringify(xml.slice(next, next + 40))}`
    }

    const bad = badAttributes(found?.[2] ?? '')
    if (bad) return `${bad} on <${name}>`
    if (found?.[3] !== '/') open.push(name)
    at = OPEN_TAG.lastIndex
  }

  return open.length ? `<${open.join('>, <')}> never closed` : null
}

describe('the pages a note comes to', () => {
  test('is one picture of the whole note when nothing says to cut it', () => {
    expect(pagesOf(2400, null)).toEqual([{ top: 0, height: 2400 }])
    expect(pagesOf(2400, undefined)).toEqual([{ top: 0, height: 2400 }])
  })

  test('cuts into equal pages, and a shorter last one', () => {
    expect(pagesOf(2500, 1000)).toEqual([
      { top: 0, height: 1000 },
      { top: 1000, height: 1000 },
      { top: 2000, height: 500 },
    ])
  })

  test('cuts evenly when the note happens to divide', () => {
    expect(pagesOf(3000, 1000)).toEqual([
      { top: 0, height: 1000 },
      { top: 1000, height: 1000 },
      { top: 2000, height: 1000 },
    ])
  })

  test('is one page for a note shorter than one', () => {
    expect(pagesOf(400, 1000)).toEqual([{ top: 0, height: 400 }])
    expect(pagesOf(1000, 1000)).toEqual([{ top: 0, height: 1000 }])
  })

  test('is still a page when there is nothing to show', () => {
    expect(pagesOf(0, 1000)).toEqual([{ top: 0, height: 0 }])
    expect(pagesOf(0, null)).toEqual([{ top: 0, height: 0 }])
    // A height no page could be filled to would otherwise divide forever.
    expect(pagesOf(2400, 0)).toEqual([{ top: 0, height: 2400 }])
    expect(pagesOf(-10, 500)).toEqual([{ top: 0, height: 0 }])
  })
})

describe('the SVG the browser is handed', () => {
  const svg = svgOf(PAGE, { width: 820, height: 1240 }, '#fffdf7')

  test('is the size the note was laid out at', () => {
    expect(
      svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="820" height="1240"'),
    ).toBe(true)
    expect(svg).toContain('viewBox="0 0 820 1240"')
    expect(svg).toContain('<foreignObject width="100%" height="100%">')
    expect(svg.endsWith('</foreignObject></svg>')).toBe(true)
  })

  test('paints the paper behind the note', () => {
    expect(svg).toContain('<rect width="100%" height="100%" fill="#fffdf7" />')
    expect(svg.indexOf('<rect')).toBeLessThan(svg.indexOf('<foreignObject'))
  })

  test('escapes a colour before it reaches an attribute', () => {
    expect(svgOf('<p>x</p>', { width: 1, height: 1 }, 'red" onload="x')).toContain(
      'fill="red&quot; onload=&quot;x"',
    )
  })

  test('puts the document in the XHTML namespace', () => {
    // Inside a foreignObject the default namespace is SVG's, and an <html> that
    // does not say otherwise draws nothing at all.
    expect(svg).toContain('<html xmlns="http://www.w3.org/1999/xhtml" lang="en"')
    expect(svg).not.toContain('<!doctype')
    expect(svg).not.toContain('<!DOCTYPE')
  })

  test('wraps a fragment rather than leaving it out of any namespace', () => {
    expect(svgOf('<p>x</p>', { width: 1, height: 1 }, 'white')).toContain(
      '<div xmlns="http://www.w3.org/1999/xhtml"><p>x</p></div>',
    )
  })

  test('is XML a parser will take', () => {
    expect(malformed(svg)).toBe(null)
  })

  test('brings the note through as the same markup, only well formed', () => {
    expect(svg).toContain('<input checked="checked" disabled="disabled" type="checkbox" />')
    expect(svg).toContain('<img src="data:image/png;base64,iVBORw0KGgo=" alt="One" />')
    expect(svg).toContain('Guard: a &lt; b &amp;&amp; c &gt; d')
    expect(svg).toContain('<!--nib:toc-->')
    // The stylesheet travels as text, so its `>` comes back a `>` when the
    // parser hands the document over and no CDATA section is needed.
    expect(svg).toContain('#write &gt; p { margin: 0 0 1em; }')
  })

  test('names what is wrong when the markup is not well formed', () => {
    expect(malformed('<p>open')).toContain('never closed')
    expect(malformed('<p>Tom & Jerry</p>')).toContain('a bare &')
    expect(malformed('<input checked />')).toContain('bare attribute')
  })
})
