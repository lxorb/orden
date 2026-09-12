import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The diagrams a published space carries: which fences are one, what a drawing
 *  has to look like before it can be a file of its own, and what a publish sends.
 *
 *  Mermaid is not run here - it needs a browser, and the drive in
 *  apps/desktop/test/e2e/site.py is where a real drawing reaches a real page.
 *  What this holds is everything around it. */

interface World {
  /** Every file of the space, by path, and what is in it. */
  files: Record<string, string>
  /** Every blob that went up, by the name it went up under. */
  sent: Record<string, string>
  /** Which drawings the drawer refuses. */
  refuse: Set<string>
  /** What storage holds, standing in for the browser's. */
  kept: Record<string, string>
}

const world = vi.hoisted((): World => ({ files: {}, sent: {}, refuse: new Set(), kept: {} }))

vi.mock('./api', () => ({
  api: {
    putBlob: (_token: string, hash: string, type: string, bytes: ArrayBuffer) => {
      expect(type).toBe('image/svg+xml')
      world.sent[hash] = new TextDecoder().decode(bytes)
      return Promise.resolve({ hash, stored: true })
    },
  },
}))

vi.mock('./tauri', () => ({
  invoke: (command: string, args: Record<string, unknown>) => {
    if (command === 'read_tree') {
      const root = String(args.root)
      return Promise.resolve({
        name: 'space',
        path: root,
        is_dir: true,
        modified: 0,
        created: 0,
        children: Object.keys(world.files).map((path) => ({
          name: path.split('/').pop(),
          path: `${root}/${path}`,
          is_dir: false,
          modified: 0,
          created: 0,
          children: [],
        })),
      })
    }

    if (command === 'read_note') {
      const path = String(args.path).split('/').pop() ?? ''
      const held = world.files[path]
      return held === undefined ? Promise.reject(new Error('no such note')) : Promise.resolve(held)
    }

    return Promise.reject(new Error(`unexpected ${command}`))
  },
}))

vi.mock('./stored', () => ({
  stored: (key: string) => {
    const held = world.kept[key]
    return held === undefined ? null : (JSON.parse(held) as unknown)
  },
  keep: (key: string, value: string) => {
    world.kept[key] = value
    return true
  },
}))

/** Mermaid needs a browser, so the drawer is stood in for: one small SVG of the
 *  shape mermaid writes, with the scheme's own colour in it so the two schemes are
 *  different bytes the way real ones are. */
vi.mock('./diagrams', () => ({
  drawDiagram: (code: string, language: string, scheme: 'light' | 'dark') => {
    if (world.refuse.has(code)) return Promise.reject(new Error('mermaid said no'))

    return Promise.resolve(
      `<svg aria-roledescription="flowchart-v2" role="graphics-document document"` +
        ` viewBox="0 0 302.5 118" style="max-width: 302.5px;"` +
        ` xmlns="http://www.w3.org/2000/svg" width="100%" id="nib-export-1">` +
        `<style>#nib-export-1 .node rect{fill:${scheme === 'light' ? '#eee' : '#111'}}</style>` +
        `<g class="root"><text>${language}: ${code.trim()}</text></g></svg>`,
    )
  },
}))

const { asFile, diagramFences, drawnBoth, pushDiagrams } = await import('./site-diagrams')

const SPACE = '7d1f4e8c-0000-4000-8000-000000000001'
const FENCE = '```mermaid\ngraph TD\n  A --> B\n```\n'

beforeEach(() => {
  world.files = {}
  world.sent = {}
  world.refuse = new Set()
  world.kept = {}
})

describe('which fences a space has to draw', () => {
  test('is every diagram in it, once each', () => {
    const found = diagramFences([
      `# One\n\n${FENCE}`,
      // The same diagram again is the same picture: the name is the fence.
      `# Two\n\n${FENCE}`,
      '# Three\n\n```sequence\nAda->Grace: hello\n```\n',
    ])

    expect(found).toEqual([
      { language: 'mermaid', code: 'graph TD\n  A --> B' },
      { language: 'sequence', code: 'Ada->Grace: hello' },
    ])
  })

  test('is nothing in a note of prose, or of code, or of a chart', () => {
    expect(
      diagramFences([
        '# Prose\n\nNo fence at all.\n',
        '```ts\nexport const one = 1\n```\n',
        '```chart\ntype: bar\nlabels: [a]\n```\n',
      ]),
    ).toEqual([])
  })

  test('reads a fence opened in any case', () => {
    expect(diagramFences(['```Mermaid\ngraph TD\n  A --> B\n```\n'])).toEqual([
      { language: 'mermaid', code: 'graph TD\n  A --> B' },
    ])
  })
})

