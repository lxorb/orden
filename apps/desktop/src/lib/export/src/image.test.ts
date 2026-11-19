import { describe, expect, test } from 'vitest'
import { pagesOf, svgOf } from './image'
import { malformed } from './malformed'

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
<!--orden:toc-->
</div>
</body>
</html>
`

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
    expect(pagesOf(2400, 0)).toEqual([{ top: 0, height: 2400 }])
    expect(pagesOf(-10, 500)).toEqual([{ top: 0, height: 0 }])
  })
})

describe('the SVG the browser is handed', () => {
  const svg = svgOf(PAGE, { width: 820, height: 1240 }, '#fffdf7')

  test('is the size the note was laid out at', () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" data-theme="light" width="820" height="1240"')).toBe(
      true,
    )
    expect(svg).toContain('viewBox="0 0 820 1240"')
    expect(svg).toContain('<foreignObject width="100%" height="100%">')
    expect(svg.endsWith('</foreignObject></svg>')).toBe(true)
  })

  test('paints the paper behind the note', () => {
    expect(svg).toContain('<rect width="100%" height="100%" fill="#fffdf7" />')
    expect(svg.indexOf('<rect')).toBeLessThan(svg.indexOf('<foreignObject'))
  })

  test('escapes a colour before it reaches an attribute', () => {
    expect(svgOf('<p>x</p>', { width: 1, height: 1 }, 'red" onload="x')).toContain('fill="red&quot; onload=&quot;x"')
  })

  test('puts the document in the XHTML namespace', () => {
    expect(svg).toContain('<html xmlns="http://www.w3.org/1999/xhtml" lang="en"')
    expect(svg).not.toContain('<!doctype')
    expect(svg).not.toContain('<!DOCTYPE')
  })

  test('says the page’s scheme on the picture’s root, which is what `:root` is in there', () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" data-theme="light" ')).toBe(true)
    expect(svgOf(PAGE.replace('data-theme="light"', 'data-theme="dark"'), { width: 1, height: 1 }, '#000')).toContain(
      '<svg xmlns="http://www.w3.org/2000/svg" data-theme="dark" ',
    )
  })

  test('says no scheme for a fragment that names none', () => {
    expect(svgOf('<p>x</p>', { width: 1, height: 1 }, 'white')).not.toContain('data-theme')
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
    expect(svg).toContain('<!--orden:toc-->')
    expect(svg).toContain('#write &gt; p { margin: 0 0 1em; }')
  })

  test('names what is wrong when the markup is not well formed', () => {
    expect(malformed('<p>open')).toContain('never closed')
    expect(malformed('<p>Tom & Jerry</p>')).toContain('a bare &')
    expect(malformed('<input checked />')).toContain('bare attribute')
  })
})
