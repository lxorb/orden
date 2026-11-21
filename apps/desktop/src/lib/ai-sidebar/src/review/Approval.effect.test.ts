import { mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { settle } from '../../../../../test/effects/settle'

const { workspace } = await import('../../../workspace/src/api')
const { shortcuts } = await import('../../../shortcuts/src/api')
const Approval = (await import('./Approval.svelte')).default
const RAW =
  'Not done yet: Orden asked the reader first (approval q3):\n<untrusted source="Orden">\nCopy /n/Work/Projekte/Gym.md to /n/Work/.trash/Gym (backup).md\n</untrusted>\nCarry on with other work. approval_status with id "q3" says when they answer; once it says allowed, make this same call again.'
const noteText = workspace.noteText.bind(workspace)
beforeEach(() => {
  workspace.spaces = [{ id: 'work', name: 'Work', root: '/n/Work' }]
  workspace.noteText = () => Promise.resolve(null)
})
afterEach(() => {
  workspace.noteText = noteText
})
async function asked(result: Record<string, unknown>, verb = 'files', args: unknown = { action: 'copy' }) {
  const target = document.createElement('div')
  document.body.append(target)
  const part = { kind: 'tool', id: 'f', verb, args, state: 'asking', result: { images: [], error: false, ...result } }
  const shown = mount(Approval, { target, props: { part: part as never, thread: { space: 'work' } as never } })
  await settle()
  const said = target.querySelector('p')?.textContent ?? ''
  void unmount(shown)
  target.remove()
  return said
}
test('a permission asked says what is asked in plain words, with the space’s paths cut short (#2426)', async () => {
  const said = await asked({
    text: RAW,
    approval: 'q3',
    asks: 'Copy /n/Work/Projekte/Gym.md to /n/Work/.trash/Gym (backup).md',
  })
  expect(said).toBe('Copy Projekte/Gym.md to .trash/Gym (backup).md')
})
test('a permission asked never shows what the model is told, even with no plain words given (#2426)', async () => {
  const said = await asked({ text: RAW, approval: 'q3' }, 'mcp__orden__edit_note', { path: 'Birds/Herons.md' })
  expect(said).toBe('edit_note Herons')
  expect(said).not.toContain('untrusted')
  expect(said).not.toContain('approval_status')
})
test('Approve and Deny show the keys that answer them, as the reader has them (#2427)', async () => {
  const target = document.createElement('div')
  document.body.append(target)
  const part = {
    kind: 'tool',
    id: 'f',
    verb: 'files',
    args: {},
    state: 'asking',
    result: { text: '', images: [], error: false, approval: 'q1' },
  }
  const shown = mount(Approval, { target, props: { part: part as never, thread: { space: 'work' } as never } })
  await settle()
  const keys = () =>
    [...target.querySelectorAll('.answers button')].map((one) => one.querySelector('.orden-keys')?.textContent ?? null)
  expect(keys()).toEqual([shortcuts.keys('ai.approve'), shortcuts.keys('ai.deny')])
  expect(keys()[0]).toBeTruthy()
  shortcuts.set('ai.approve', 'Alt-j')
  await settle()
  expect(keys()[0]).toBe(shortcuts.hint('ai.approve'))
  shortcuts.reset('ai.approve')
  void unmount(shown)
  target.remove()
})
