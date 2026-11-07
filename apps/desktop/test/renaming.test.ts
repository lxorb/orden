import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { render } from 'svelte/server'
import NameField from '../src/lib/NameField.svelte'

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))
const THEMES = fileURLToPath(new URL('../../../packages/themes/src/', import.meta.url))

const read = (name: string) => readFileSync(`${SOURCE}${name}`, 'utf8')

function componentFiles(dir: string): string[] {
  const out: string[] = []

  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...componentFiles(path))
    else if (name.endsWith('.svelte')) out.push(path.slice(SOURCE.length).split('\\').join('/'))
  }

  return out
}

const components = componentFiles(SOURCE)

const tree = read('lib/Tree.svelte')
const switcher = read('lib/SpaceSwitcher.svelte')
const shared = readFileSync(`${THEMES}base.css`, 'utf8')

const naming = tree.slice(
  tree.indexOf('{#if named?.path === entry.path}'),
  tree.indexOf('{:else if own}'),
)

describe('the row a name is being typed on', () => {
  test('is found by this test at all', () => {
    expect(naming).toContain('<NameField')
  })

  test('is the same row it was a moment ago', () => {
    for (const part of [
      'class="orden-row row"',
      '<FileMark mark={markOf(entry, own)} path={markPath(entry, own)} />',
      'style:--level={depth}',
      'class:is-on=',
      'class:is-picked=',
    ]) {
      expect(naming, part).toContain(part)
    }
  })

  test('and draws no field of its own', () => {
    expect(naming).not.toContain('<input')
    expect(tree).not.toContain('<input')
    const style = tree.slice(tree.indexOf('<style>'))
    expect(style).not.toContain('.rename')
    expect(style).not.toContain('border: 1px solid var(--accent)')
  })

  test('and a folder keeps the rows it discloses', () => {
    expect([...tree.matchAll(/\{#if entry\.is_dir && workspace\.isExpanded/g)]).toHaveLength(0)
    expect(tree).toContain('flatRows(tree, isOpen)')
  })

  test('and the list is keyed by row id, so a fresh listing or a rename does not remake it', () => {
    expect(tree).toContain('{#each drawn as one (slots.get(one.id) ?? one.id)}')
    expect(tree).toContain('drawn.map((one) => one.id)')
  })

  test('and the row being named is held in the page wherever the scroll is', () => {
    expect(tree).toContain('[pathAt(workspace.naming?.path), idAt(standing), idAt(reaching)]')
  })

  test('and is the same element whether it is held or in the window', () => {
    expect([...tree.matchAll(/\{#each drawn as/g)]).toHaveLength(1)
    expect(tree).toContain('class:away={one.away}')
  })
})

describe('the field that renames', () => {
  test('is asked for by the list and by the header over it, and by nothing else', () => {
    expect(components.length).toBeGreaterThan(30)

    const asking = components.filter((name) => read(name).includes('<NameField')).sort()
    const knowing = components.filter((name) => read(name).includes('workspace.naming')).sort()

    expect(asking).toEqual(['lib/SpaceSwitcher.svelte', 'lib/Tree.svelte'])
    expect(knowing).toEqual(['App.svelte', ...asking])
  })

  test('and the space renames in place too, rather than in a sheet', () => {
    expect(switcher).toContain('workspace.naming?.path === here.root')
    const header = switcher.slice(switcher.indexOf('workspace.naming?.path === here.root'))
    expect(header.slice(0, header.indexOf('{:else}'))).toContain('class="chevron"')
  })

  test('and a name that cannot be written is a red hairline, drawn in the themes', () => {
    expect(shared).toContain('.is-wrong')
    expect(shared.slice(shared.indexOf('.is-wrong'))).toContain('var(--danger)')

    for (const [name, text] of [
      ['lib/Tree.svelte', tree],
      ['lib/SpaceSwitcher.svelte', switcher],
    ] as const) {
      expect(text, name).toContain('class:is-wrong={wrong}')
      expect(text, name).toContain('bind:wrong')
    }
  })
})

describe('what the field draws', () => {
  const draw = (props: Record<string, unknown>) =>
    render(NameField, {
      props: { value: 'Plan', oncommit: () => undefined, oncancel: () => undefined, ...props },
    }).body

  test('the name it was given, in a field with a name of its own for a reader', () => {
    const body = draw({})
    expect(body).toContain('value="Plan"')
    expect(body).toContain('aria-label="Name"')
    expect(body).toContain('spellcheck="false"')
  })

  test('and never the browser tooltip, which a finger never sees', () => {
    expect(draw({})).not.toMatch(/\btitle=/)
  })

  test('nothing at all about a name that can be written', () => {
    expect(draw({})).not.toContain('orden-bubble')
  })

  test('and the reason a name cannot be, in the shared bubble', () => {
    const body = draw({ value: 'Work/Plan' })
    expect(body).toContain('orden-bubble')
    expect(body).toContain('A name cannot hold a slash')
  })

  test('while an empty field is a name nobody has finished, not a mistake', () => {
    expect(draw({ value: '' })).not.toContain('orden-bubble')
  })

  test('and a name already taken says so', () => {
    expect(draw({ value: 'Beta', extension: '.md', taken: ['Beta.md'] })).toContain(
      'That name is taken',
    )
  })
})

describe('the keys the field takes', () => {
  const field = read('lib/NameField.svelte')

  test('Enter writes the name, Escape puts it back, and so does clicking away', () => {
    expect(field).toContain("if (event.key === 'Enter')")
    expect(field).toContain("} else if (event.key === 'Escape') {")
    expect(field).toContain('onblur={leave}')
  })

  test('and Tab is swallowed', () => {
    const tab = field.slice(field.indexOf("event.key === 'Tab'"))
    expect(tab.slice(0, tab.indexOf('}'))).toContain('event.preventDefault()')
  })

  test('and the name arrives selected without its extension', () => {
    expect(field).toContain('if (appending) return caretAtEnd(node)')
    expect(field).toContain('return carries ? selectStem(node) : selectAll(node)')
  })
})
