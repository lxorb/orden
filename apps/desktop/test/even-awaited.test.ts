import { describe, expect, test } from 'vitest'
import { awaitedOnly } from '../even-awaited'

describe('a module awaited in a template, in the plugin build', () => {
  test('hands on only the parts the block takes apart', () => {
    expect(awaitedOnly("{#await import('../ui/api') then { Copyable, default: Whole }}<Copyable />{/await}")).toBe(
      `{#await import('../ui/api').then((one) => ({ "Copyable": one.Copyable, "default": one.default })) then { Copyable, default: Whole }}<Copyable />{/await}`,
    )
  })
  test('hands on only the parts the block reads through its name', () => {
    expect(awaitedOnly("{#await import('../ui/api') then ui}<ui.Faces ids={x} /><ui.Faces /><ui.Gone />{/await}")).toBe(
      `{#await import('../ui/api').then((one) => ({ "Faces": one.Faces, "Gone": one.Gone })) then ui}<ui.Faces ids={x} /><ui.Faces /><ui.Gone />{/await}`,
    )
  })
  test('leaves a block alone that uses the whole module, or has nothing to read', () => {
    for (const code of [
      "{#await import('../ui/api') then ui}<Show what={ui} />{/await}",
      "{#await import('../ui/api') then ui}nothing{/await}",
      "{#await import('../ui/api').then((one) => one.rows()) then rows}{rows}{/await}",
      '<p>no await here</p>',
    ]) {
      expect(awaitedOnly(code)).toBeNull()
    }
  })
  test('does not take a longer name or a member of another name for the one bound', () => {
    expect(awaitedOnly("{#await import('./a') then ui}<uix.A /><x.ui.B /><ui.C />{/await}")).toBe(
      `{#await import('./a').then((one) => ({ "C": one.C })) then ui}<uix.A /><x.ui.B /><ui.C />{/await}`,
    )
  })
})
