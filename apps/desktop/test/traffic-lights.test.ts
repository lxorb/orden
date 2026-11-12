import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const src = join(dirname(fileURLToPath(import.meta.url)), '../src')
const read = (path: string) => readFileSync(join(src, path), 'utf8')

const titlebar = read('lib/Titlebar.svelte')
const sidebar = read('lib/Sidebar.svelte')

describe('the room left for the traffic lights', () => {
  test('is on the bar’s left edge, whichever way the words run', () => {
    expect(titlebar).toMatch(/header\.lights\s*\{\s*padding-left:\s*var\(--traffic-lights\)/)
    expect(titlebar).not.toMatch(/header\.lights\s*\{\s*padding-inline-start/)
  })

  test('is in the sidebar’s head only while that head is at the window’s left', () => {
    expect(sidebar).toMatch(/:global\(\[data-lights\]\) \.head/)
  })
})
