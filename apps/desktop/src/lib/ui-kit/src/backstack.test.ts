import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const SOURCE = fileURLToPath(new URL('../../../', import.meta.url))
const app = readFileSync(`${SOURCE}App.svelte`, 'utf8')

test('the drawer is registered on whether a side is covered, not on which panel', () => {
  expect(app).toContain('const covered = $derived(!!workspace.panel)')
  expect(app).toContain('closeOnBack(covered, () => workspace.closePanel())')

  expect(app).toContain('const coveredRight = $derived(rightOpen)')
  expect(app).toContain('closeOnBack(coveredRight, () => workspace.closeRight())')
})

test('and never on the panel itself, which is what took the app away', () => {
  expect(app).not.toContain('closeOnBack(!!workspace.panel')
  expect(app).not.toContain('closeOnBack(!!workspace.rightPanel')
})
