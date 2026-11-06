import { describe, expect, test } from 'vitest'
import type { Entry } from './workspace.svelte'
import { orderedTree, shownNames, type SortMode } from './tree-order'
import { placedBeside } from './tree-arranging'

function space(many: number): Entry {
  const root: Entry = {
    name: 'N',
    path: '/N',
    is_dir: true,
    modified: 0,
    created: 0,
    children: [],
  }

  let folder: Entry = root
  for (let index = 0; index < many; index++) {
    if (index % 40 === 0) {
      folder = {
        name: `Folder ${index}`,
        path: `/N/Folder ${index}`,
        is_dir: true,
        modified: index,
        created: index,
        children: [],
      }
      root.children.push(folder)
    }

    folder.children.push({
      name: `Note ${many - index}.md`,
      path: `${folder.path}/Note ${many - index}.md`,
      is_dir: false,
      modified: (index * 7919) % many,
      created: index,
      children: [],
    })
  }

  return root
}

function compares(run: () => void): number {
  const proto = Intl.Collator.prototype
  const was = Object.getOwnPropertyDescriptor(proto, 'compare')
  // eslint-disable-next-line @typescript-eslint/unbound-method -- see above
  const reader = was?.get
  if (!reader) throw new Error('no compare getter to count through')

  let count = 0
  Object.defineProperty(proto, 'compare', {
    configurable: true,
    get(this: Intl.Collator) {
      const bound = reader.call(this) as (one: string, other: string) => number
      return (one: string, other: string) => {
        count += 1
        return bound(one, other)
      }
    },
  })

  try {
    run()
  } finally {
    Object.defineProperty(proto, 'compare', was)
  }

  return count
}

const MANY = 5000

describe('putting a space of five thousand notes into order', () => {
  test('costs a few comparisons per note, in every order', () => {
    const tree = space(MANY)

    for (const mode of ['name', 'name-desc', 'modified-desc', 'created-asc'] as SortMode[]) {
      const count = compares(() => orderedTree(tree, mode, () => []))
      expect(count, `${mode}: ${count}`).toBeLessThan(MANY * 20)
    }
  })

  test('and no more for the order somebody arranged', () => {
    const tree = space(MANY)
    const listed = (folder: string) => {
      const found = tree.children.find((one) => one.path === folder)
      return found
        ? found.children
            .slice(0, 3)
            .map((one) => one.name)
            .reverse()
        : []
    }

    const count = compares(() => orderedTree(tree, 'manual', listed))
    expect(count, `manual: ${count}`).toBeLessThan(MANY * 20)
  })

  test('and a row dropped into place reads one folder rather than the space', () => {
    const tree = space(MANY)
    const folder = tree.children[0]
    if (!folder) throw new Error('no folder')

    const names = shownNames(folder.children, 'manual', [])
    const first = names[0] ?? ''
    const last = names[names.length - 1] ?? ''

    const count = compares(() => placedBeside(folder.children, [], [last], first, false))
    expect(count, `a drop cost ${count}`).toBeLessThan(2000)
  })
})
