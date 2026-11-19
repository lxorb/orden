import { describe, expect, test } from 'vitest'
import { type Here, placeOf, withPaths } from './paths'

const ROOT = '/Users/me/Notes'
const HELD = new Set([`${ROOT}/plan.md`, `${ROOT}/Projects/roadmap.md`, `${ROOT}/Projects/cover.png`])
function here(over: Partial<Here> = {}): Here {
  return {
    root: ROOT,
    system: 'macos',
    spaces: [{ root: ROOT }],
    holds: (path) => HELD.has(path),
    opens: (path) => path.startsWith(ROOT) && path.endsWith('.md'),
    reveals: true,
    ...over,
  }
}
const linked = (html: string, over: Partial<Here> = {}) =>
  [...withPaths(html, here(over)).matchAll(/data-path="([^"]*)"/g)].map((one) => one[1])

describe('a path in an answer', () => {
  test('is marked whole when it is the whole of an inline code, with the code kept inside', () => {
    const html = withPaths('<p>Saved to <code>/Users/me/Notes/plan.md</code>.</p>', here())
    expect(html).toBe(
      '<p>Saved to <span class="chat-path" data-path="/Users/me/Notes/plan.md"><code>/Users/me/Notes/plan.md</code></span>.</p>',
    )
  })
  test('is found in plain words, without the punctuation around it', () => {
    const html = withPaths('<p>See (~/Documents/report.pdf), then /tmp/out.txt.</p>', here())
    expect(html).toBe(
      '<p>See (<span class="chat-path" data-path="~/Documents/report.pdf">~/Documents/report.pdf</span>), then ' +
        '<span class="chat-path" data-path="/tmp/out.txt">/tmp/out.txt</span>.</p>',
    )
  })
  test('relative to the space is marked only where the space holds that file', () => {
    expect(linked('<p><code>Projects/roadmap.md</code> and <code>Projects/missing.md</code></p>')).toEqual([
      'Projects/roadmap.md',
    ])
    expect(linked('<p>plan.md, ./plan.md and either/or</p>')).toEqual(['plan.md', './plan.md'])
    expect(linked('<p><code>plan.md</code></p>', { root: null })).toEqual([])
  })
  test('keeps a line it points at and a name with spaces inside code', () => {
    expect(linked('<p><code>Projects/roadmap.md:12</code> <code>/Users/me/My Files/a b.md</code></p>')).toEqual([
      'Projects/roadmap.md:12',
      '/Users/me/My Files/a b.md',
    ])
  })
  test('is written safely into the mark however it is spelled', () => {
    const html = withPaths('<p><code>/tmp/a&amp;b &#39;c&#39;.md</code></p>', here())
    expect(html).toContain('data-path="/tmp/a&#38;b &#39;c&#39;.md"')
    expect(html).toContain('<code>/tmp/a&amp;b &#39;c&#39;.md</code>')
  })
})
describe('what is not a path', () => {
  test('a web address, a link or a protocol-relative address', () => {
    expect(
      linked(
        '<p>https://example.com/a/b <a href="/tmp/x.md">/tmp/x.md</a> //cdn.example.com/x.js ' +
          'example.com/docs <code>file:///tmp/a.md</code> <code>ssh://host/tmp</code></p>',
      ),
    ).toEqual([])
  })
  test('anything in a code block, a button or maths', () => {
    expect(
      linked(
        '<pre><code>cat /Users/me/Notes/plan.md\n</code></pre><button>/tmp/a.txt</button>' +
          '<math><annotation>/tmp/b</annotation></math>',
      ),
    ).toEqual([])
  })
  test('words of code: commands, regular expressions, packages, globs, variables and sums', () => {
    expect(
      linked(
        '<p><code>/goal</code> <code>/help</code> <code>/foo/g</code> <code>@orden/contracts</code> ' +
          '<code>src/**/*.ts</code> <code>$HOME/x</code> <code>a/b</code> <code>x = a / b</code> ' +
          '<code>{a}/b</code> <code>/</code> <code>~</code> <code>~5</code> <code>../plan.md</code> ' +
          '<code>cat /tmp/a.txt</code> 1/2 km/h and/or #tag/plan.md</p>',
      ),
    ).toEqual([])
  })
  test('a path of another system', () => {
    expect(linked('<p><code>C:\\Users\\me\\a.md</code></p>')).toEqual([])
    expect(linked('<p><code>C:\\Users\\me\\a.md</code> \\\\server\\share\\a.md</p>', { system: 'windows' })).toEqual([
      'C:\\Users\\me\\a.md',
      '\\\\server\\share\\a.md',
    ])
    expect(linked('<p><code>/Users/me/Notes/plan.md</code></p>', { system: 'windows' })).toEqual([])
  })
  test('where nothing can show a folder, only what Orden opens from a space', () => {
    const over = { reveals: false }
    expect(linked('<p><code>/Users/me/Notes/plan.md</code> /tmp/a.txt ~/a.md</p>', over)).toEqual([
      '/Users/me/Notes/plan.md',
    ])
    expect(linked('<p><code>Projects/cover.png</code> <code>plan.md</code></p>', over)).toEqual(['plan.md'])
  })
})
describe('the place a path is at', () => {
  test('is the path itself, under home, or inside the space, without the line', () => {
    const at = { root: ROOT, system: 'macos' }
    expect(placeOf('/tmp/a.txt:3:9', at, '/Users/me')).toBe('/tmp/a.txt')
    expect(placeOf('~/Documents/a.pdf', at, '/Users/me')).toBe('/Users/me/Documents/a.pdf')
    expect(placeOf('~/a.pdf', at, null)).toBeNull()
    expect(placeOf('./Projects/roadmap.md', at, null)).toBe(`${ROOT}/Projects/roadmap.md`)
    expect(placeOf('Projects\\roadmap.md', { root: 'C:\\Notes', system: 'windows' }, null)).toBe(
      'C:\\Notes\\Projects\\roadmap.md',
    )
    expect(placeOf('~\\Desktop\\a.txt', { root: null, system: 'windows' }, 'C:\\Users\\me')).toBe(
      'C:\\Users\\me\\Desktop\\a.txt',
    )
    expect(placeOf('https://example.com/a', at, null)).toBeNull()
  })
})
