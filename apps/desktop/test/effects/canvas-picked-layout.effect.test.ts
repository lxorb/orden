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
