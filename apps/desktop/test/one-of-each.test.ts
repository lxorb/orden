import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

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

function rules(style: string): { selector: string; declarations: string }[] {
  const said = style.replace(/\/\*[\s\S]*?\*\//g, '')

  return [...said.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((one) => ({
    selector: (one[1] ?? '').trim(),
    declarations: (one[2] ?? '').trim(),
  }))
}

function valuesOf(declarations: string, property: string): string[] {
  const reading = new RegExp(String.raw`(?:^|;)\s*${property}\s*:\s*([^;]+)`, 'g')

  return [...declarations.matchAll(reading)].map((one) => (one[1] ?? '').trim())
}

function outlines(declarations: string): string[] {
  return valuesOf(declarations, 'outline')
}

function onFocus(): { name: string; selector: string; declarations: string }[] {
  return components.flatMap((one) =>
    rules(one.style)
      .filter((rule) => rule.selector.includes(':focus'))
      .map((rule) => ({ name: one.name, ...rule })),
  )
}

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

describe('the row a list is made of', () => {
  test('is drawn in the themes package and nowhere else', () => {
    const shared = readFileSync(join(THEMES, 'base.css'), 'utf8')
    expect(shared).toContain('.orden-row')
    expect(draw(/\.orden-row(?![\w-])/)).toEqual([])
  })

  test('and no list paints a hover or a press of its own', () => {
    const own = components
      .filter((one) =>
        rules(one.style).some(
          (rule) =>
            /\.(row|hit|item|entry)\b[^\s>+~,]*:(hover|active)/.test(rule.selector) &&
            /(^|;|\s)background(-color)?\s*:/.test(rule.declarations),
        ),
      )
      .map((one) => one.name)
      .sort()

    expect(own).toEqual([])
  })

  test('and the row every list wears is the one in the themes package', () => {
    const shared = readFileSync(join(THEMES, 'base.css'), 'utf8')

    for (const state of ['.orden-row.is-on', '.orden-row.is-picked', '.orden-row:active']) {
      expect(shared, `${state} is not stated`).toContain(state)
    }
  })

  test('and the lists wear the class rather than a row of their own', () => {
    const lists = [
      'lib/Bookmarks.svelte',
      'lib/ContextMenu.svelte',
      'lib/HitList.svelte',
      'lib/Palette.svelte',
      'lib/SearchPanel.svelte',
      'lib/SettingsPanel.svelte',
      'lib/Sidebar.svelte',
      'lib/TagTree.svelte',
      'lib/Tree.svelte',
    ]

    const missing = lists.filter(
      (name) => !components.find((one) => one.name === name)?.text.includes('orden-row'),
    )

    expect(missing, `these draw a list without the row: ${missing.join(', ')}`).toEqual([])
  })
})

describe('the ring a keyboard leaves', () => {
  test('is one token, and one rule that uses it', () => {
    const tokens = readFileSync(join(THEMES, 'tokens.css'), 'utf8')
    const shared = readFileSync(join(THEMES, 'base.css'), 'utf8')

    expect(tokens).toContain('--focus-ring:')
    expect(tokens).toContain('--focus-ring-offset:')
    expect(shared).toContain('outline: var(--focus-ring)')
  })

  test('and no component draws one of its own', () => {
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

  test('and never as a shadow, which is a ring the outline cannot see', () => {
    const own = onFocus()
      .filter((rule) => valuesOf(rule.declarations, 'box-shadow').some((value) => value !== 'none'))
      .map((rule) => `${rule.name} (${rule.selector})`)
      .sort()

    expect(own, `these draw a ring as a shadow: ${own.join(', ')}`).toEqual([])
  })

  test('and is never simply taken away by a component', () => {
    const own = onFocus()
      .filter((rule) => outlines(rule.declarations).includes('none'))
      .map((rule) => `${rule.name} (${rule.selector})`)
      .sort()

    expect(own, `these take the ring off and put nothing in its place: ${own.join(', ')}`).toEqual(
      [],
    )
  })

  test('and a component never silences a control, in any rule at all', () => {
    const own = components
      .filter((one) =>
        rules(one.style).some(
          (rule) =>
            /(^|[\s,>+~(])(input|textarea|select)(?![\w-])/.test(rule.selector) &&
            outlines(rule.declarations).includes('none'),
        ),
      )
      .map((one) => one.name)
      .sort()

    expect(own, `these silence a control of their own: ${own.join(', ')}`).toEqual([])
  })

  test('and a component never answers a focus on behalf of something inside it', () => {
    const own = components
      .flatMap((one) =>
        rules(one.style)
          .filter(
            (rule) =>
              (rule.selector.includes(':focus-within') ||
                /:has\([^)]*:focus/.test(rule.selector)) &&
              ['border', 'border-color', 'box-shadow', 'outline'].some(
                (property) => valuesOf(rule.declarations, property).length > 0,
              ),
          )
          .map((rule) => `${one.name} (${rule.selector})`),
      )
      .sort()

    expect(own, `these answer a focus for what is inside them: ${own.join(', ')}`).toEqual([])
  })

  test('and the two surfaces that answer another way are drawn in the themes package', () => {
    const shared = readFileSync(join(THEMES, 'base.css'), 'utf8')

    expect(shared).toContain('.orden-host:focus-visible')
    expect(shared).toContain('.orden-field :is(input, textarea):focus-visible')
  })

  test('and the surfaces that hold the keyboard for what is in them wear the class', () => {
    const wearing = components
      .filter((one) => one.text.includes('orden-host'))
      .map((one) => one.name)
      .sort()

    expect(wearing).toEqual([
      'lib/Canvas.svelte',
      'lib/ContextMenu.svelte',
      'lib/Reading.svelte',
      'lib/agents/ui/PairingBubble.svelte',
      'lib/ai/vault/VaultApprove.svelte',
      'lib/pass/PassFill.svelte',
      'lib/theme-picker/ThemePicker.svelte',
      'lib/web-tab/WebAsk.svelte',
    ])
  })

  test('and is left for a keyboard, never drawn on a plain focus', () => {
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

describe('the box a caret sits in', () => {
  test('is drawn in the themes package and nowhere else', () => {
    const shared = readFileSync(join(THEMES, 'base.css'), 'utf8')

    expect(shared).toContain('.orden-field {')
    expect(draw(/\.orden-field(?![\w-])/)).toEqual([])
  })

  test('and so are the words inside one, and the mark in front of them', () => {
    const shared = readFileSync(join(THEMES, 'base.css'), 'utf8')

    expect(shared).toContain('.orden-field :is(input, textarea) {')
    expect(shared).toContain('.orden-field-mark {')
    expect(draw(/\.orden-field-mark(?![\w-])/)).toEqual([])
  })
})

describe('the badge in front of a name', () => {
  test('is drawn in the themes package and nowhere else', () => {
    const shared = readFileSync(join(THEMES, 'base.css'), 'utf8')

    expect(shared).toContain('.orden-badge')
    expect(draw(/\.orden-badge/)).toEqual([])
  })

  test('and the surfaces that show one wear the class', () => {
    const wearing = components
      .filter((one) => one.text.includes('class="orden-badge'))
      .map((one) => one.name)
      .sort()

    expect(wearing).toEqual([
      'lib/AccountBadge.svelte',
      'lib/ShareSheet.svelte',
      'lib/Sheet.svelte',
      'lib/SpaceBadge.svelte',
      'lib/SpaceMenu.svelte',
      'lib/agents/settings/AgentMark.svelte',
      'lib/agents/ui/PairingBubble.svelte',
      'lib/ai/vault/VaultApprove.svelte',
      'lib/pass/VaultMark.svelte',
      'lib/tab-strip/TabCard.svelte',
    ])
  })

  test('and what a space puts in it is asked for once', () => {
    const asking = components
      .filter((one) => one.text.includes('<SpaceMark '))
      .map((one) => one.name)
      .sort()

    expect(asking).toEqual([
      'lib/PromptSheet.svelte',
      'lib/PublishSheet.svelte',
      'lib/ShareSheet.svelte',
      'lib/SpaceBadge.svelte',
      'lib/save-place/SavePlace.svelte',
      'lib/tab-strip/TabCard.svelte',
    ])
  })
})

describe('the switch', () => {
  test('is drawn in the themes package and nowhere else', () => {
    const shared = readFileSync(join(THEMES, 'base.css'), 'utf8')

    expect(shared).toContain('.orden-switch')
    expect(shared).toContain('[data-touch] .orden-switch')
    expect(draw(/orden-switch/)).toEqual([])
  })

  test('and every surface that has one wears the class', () => {
    const wearing = components
      .filter((one) => one.text.includes('orden-switch'))
      .map((one) => one.name)
      .sort()

    expect(wearing).toEqual([
      'lib/GraphControls.svelte',
      'lib/ImportSheet.svelte',
      'lib/Palette.svelte',
      'lib/ShareSheet.svelte',
      'lib/Switch.svelte',
      'lib/ai/DoWithAiCard.svelte',
      'lib/ai/sidebar/ModelPicker.svelte',
      'lib/chats/view/PollSheet.svelte',
      'lib/pass/SwitchRow.svelte',
      'lib/views/AutomationsBuilder.svelte',
      'lib/views/DisplayBuilder.svelte',
      'lib/views/ViewSettings.svelte',
      'lib/web-tab/WebClear.svelte',
    ])
  })
})

function segments(d: string): [number, number, number, number][] | null {
  const parts = d.match(/[MmLl]|-?\d*\.?\d+/g) ?? []
  const out: [number, number, number, number][] = []
  let [x, y] = [0, 0]
  let command = ''

  for (let at = 0; at < parts.length;) {
    const part = parts[at] ?? ''
    if (/[MmLl]/.test(part)) {
      command = part
      at++
      continue
    }

    const [dx, dy] = [Number(parts[at]), Number(parts[at + 1])]
    if (Number.isNaN(dx) || Number.isNaN(dy)) return null
    const relative = command === 'm' || command === 'l'
    const [nx, ny] = relative ? [x + dx, y + dy] : [dx, dy]

    if (command === 'L' || command === 'l') out.push([x, y, nx, ny])
    else command = command === 'm' ? 'l' : 'L'
    ;[x, y] = [nx, ny]
    at += 2
  }

  return /[^MmLl\d\s.,-]/.test(d) ? null : out
}

function isCross(d: string): boolean {
  const lines = segments(d)
  if (lines?.length !== 2) return false
  const [one, two] = lines as [[number, number, number, number], [number, number, number, number]]
  const slope = ([ax, ay, bx, by]: number[]) => ((by ?? 0) - (ay ?? 0)) / ((bx ?? 0) - (ax ?? 0))
  const ends = (line: number[]) => [`${line[0]},${line[1]}`, `${line[2]},${line[3]}`]
  const meet = ends(one).some((end) => ends(two).includes(end))

  return (
    !meet && Math.abs(slope(one) + slope(two)) < 0.01 && Math.abs(Math.abs(slope(one)) - 1) < 0.01
  )
}

describe('the cross that shuts something', () => {
  test('is drawn in one component, at one drawing per size it is seen at', () => {
    const drawing = components
      .filter((one) =>
        [...one.text.matchAll(/\bd="([^"]+)"/g)].some((path) => isCross(path[1] ?? '')),
      )
      .map((one) => one.name)
      .sort()

    expect(drawing).toEqual(['lib/Cross.svelte', 'lib/Titlebar.svelte'])
  })

  test('and no button spells one as a letter', () => {
    const spelled = components
      .filter((one) => /(<button[^>]*>|aria-hidden="true">)\s*[×✕✖]\s*</.test(one.text))
      .map((one) => one.name)

    expect(spelled).toEqual([])
  })
})

describe('the button with words in it', () => {
  test('is drawn in the themes package and nowhere else', () => {
    const shared = readFileSync(join(THEMES, 'base.css'), 'utf8')
    expect(shared).toContain('.orden-button')

    expect(draw(/\.orden-button/)).toEqual(['lib/UpdateNotice.svelte'])
  })

  test('and no component draws a primary of its own', () => {
    const own = components
      .filter((one) => rules(one.style).some((rule) => /\.primary\b/.test(rule.selector)))
      .map((one) => one.name)

    expect(own).toEqual([])
  })
})

describe('the action in a card', () => {
  test('is drawn in the themes package', () => {
    const shared = readFileSync(join(THEMES, 'base.css'), 'utf8')
    expect(shared).toContain('.orden-action')
    expect(shared).toContain('[data-touch] .orden-action')
  })

  test('and laid into a grouped card on a phone by the one sheet that has those', () => {
    expect(draw(/\.orden-action|\.action\b/)).toEqual(['lib/SettingsPanel.svelte'])
  })
})

describe('the small action at the end of a row', () => {
  test('is drawn in the themes package and nowhere else', () => {
    const shared = readFileSync(join(THEMES, 'base.css'), 'utf8')
    expect(shared).toContain('.orden-chip')
    expect(shared).toContain('[data-touch] .orden-chip')
    expect(draw(/\.orden-chip|\.pill\b/)).toEqual([])
  })
})

describe('the bar of what is used', () => {
  test('is drawn in the themes package and nowhere else', () => {
    const shared = readFileSync(join(THEMES, 'base.css'), 'utf8')
    expect(shared).toContain('.orden-meter')
    expect(draw(/\.orden-meter/)).toEqual([])
  })

  test('and every bar that says how much is used wears it', () => {
    const own = components
      .filter((one) => /role="(meter|progressbar)"/.test(one.text))
      .filter((one) => !one.text.includes('class="orden-meter"'))
      .map((one) => one.name)

    expect(own).toEqual([])
  })
})

describe('the fade on something refused', () => {
  test('is said in the themes package, for a fieldset too', () => {
    const shared = readFileSync(join(THEMES, 'base.css'), 'utf8')
    expect(shared).toContain(':where(fieldset):disabled')
  })

  test('and no component says it again', () => {
    const own = components.flatMap((one) =>
      rules(one.style)
        .filter(
          (rule) =>
            /:disabled|aria-disabled/.test(rule.selector) &&
            valuesOf(rule.declarations, 'opacity').some((value) => value !== '1'),
        )
        .map((rule) => `${one.name}: ${rule.selector}`),
    )

    expect(own).toEqual(['lib/ImportSheet.svelte: .drop:disabled'])
  })
})

describe('the segmented control', () => {
  test('is drawn in the themes package and nowhere else', () => {
    const shared = readFileSync(join(THEMES, 'base.css'), 'utf8')
    expect(shared).toContain('.orden-segmented')
    expect(draw(/\.orden-segmented|\.segmented\b/)).toEqual([])
  })

  test('is the class every one of them wears', () => {
    const own = components
      .filter((one) => one.text.includes('class="segmented"'))
      .map((one) => one.name)
    expect(own).toEqual([])
  })
})

describe('how a surface swaps what it is showing', () => {
  const slide = readFileSync(join(SOURCE, 'lib/slide.ts'), 'utf8')

  test('is one module, and it moves nothing but a transform and an opacity', () => {
    expect(slide).toContain('export function arrive')
    expect(slide).toContain('export function leave')
    expect(slide).toContain('export function segmented')

    const moved = [...slide.matchAll(/(?:css: \(t, u\) =>|thumb\.style\.)(\w+)/g)].map(
      (one) => one[1],
    )
    for (const property of moved) {
      expect(['opacity', 'transform', 'width', 'height', 'transition'], property).toContain(
        property,
      )
    }
    expect(slide).toContain('thumb.style.transform = `translate(')
    expect(slide).toContain('transform: translateY(')
  })

  test('and its durations come through the one place reduced motion is answered', () => {
    expect(slide).toContain("from './motion'")
    expect(slide).toContain('duration: dur(ms)')
  })

  test('the sliding surface is drawn in the themes package and nowhere else', () => {
    const shared = readFileSync(join(THEMES, 'base.css'), 'utf8')

    expect(shared).toContain('.orden-segmented-thumb')
    expect(draw(/\.orden-segmented-thumb/)).toEqual([])
  })

  test('and every segmented control in the shell asks for it', () => {
    const without = components
      .filter((one) => one.text.includes('class="orden-segmented"'))
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

describe('the bubble a sentence appears in', () => {
  test('is drawn in the themes package and nowhere else', () => {
    const shared = readFileSync(join(THEMES, 'base.css'), 'utf8')
    expect(shared).toContain('.orden-bubble')
    expect(draw(/\.orden-bubble/)).toEqual([])
  })

  test('and the fourteen that show one wear the class rather than a card of their own', () => {
    const own = components
      .filter((one) => one.text.includes('orden-bubble'))
      .map((one) => one.name)
      .sort()

    expect(own).toEqual([
      'lib/Hint.svelte',
      'lib/HintCard.svelte',
      'lib/NameField.svelte',
      'lib/agents/ui/PairingBubble.svelte',
      'lib/ai/vault/VaultApprove.svelte',
      'lib/chats/view/Tip.svelte',
      'lib/pass/PassFill.svelte',
      'lib/tab-strip/TabCard.svelte',
      'lib/web-tab/WebAsk.svelte',
      'lib/web-tab/WebDialog.svelte',
      'lib/web-tab/WebDownloads.svelte',
      'lib/web-tab/WebExtensionPopup.svelte',
      'lib/web-tab/WebExtensions.svelte',
      'lib/web-tab/WebSite.svelte',
    ])
  })
})

describe('the sentence behind a setting', () => {
  test('is one component, so it is one bubble in one place', () => {
    expect(draw(/\.explain\b|\.sentence\b/)).toEqual(['lib/Hint.svelte'])
  })

  test('and the settings ask for it rather than drawing their own', () => {
    const own = components
      .filter((one) => /<Hint\b/.test(one.text))
      .map((one) => one.name)
      .sort()

    expect(own).toEqual([
      'lib/AiPane.svelte',
      'lib/SettingsPanel.svelte',
      'lib/SyncPane.svelte',
      'lib/access/Access.svelte',
      'lib/agents/settings/Words.svelte',
      'lib/ai/DoWithAiCard.svelte',
      'lib/people/ProfileRows.svelte',
      'lib/views/DisplayBuilder.svelte',
    ])
  })
})

describe('saying Copied for a moment', () => {
  test('happens in one place, so it is one length of a moment', () => {
    const says = components.filter((one) => one.text.includes("'Copied'")).map((one) => one.name)
    expect(says).toEqual(['lib/CopyButton.svelte'])
  })
})

describe('bytes said as words', () => {
  test('are said by one function, so a small note is not rounded up to a kilobyte', () => {
    const own = components.filter((one) => /\/ *\(?1024/.test(one.text)).map((one) => one.name)

    expect(own).toEqual([])
  })
})
