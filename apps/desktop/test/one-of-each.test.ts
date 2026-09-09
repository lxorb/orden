import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** One shape, one place.
 *
 *  Three panels had their own copy of the same segmented control, two had their
 *  own copy of a value beside a copy button, and two counted their own seconds
 *  before the button stopped saying Copied. Each of those is one design with
 *  more than one answer, and the answers drift. So: the shapes that more than one
 *  surface wants live in the themes package or in a component of their own, and
 *  this is what says so if a fourth copy ever appears.
 *
 *  The rule is about duplication, not about where a class may be named: a
 *  component may lay out a shared shape - how wide it is in the row it sits in -
 *  as long as it does not draw it again. */

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))
const THEMES = fileURLToPath(new URL('../../../packages/themes/src/', import.meta.url))

function componentFiles(dir: string): string[] {
  const out: string[] = []

  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...componentFiles(path))
    else if (name.endsWith('.svelte')) out.push(path)
  }

  return out
}

interface Component {
  name: string
  text: string
  style: string
}

const components: Component[] = componentFiles(SOURCE).map((path) => {
  const text = readFileSync(path, 'utf8')
  return {
    name: path.slice(SOURCE.length).replace(/\\/g, '/'),
    text,
    style: [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((one) => one[1]).join('\n'),
  }
})

/** Every innermost rule of a stylesheet, as its selector and what it declares.
 *  Comments go first: a rule reads whatever came before it as part of its
 *  selector, and a comment naming a class would read as a rule about it. */
function rules(style: string): { selector: string; declarations: string }[] {
  const said = style.replace(/\/\*[\s\S]*?\*\//g, '')

  return [...said.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((one) => ({
    selector: (one[1] ?? '').trim(),
    declarations: (one[2] ?? '').trim(),
  }))
}

/** Which components draw a shape rather than merely place it: a rule about it
 *  that sets more than where it sits. */
function draw(named: RegExp): string[] {
  const laying = /^(flex|width|max-width|min-width|margin|grid-area|align-self|order)$/

  return components
    .filter((one) =>
      rules(one.style)
        .filter((rule) => named.test(rule.selector))
        .some((rule) =>
          rule.declarations
            .split(';')
            .map((line) => line.split(':')[0]?.trim() ?? '')
            .filter(Boolean)
            .some((property) => !laying.test(property)),
        ),
    )
    .map((one) => one.name)
}

test('the scan finds the components', () => {
  expect(components.length).toBeGreaterThan(30)
})

describe('the segmented control', () => {
  test('is drawn in the themes package and nowhere else', () => {
    const shared = readFileSync(join(THEMES, 'base.css'), 'utf8')
    expect(shared).toContain('.nib-segmented')
    expect(draw(/\.nib-segmented|\.segmented\b/)).toEqual([])
  })

  test('is the class every one of them wears', () => {
    const own = components
      .filter((one) => one.text.includes('class="segmented"'))
      .map((one) => one.name)
    expect(own).toEqual([])
  })
})

describe('a value beside its copy button', () => {
  test('is one component', () => {
    expect(draw(/\.copyable/)).toEqual(['lib/Copyable.svelte'])
  })

  test('and the button is another, which is the only thing that copies', () => {
    expect(draw(/\.copy\b/)).toEqual(['lib/CopyButton.svelte'])
  })
})

/** The `i` after a label, and the sentence behind it. A settings pane with two
 *  ways of explaining a setting is a pane where half the explanations arrive
 *  late, in the system's font, and never under a finger. */
describe('the sentence behind a setting', () => {
  test('is one component, so it is one bubble in one place', () => {
    expect(draw(/\.explain\b|\.sentence\b/)).toEqual(['lib/Hint.svelte'])
  })

  test('and the panel asks for it rather than drawing its own', () => {
    const own = components
      .filter((one) => /<Hint\b/.test(one.text))
      .map((one) => one.name)
      .sort()

    expect(own).toEqual(['lib/SettingsPanel.svelte'])
  })
})

describe('saying Copied for a moment', () => {
  test('happens in one place, so it is one length of a moment', () => {
    const says = components.filter((one) => one.text.includes("t('Copied')")).map((one) => one.name)
    expect(says).toEqual(['lib/CopyButton.svelte'])
  })
})