describe('a drawing as a file of its own', () => {
  const drawn =
    `<svg viewBox="0 0 300 120" style="max-width: 300px;" width="100%"` +
    ` xmlns="http://www.w3.org/2000/svg" id="d"><g><text>hi</text></g></svg>`

  test('has a size, because an `<img>` with none is 300 by 150', () => {
    const file = asFile(drawn) ?? ''

    expect(file).toContain('width="300"')
    expect(file).toContain('height="120"')
    expect(file).not.toContain('width="100%"')
    expect(file).not.toContain('max-width')
  })

  test('says it is an SVG, and keeps the drawing itself', () => {
    const file = asFile(drawn) ?? ''

    expect(file.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg')).toBe(true)
    expect(file).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(file).toContain('<text>hi</text>')
  })

  test('carries no script, no handler and nothing pointing outward', () => {
    const nasty =
      `<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">` +
      `<script>fetch('https://elsewhere.example')</script>` +
      `<g onload="alert(1)" onclick='alert(2)'>` +
      `<image href="https://elsewhere.example/x.png"/>` +
      `<use xlink:href="https://elsewhere.example/y.svg#a"/>` +
      `<a href="#inside">in</a></g></svg>`

    const file = asFile(nasty) ?? ''

    expect(file).not.toContain('script')
    expect(file).not.toContain('onload')
    expect(file).not.toContain('onclick')
    expect(file).not.toContain('elsewhere.example')
    // A link inside the picture is a place in the picture, and stays.
    expect(file).toContain('href="#inside"')
  })

  test('is nothing at all where there is no drawing to make a file of', () => {
    expect(asFile('')).toBeNull()
    expect(asFile('Syntax error in graph')).toBeNull()
    // No viewBox is no size, and a file with no size is the 300-by-150 box.
    expect(asFile('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>')).toBeNull()
  })
})

describe('one diagram, drawn both ways round', () => {
  test('is two pictures under two names', async () => {
    const both = await drawnBoth(SPACE, { language: 'mermaid', code: 'graph TD\n  A --> B' })

    expect(both).toHaveLength(2)
    expect(both[0]?.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(both[0]?.hash).not.toBe(both[1]?.hash)
    expect(both[0]?.svg).toContain('#eee')
    expect(both[1]?.svg).toContain('#111')
  })

  test('is neither where one of the two would not draw', async () => {
    world.refuse.add('graph TD\n  A --> B')

    expect(await drawnBoth(SPACE, { language: 'mermaid', code: 'graph TD\n  A --> B' })).toEqual([])
  })
})

describe('what a publish sends', () => {
  test('is both pictures of every diagram in the space', async () => {
    world.files = { 'One.md': `# One\n\n${FENCE}`, 'Two.md': '# Two\n\nNo diagram.\n' }

    const done = await pushDiagrams('token', SPACE, '/vault/space')

    expect(done).toEqual({ sent: 2, refused: 0 })
    expect(Object.keys(world.sent)).toHaveLength(2)
    for (const svg of Object.values(world.sent)) {
      expect(svg).toContain('<?xml version="1.0"')
      expect(svg).toContain('width="303"')
    }
  })

  test('is nothing the second time, because an unchanged diagram is the same name', async () => {
    world.files = { 'One.md': `# One\n\n${FENCE}` }

    expect((await pushDiagrams('token', SPACE, '/vault/space')).sent).toBe(2)
    world.sent = {}
    expect((await pushDiagrams('token', SPACE, '/vault/space')).sent).toBe(0)
    expect(world.sent).toEqual({})
  })

  test('is something again once a character of the diagram changes', async () => {
    world.files = { 'One.md': `# One\n\n${FENCE}` }
    await pushDiagrams('token', SPACE, '/vault/space')

    world.files = { 'One.md': '# One\n\n```mermaid\ngraph TD\n  A --> C\n```\n' }
    world.sent = {}

    expect((await pushDiagrams('token', SPACE, '/vault/space')).sent).toBe(2)
  })

  test('is nothing at all for a space with no diagram in it', async () => {
    world.files = { 'One.md': '# One\n\nProse.\n' }

    expect(await pushDiagrams('token', SPACE, '/vault/space')).toEqual({ sent: 0, refused: 0 })
  })

  test('counts a diagram mermaid refused and sends the rest', async () => {
    world.refuse.add('graph TD\n  A --> B')
    world.files = {
      'One.md': `# One\n\n${FENCE}`,
      'Two.md': '# Two\n\n```mermaid\ngraph LR\n  C --> D\n```\n',
    }

    expect(await pushDiagrams('token', SPACE, '/vault/space')).toEqual({ sent: 2, refused: 1 })
  })
})
