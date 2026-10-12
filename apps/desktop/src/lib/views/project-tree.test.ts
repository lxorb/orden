import { describe, expect, test } from 'vitest'
import type { Entry } from '../workspace.svelte'
import { projectNodes, projectNotes, projectRows } from './project-tree'

const file = (path: string): Entry => ({
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  is_dir: false,
  modified: 0,
  created: 0,
  children: [],
})
const folder = (path: string, children: Entry[]): Entry => ({ ...file(path), is_dir: true, children })

const PROJECTS = folder('/s/Projects', [
  file('/s/Projects/Home.md'),
  folder('/s/Projects/Uni', [file('/s/Projects/Uni/Uni.md'), file('/s/Projects/Uni/Analysis.md')]),
  folder('/s/Projects/Later', [file('/s/Projects/Later/Trip.md')]),
  file('/s/Projects/picture.png'),
])

const COUNTS: Record<string, number> = { '/s/Projects/Home.md': 2, '/s/Projects/Uni/Analysis.md': 1 }
const count = (note: string) => COUNTS[note] ?? 0

describe('the projects the panel lists', () => {
  test('are the folder’s notes, a folder a project with its own note and the rest inside', () => {
    const nodes = projectNodes(PROJECTS, () => [], count)
    expect(nodes.map((one) => [one.name, one.count, one.note, one.children.length])).toEqual([
      ['Later', 0, '/s/Projects/Later/Later.md', 1],
      ['Uni', 0, '/s/Projects/Uni/Uni.md', 1],
      ['Home', 2, '/s/Projects/Home.md', 0],
    ])
    expect(nodes[1]?.children.map((one) => [one.name, one.count, one.depth])).toEqual([
      ['Analysis', 1, 1],
    ])
  })

  test('come in the order the file list was arranged in', () => {
    const arranged = (path: string) => (path === '/s/Projects' ? ['Home.md', 'Uni', 'Later'] : [])
    expect(projectNodes(PROJECTS, arranged, count).map((one) => one.name)).toEqual([
      'Home',
      'Uni',
      'Later',
    ])
  })

  test('a folded project keeps its sub-projects out of the rows', () => {
    const nodes = projectNodes(PROJECTS, () => [], count)
    expect(projectRows(nodes, new Set()).map((one) => one.name)).toEqual([
      'Later',
      'Trip',
      'Uni',
      'Analysis',
      'Home',
    ])
    expect(projectRows(nodes, new Set(['/s/Projects/Uni/Uni.md'])).map((one) => one.name)).toEqual(
      ['Later', 'Trip', 'Uni', 'Home'],
    )
    expect(projectNotes(nodes)).toContain('/s/Projects/Later/Trip.md')
  })
})
