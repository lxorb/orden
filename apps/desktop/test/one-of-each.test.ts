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

/** What a rule sets `outline` to, once each. Read as values rather than matched
 *  in one expression, because `outline: none` and `outline: 2px solid X` differ
 *  only in the value and a lookahead over optional whitespace will happily
 *  backtrack its way past the difference. `outline-offset` is not an outline. */
function outlines(declarations: string): string[] {
  return [...declarations.matchAll(/(?:^|;)\s*outline\s*:\s*([^;]+)/g)].map((one) =>
    (one[1] ?? '').trim(),
  )
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

/** The row every list in the app is made of. Six components had a copy of it -
 *  the tree, the bookmarks, the outline, the tags, a search hit, a backlink -
 *  with three hover colours and four heights between them, and then each of the
 *  six said it again under `[data-touch]`. See docs/design.md. */
describe('the row a list is made of', () => {
  test('is drawn in the themes package and nowhere else', () => {
    const shared = readFileSync(join(THEMES, 'base.css'), 'utf8')
    expect(shared).toContain('.nib-row')
    // The class itself, not the parts named after it: a component may say how
    // wide its own label is in the row it sits in.
    expect(draw(/\.nib-row(?![\w-])/)).toEqual([])
  })

  test('and no list paints a hover or a press of its own', () => {
    const own = components
      .filter((one) =>
        rules(one.style).some(
          // The state has to be the row's own: `.row .primary:hover` is a
          // button inside a row and draws itself, which is its business.
          (rule) =>
            /\.(row|hit|item|entry)\b[^\s>+~,]*:(hover|active)/.test(rule.selector) &&
            /(^|;|\s)background(-color)?\s*:/.test(rule.declarations),
        ),
      )
      .map((one) => one.name)
      .sort()

    // The settings sheet is a sheet of cards rather than a list of names: its
    // rows are settings, and what they light is the card they sit in.
    expect(own).toEqual(['lib/SettingsPanel.svelte'])
  })

  test('and the row every list wears is the one in the themes package', () => {
    const shared = readFileSync(join(THEMES, 'base.css'), 'utf8')

    for (const state of ['.nib-row.is-on', '.nib-row.is-picked', '.nib-row:active']) {
      expect(shared, `${state} is not stated`).toContain(state)
    }
  })

  test('and the lists wear the class rather than a row of their own', () => {
    const lists = [
      'lib/AppMenu.svelte',
      'lib/Bookmarks.svelte',
      'lib/ContextMenu.svelte',
      'lib/Links.svelte',
      'lib/Palette.svelte',
      'lib/SearchPanel.svelte',
      'lib/Sidebar.svelte',
      'lib/TagTree.svelte',
      'lib/Tree.svelte',
    ]

    const missing = lists.filter(
      (name) => !components.find((one) => one.name === name)?.text.includes('nib-row'),
    )

    expect(missing, `these draw a list without the row: ${missing.join(', ')}`).toEqual([])
  })
})

/** The ring that says where the keyboard is. Thirty rules had their own copy of
 *  the same two lines - one row, one bar, one tab, one pill, one segment, eight
 *  buttons on the plane - which is thirty chances for one of them to be a
 *  different thickness or a different colour, and for the app to read as several
 *  apps again the moment somebody is navigating it by key. See docs/keyboard.md. */
describe('the ring a keyboard leaves', () => {
  test('is one token, and one rule that uses it', () => {
    const tokens = readFileSync(join(THEMES, 'tokens.css'), 'utf8')
    const shared = readFileSync(join(THEMES, 'base.css'), 'utf8')

    expect(tokens).toContain('--focus-ring:')
    expect(tokens).toContain('--focus-ring-offset:')
    expect(shared).toContain('outline: var(--focus-ring)')
  })

  test('and no component draws one of its own', () => {
    // A component may still say where the ring sits - `outline-offset` on a
    // control that has room around it - and may turn it off where its own shape
    // says it another way. What it may not do is state the ring again.
    const own = components
      .filter((one) =>
        rules(one.style).some(
          (rule) =>
            rule.selector.includes(':focus') &&
            outlines(rule.declarations).some(
              (value) => value !== 'none' && !value.startsWith('var(--focus-ring)'),
            ),
        ),
      )
      .map((one) => one.name)
      .sort()

    expect(own, `these draw their own focus ring: ${own.join(', ')}`).toEqual([])
  })

  test('and is left for a keyboard, never drawn on a plain focus', () => {
    // `:focus` fires on a click as well, and a ring that appears when a button is
    // pressed with the mouse is the thing every app gets wrong. `:focus-visible`
    // is the browser's own answer to which of the two it was.
    const early = components
      .filter((one) =>
        rules(one.style).some(
          (rule) =>
            /:focus(?![-\w])/.test(rule.selector) &&
            !rule.selector.includes(':focus-visible') &&
            outlines(rule.declarations).some((value) => value !== 'none'),
        ),
      )
      .map((one) => one.name)
      .sort()

    expect(early, `these ring a click as well as a key: ${early.join(', ')}`).toEqual([])
  })
})

/** The rounded square in front of a name that belongs to somebody or somewhere:
 *  a space's mark in the switcher, the face in the panel's foot, a person in the
 *  Share sheet. Two components had the same nine lines of it, and the sheet would
 *  have been a third. See docs/design.md. */
describe('the badge in front of a name', () => {
  test('is drawn in the themes package and nowhere else', () => {
    const shared = readFileSync(join(THEMES, 'base.css'), 'utf8')

    expect(shared).toContain('.nib-badge')
    expect(draw(/\.nib-badge/)).toEqual([])
  })

  test('and the surfaces that show one wear the class', () => {
    const wearing = components
      .filter((one) => one.text.includes('class="nib-badge'))
      .map((one) => one.name)
      .sort()

    expect(wearing).toEqual([
      'lib/ShareSheet.svelte',
      'lib/Sheet.svelte',
      'lib/SidebarFoot.svelte',
      'lib/SpaceSwitcher.svelte',
      // The space named in the bar while the list is shut, which is the same
      // space wearing the same badge it wears on its row in the switcher.
      'lib/Titlebar.svelte',
    ])
  })

  /** What goes inside it is one component too: the drawing a space was given, or
   *  the first letter of its name until it has one. */
  test('and what a space puts in it is asked for once', () => {
    const asking = components
      .filter((one) => one.text.includes('<SpaceMark '))
      .map((one) => one.name)
      .sort()

    expect(asking).toEqual([
      // The Move sheet, whose rows are the notes of the space and then the spaces
      // themselves: a space wears its own mark there rather than a note's, in the
      // box a note's mark sits in. See move-targets.ts and docs/tree.md.
      'lib/PromptSheet.svelte',
      'lib/PublishSheet.svelte',
      'lib/ShareSheet.svelte',
      'lib/SpaceSwitcher.svelte',
      'lib/Titlebar.svelte',
    ])
  })
})

/** One thing that is on or off. Two panels had the same thirty lines of track and
 *  knob - a setting, an assistant's write access - and the Share sheet's link
 *  would have been a third. `.toggle` is not the signal: the button that opens the
 *  drawer is called that and is not a switch. */
describe('the switch', () => {
  test('is drawn in the themes package and nowhere else', () => {
    const shared = readFileSync(join(THEMES, 'base.css'), 'utf8')

    expect(shared).toContain('.nib-switch')
    // Including what a finger makes of it, which is one block there rather than
    // one per surface; see touch-scale.test.ts.
    expect(shared).toContain('[data-touch] .nib-switch')
    expect(draw(/nib-switch/)).toEqual([])
  })

  test('and every surface that has one wears the class', () => {
    const wearing = components
      .filter((one) => one.text.includes('nib-switch'))
      .map((one) => one.name)
      .sort()

    expect(wearing).toEqual([
      'lib/GraphControls.svelte',
      'lib/McpSetup.svelte',
      'lib/SettingsPanel.svelte',
      'lib/ShareSheet.svelte',
    ])
  })
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

/** Changing what a surface shows is a move, and there is one way to make it.
 *  Before this, four panel tabs switched between two frames and a settings pane
 *  had a fly of its own with its own numbers written into the component. See
 *  docs/design.md, "Swapping". */
describe('how a surface swaps what it is showing', () => {
  const slide = readFileSync(join(SOURCE, 'lib/slide.ts'), 'utf8')

  test('is one module, and it moves nothing but a transform and an opacity', () => {
    expect(slide).toContain('export function arrive')
    expect(slide).toContain('export function leave')
    expect(slide).toContain('export function segmented')

    // What a transition hands the browser, and what the sliding surface writes.
    const moved = [...slide.matchAll(/(?:css: \(t, u\) =>|thumb\.style\.)(\w+)/g)].map(
      (one) => one[1],
    )
    for (const property of moved) {
      expect(['opacity', 'transform', 'width', 'height', 'transition'], property).toContain(
        property,
      )
    }
    // Width and height are the surface being laid out at the size of a half,
    // once; what changes as the choice moves is the transform.
    expect(slide).toContain('thumb.style.transform = `translate(')
    expect(slide).toContain('transform: translateY(')
  })

  test('and its durations come through the one place reduced motion is answered', () => {
    expect(slide).toContain("from './motion'")
    expect(slide).toContain('duration: dur(ms)')
  })

  /** The surface belongs to the control, so it is drawn with the control. */
  test('the sliding surface is drawn in the themes package and nowhere else', () => {
    const shared = readFileSync(join(THEMES, 'base.css'), 'utf8')

    expect(shared).toContain('.nib-segmented-thumb')
    expect(draw(/\.nib-segmented-thumb/)).toEqual([])
  })

  /** Every groove gets the same one. The canvas is out: its two controls are
   *  part of a floating bar with its own life. */
  test('and every segmented control in the shell asks for it', () => {
    const without = components
      .filter((one) => one.text.includes('class="nib-segmented"'))
      .filter((one) => !one.text.includes('use:segmented'))
      .map((one) => one.name)
      .sort()

    expect(without).toEqual(['lib/CanvasCatch.svelte', 'lib/CanvasRub.svelte'])
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

/** The card a sentence appears in: behind the `i` after a setting's name, and
 *  under a name that cannot be written. Two surfaces, one shape, and the only
 *  part either of them states for itself is where it sits. */
describe('the bubble a sentence appears in', () => {
  test('is drawn in the themes package and nowhere else', () => {
    const shared = readFileSync(join(THEMES, 'base.css'), 'utf8')
    expect(shared).toContain('.nib-bubble')
    expect(draw(/\.nib-bubble/)).toEqual([])
  })

  test('and the two that show one wear the class rather than a card of their own', () => {
    const own = components
      .filter((one) => one.text.includes('nib-bubble'))
      .map((one) => one.name)
      .sort()

    expect(own).toEqual(['lib/Hint.svelte', 'lib/NameField.svelte'])
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
