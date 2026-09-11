import { describe, expect, test } from 'vitest'

import { restamped } from './apply'
import type { ImportPlan, Planned } from './plan'

function planOf(files: Planned[]): ImportPlan {
  return { format: 'markdown', files, lost: [] }
}

function note(path: string, text: string): Planned {
  return { kind: 'note', path, text }
}

function file(path: string): Planned {
  return { kind: 'file', path, bytes: Uint8Array.from([1]) }
}

function textAt(files: readonly Planned[], path: string): string {
  const found = files.find((one) => one.path === path)
  if (found?.kind !== 'note') throw new Error(`no note at ${path}`)
  return found.text
}

describe('where an import lands', () => {
  test('is inside the folder it was given', () => {
    const stamped = restamped(planOf([note('A.md', '# A'), file('assets/x.png')]), new Set(), 'In')

    expect(stamped.files.map((one) => one.path)).toEqual(['In/A.md', 'In/assets/x.png'])
    expect(stamped.stepped).toBe(0)
  })

  test('is the space itself when no folder was named', () => {
    const stamped = restamped(planOf([note('A.md', '# A')]), new Set(), '')

    expect(stamped.files[0]?.path).toBe('A.md')
  })
})

describe('a name that is already taken', () => {
  test('steps aside rather than writing over what is there', () => {
    const taken = new Set(['a.md'])
    const stamped = restamped(planOf([note('A.md', '# A')]), taken, '')

    expect(stamped.files[0]?.path).toBe('A 2.md')
    expect(stamped.stepped).toBe(1)
  })

  test('and the links inside the import follow it', () => {
    const taken = new Set(['kit.md'])
    const stamped = restamped(
      planOf([note('Trip.md', 'See [[Kit]] and [[Kit|the kit]].'), note('Kit.md', '# Kit')]),
      taken,
      '',
    )

    expect(stamped.files.map((one) => one.path)).toEqual(['Trip.md', 'Kit 2.md'])
    expect(textAt(stamped.files, 'Trip.md')).toBe('See [[Kit 2]] and [[Kit 2|the kit]].')
  })

  test('a picture that steps aside is still the picture the note shows', () => {
    const taken = new Set(['assets/shot.png'])
    const stamped = restamped(
      planOf([note('Trip.md', '![](assets/shot.png)'), file('assets/shot.png')]),
      taken,
      '',
    )

    expect(textAt(stamped.files, 'Trip.md')).toBe('![](assets/shot%202.png)')
  })

  test('a link from a note in a folder follows it too', () => {
    const taken = new Set(['assets/shot.png'])
    const stamped = restamped(
      planOf([note('Deep/Trip.md', '![](../assets/shot.png)'), file('assets/shot.png')]),
      taken,
      '',
    )

    expect(textAt(stamped.files, 'Deep/Trip.md')).toBe('![](../assets/shot%202.png)')
  })

  test('two of the import1s own notes cannot land on one name', () => {
    const taken = new Set(['a.md', 'a 2.md'])
    const stamped = restamped(planOf([note('A.md', 'one'), note('A.md', 'two')]), taken, '')

    expect(stamped.files.map((one) => one.path)).toEqual(['A 3.md', 'A 4.md'])
  })

  test('counts as taken whatever the case of the name', () => {
    const stamped = restamped(planOf([note('Plan.md', 'x')]), new Set(['PLAN.MD']), '')

    expect(stamped.files[0]?.path).toBe('Plan 2.md')
  })
})
