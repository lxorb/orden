import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test } from 'vitest'
import source from '../../src/lib/foreign/src/ForeignMark.svelte?raw'

const SyncMark = (await import('../../src/lib/surfaces/src/SyncMark.svelte')).default
const marks = document.createElement('div')
document.body.append(marks)
const mounted: ReturnType<typeof mount>[] = []
function draw(path: string | null) {
  mounted.push(mount(SyncMark, { target: marks, props: { path } }))
  flushSync()
}
function labels(): (string | null)[] {
  return [...marks.querySelectorAll('[role="img"]')].map((one) => one.getAttribute('aria-label'))
}
afterEach(() => {
  for (const one of mounted.splice(0)) void unmount(one)
})
test('another sync tool’s copy says which tool, and that it is not synced', () => {
  draw('C:\\Orden\\Work\\Hackathon List (# Name clash 2026-10-05 k3x9qaC #).md')
  draw('/home/emil/Nib/Plan.sync-conflict-20231012-143052-CEIVOCO.md')
  expect(labels()).toEqual(['Proton conflict copy, not synced', 'Syncthing conflict copy, not synced'])
  expect(marks.querySelectorAll('.foreign')).toHaveLength(2)
})
test('a note of somebody’s own, and a row with no file, wear nothing', () => {
  draw('/space/Plan.md')
  draw('/space/Plan (1).md')
  draw('/space/Plan (from another device 2026-09-12).md')
  draw(null)
  expect(labels()).toEqual([])
})
test('a foreign copy fades its row’s label and the mark before it itself, with no :has() rule', () => {
  expect(source).not.toContain(':has(')
  const row = document.createElement('button')
  row.innerHTML = '<span class="mark"></span><span class="orden-row-label">Plan</span>'
  marks.append(row)
  const [icon, label] = [...row.children] as [HTMLElement, HTMLElement]
  const one = mount(SyncMark, {
    target: row,
    props: { path: '/home/emil/Nib/Plan.sync-conflict-20231012-143052-CEIVOCO.md' },
  })
  flushSync()
  expect([icon, label].map((part) => part.style.opacity)).toEqual(['0.5', '0.5'])
  expect(row.querySelector<HTMLElement>('.foreign')?.style.opacity).toBe('')
  void unmount(one)
  flushSync()
  expect([icon, label].map((part) => part.style.opacity)).toEqual(['', ''])
  row.remove()
})
test('a row of somebody’s own fades nothing', () => {
  const row = document.createElement('button')
  row.innerHTML = '<span class="mark"></span><span class="orden-row-label">Plan</span>'
  marks.append(row)
  mounted.push(mount(SyncMark, { target: row, props: { path: '/space/Plan.md' } }))
  flushSync()
  expect([...row.querySelectorAll<HTMLElement>('*')].filter((one) => one.style.opacity)).toEqual([])
  row.remove()
})
