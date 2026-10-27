/** The bar over what is picked on a canvas, measured without making the page lay itself
 *  out (#535). It comes up the moment Ctrl+A has marked every card picked and follows
 *  every nudge of them; reading its own width or the plane's there and then made the
 *  browser lay out a plane of three thousand cards on the spot - half a second at
 *  Ctrl+A and a third of one per nudge, in Chromium. Its sizes come from an observer,
 *  once layout is done, so no width is read as it mounts or moves.
 *
 *  In the jsdom project because the bar is mounted. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

const CanvasPicked = (await import('../../src/lib/CanvasPicked.svelte')).default
const { at } = await import('./canvas-picked-world.svelte')

const read: string[] = []
const spies = (['offsetWidth', 'clientWidth', 'offsetHeight', 'clientHeight'] as const).map(
  (name) =>
    vi.spyOn(HTMLElement.prototype, name, 'get').mockImplementation(() => {
      read.push(name)
      return 0
    }),
)

let app: ReturnType<typeof mount> | null = null

afterEach(() => {
  if (app) void unmount(app)
  app = null
  read.length = 0
})

test('reads no width as it comes up over what is picked, nor as that moves', () => {
  const plane = document.body.appendChild(document.createElement('div'))
  app = mount(CanvasPicked, {
    target: plane,
    props: {
      get at() {
        return at
      },
      below: false,
      colour: null,
      size: undefined,
      recent: [],
      grouping: null,
      oncolour: () => undefined,
      onsize: () => undefined,
      onduplicate: () => undefined,
      ondelete: () => undefined,
      ongroup: () => undefined,
      onmore: () => undefined,
    },
  })
  flushSync()
  expect(plane.querySelector('.over')).not.toBeNull()

  for (let x = 110; x < 160; x += 10) {
    at.x = x
    flushSync()
  }

  expect(read).toEqual([])
  for (const spy of spies) expect(spy).toBeDefined()
})
