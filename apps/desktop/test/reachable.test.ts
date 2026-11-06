import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))
const read = (name: string) => readFileSync(`${SOURCE}${name}`, 'utf8')

function branch(text: string, condition: string): string {
  const opening = `{#if ${condition}}`
  const from = text.indexOf(opening)
  expect(from, `no ${opening}`).toBeGreaterThanOrEqual(0)

  let depth = 1
  let at = from + opening.length
  while (depth > 0) {
    const next = /\{[#/]/.exec(text.slice(at))
    if (!next) throw new Error(`${opening} is never closed`)

    at += next.index + 2
    depth += next[0] === '{#' ? 1 : -1
  }

  return text.slice(from, at)
}

describe('the window buttons', () => {
  const titlebar = read('lib/Titlebar.svelte')
  const desktop = branch(titlebar, 'isDesktop && !mac')

  test.each(['Minimize', 'Maximize', 'Restore', 'Close'])(
    'draw %s only where there is a window to press it on',
    (label) => {
      const asked = `t('${label}')`
      expect(titlebar, label).toContain(asked)
      expect(desktop, label).toContain(asked)

      expect(titlebar.split(asked).length - 1).toBe(desktop.split(asked).length - 1)
    },
  )

  test('are never shrunk or hidden by the stylesheet', () => {
    const style = /<style[^>]*>([\s\S]*)<\/style>/.exec(titlebar)?.[1] ?? ''

    const about = [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((rule) => (rule[1] ?? '').includes('.controls'))
      .map((rule) => rule[2] ?? '')

    expect(about.length).toBeGreaterThan(0)
    for (const declarations of about) {
      expect(declarations).not.toMatch(/width:\s*0[;\s]/)
      expect(declarations).not.toMatch(/height:\s*0[;\s]/)
      expect(declarations).not.toMatch(/display:\s*none/)
      expect(declarations).not.toMatch(/visibility:\s*hidden/)
    }
  })
})

function tag(text: string, className: string): string {
  const at = text.indexOf(`class="${className}"`)
  expect(at, `no class="${className}"`).toBeGreaterThanOrEqual(0)

  const end = /\n\s*>\n/.exec(text.slice(at))
  if (!end) throw new Error(`class="${className}" has no end to its tag`)

  return text.slice(text.lastIndexOf('<', at), at + end.index + end[0].length)
}

describe('the layer the rail and the file list sit in', () => {
  const app = read('App.svelte')
  const panels = tag(app, 'panels')

  test('is inert wherever a shut drawer has taken it off screen', () => {
    expect(panels).toContain('inert={viewport.drawer && !workspace.panel}')
  })

  test('is not inert on the narrow width alone', () => {
    expect(panels).not.toContain('inert={viewport.narrow')
  })

  test('is what slides, so the condition and the movement agree', () => {
    expect(app).toContain(':global([data-drawer]) .panels')
  })
})

describe('the note, where the list is the floor', () => {
  const note = tag(read('App.svelte'), 'document')

  test('is inert while it is slid off to uncover the list', () => {
    expect(note).toContain(
      'inert={viewport.narrow && viewport.drawer && !!workspace.panel && !bare}',
    )
  })

  test('on the condition that slides it', () => {
    expect(note).toContain('class:open={!!workspace.panel}')
    expect(read('App.svelte')).toContain(':global([data-drawer][data-narrow]) .document.open {')
  })
})
