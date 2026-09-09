import { describe, expect, test } from 'vitest'
import { buildGraph, neighbourhood, type NoteGraph } from './graph'
import { scanNote, type ScannedNote } from './scan-note'

/** A folder of notes, read the way the index reads one. */
const scan = (notes: Record<string, string>) =>
  Object.entries(notes).map(([path, content]) => scanNote(path, content))

/** The graph of already-read notes. The resolver is the index's, in its simplest
 *  honest form: a target names a note by its file name, or it names nothing. */
function graphOf(scanned: ScannedNote[]): NoteGraph {
  const byName = new Map(
    scanned.map((note) => [note.name.toLowerCase(), note.path] as const).reverse(),
  )

  return buildGraph(scanned, (_from, link) => {
    const wanted = (link.target.split('/').pop() ?? link.target)
      .replace(/\.(md|markdown)$/i, '')
      .toLowerCase()
    return byName.get(wanted) ?? null
  })
}

const space = (notes: Record<string, string>) => graphOf(scan(notes))

const named = (graph: NoteGraph) => graph.nodes.map((node) => node.name)

/** Every edge as the pair of names it joins, sorted, so a test can say what is
 *  connected without knowing the order the nodes came out in. */
function joins(graph: NoteGraph): string[] {
  return graph.edges
    .map((edge) => [graph.nodes[edge.a]?.name ?? '', graph.nodes[edge.b]?.name ?? ''].sort())
    .map((pair) => pair.join(' - '))
    .sort()
}

describe('the space as a graph', () => {
  test('a node per note, whether anything links to it or not', () => {
    const graph = space({ 'Plan.md': '# Plan', 'Alone.md': '# Alone' })

    expect(named(graph).sort()).toEqual(['Alone', 'Plan'])
    expect(graph.edges).toEqual([])
  })

  test('an edge for a wikilink, and for a markdown link', () => {
    const graph = space({
      'Plan.md': '# Plan',
      'Ideas.md': 'see [[Plan]]',
      'Notes.md': 'and [the plan](Plan.md)',
    })

    expect(joins(graph)).toEqual(['Ideas - Plan', 'Notes - Plan'])
  })

  test('one edge for a pair that links both ways, marked as both', () => {
    const graph = space({ 'One.md': 'see [[Two]]', 'Two.md': 'see [[One]]' })

    expect(joins(graph)).toEqual(['One - Two'])
    expect(graph.edges.map((edge) => edge.both)).toEqual([true])
  })

  test('and an edge one way round knows which way that is', () => {
    const graph = space({ 'One.md': 'see [[Two]]', 'Two.md': '' })
    const [edge] = graph.edges

    expect(edge?.both).toBe(false)
    expect(graph.nodes[edge?.a ?? -1]?.name).toBe('One')
    expect(graph.nodes[edge?.b ?? -1]?.name).toBe('Two')
  })

  test('a note linking a canvas is joined to it, since a canvas is a node', () => {
    const graph = space({
      'One.md': 'the board: [[Board.canvas]]',
      'Board.canvas': '{"nodes":[],"edges":[]}',
    })

    expect(joins(graph)).toEqual(['Board.canvas - One'])
  })

  test('a note carries its tags into the picture', () => {
    const graph = space({ 'One.md': '#Work/Nib and #plans', 'Two.md': 'nothing' })

    expect(graph.nodes.find((node) => node.name === 'One')?.tags).toEqual(['work/nib', 'plans'])
    expect(graph.nodes.find((node) => node.name === 'Two')?.tags).toEqual([])
  })

  test('and a note the space does not hold carries none', () => {
    const graph = space({ 'One.md': 'see [[Elsewhere]]' })

    expect(graph.nodes.find((node) => node.path === null)?.tags).toEqual([])
  })

  test('one edge however many times a note links to the same one', () => {
    const graph = space({ 'One.md': '[[Two]] and [[Two]] and [[Two#Heading]]', 'Two.md': '' })

    expect(joins(graph)).toEqual(['One - Two'])
  })

  test('a link into the note it is written in joins nothing', () => {
    const graph = space({ 'One.md': 'see [[One]] and [[One#Later]]' })

    expect(graph.edges).toEqual([])
  })

  test('degree counts the edges that touch a node', () => {
    const graph = space({
      'Plan.md': '# Plan',
      'One.md': '[[Plan]]',
      'Two.md': '[[Plan]]',
      'Three.md': '[[Plan]]',
    })

    const plan = graph.nodes.find((node) => node.name === 'Plan')
    expect(plan?.degree).toBe(3)
    expect(graph.nodes.find((node) => node.name === 'One')?.degree).toBe(1)
  })

  test('a target the space holds no note for is a node with no note', () => {
    const graph = space({ 'One.md': 'see [[Somewhere else]]' })

    const missing = graph.nodes.find((node) => node.name === 'Somewhere else')
    expect(missing?.path).toBeNull()
    expect(joins(graph)).toEqual(['One - Somewhere else'])
  })

  test('two notes asking for the same missing name ask for one node', () => {
    const graph = space({ 'One.md': '[[Plan]]', 'Two.md': '[[plan]]' })

    expect(graph.nodes.filter((node) => node.path === null)).toHaveLength(1)
    expect(joins(graph)).toEqual(['One - Plan', 'Plan - Two'])
  })

  test('an attachment is not a note that is missing', () => {
    const graph = space({ 'One.md': 'a picture: ![[shot.png]] and ![](diagram.svg)' })

    expect(named(graph)).toEqual(['One'])
    expect(graph.edges).toEqual([])
  })

  test('a link out at the web is not a link in the space', () => {
    const graph = space({ 'One.md': '[a page](https://example.com/thing)' })

    expect(named(graph)).toEqual(['One'])
  })
})

/** A line of five notes, each linking to the next: One - Two - Three - Four -
 *  Five, plus one note off to the side of Two. */
const line = () =>
  space({
    'One.md': '[[Two]]',
    'Two.md': '[[Three]] and [[Aside]]',
    'Three.md': '[[Four]]',
    'Four.md': '[[Five]]',
    'Five.md': '',
    'Aside.md': '',
  })

describe('the neighbourhood of one note', () => {
  test('at depth one, the note and what it is linked to', () => {
    const around = neighbourhood(line(), 'Two.md', 1)

    expect(named(around).sort()).toEqual(['Aside', 'One', 'Three', 'Two'])
    expect(joins(around)).toEqual(['Aside - Two', 'One - Two', 'Three - Two'])
  })

  test('at depth two, their neighbours as well', () => {
    const around = neighbourhood(line(), 'Two.md', 2)

    // Four is two links out, through Three. Five is three, so it stays out.
    expect(named(around).sort()).toEqual(['Aside', 'Four', 'One', 'Three', 'Two'])
    expect(joins(around)).toEqual(['Aside - Two', 'Four - Three', 'One - Two', 'Three - Two'])
  })

  test('the note asked about comes first, so the picture has a middle', () => {
    expect(neighbourhood(line(), 'Four.md', 2).nodes[0]?.name).toBe('Four')
  })

  test('a note nothing links to is a picture of itself', () => {
    const around = neighbourhood(line(), 'Five.md', 1)

    expect(named(around)).toEqual(['Five', 'Four'])
  })

  test('degrees are counted within the slice, not the space', () => {
    // Three is linked to Two and to Four in the space, but at depth one from Two
    // only the one edge is in the picture.
    const around = neighbourhood(line(), 'Two.md', 1)

    expect(around.nodes.find((node) => node.name === 'Three')?.degree).toBe(1)
    expect(around.nodes.find((node) => node.name === 'Two')?.degree).toBe(3)
  })

  test('a note the space does not hold has no neighbourhood', () => {
    expect(neighbourhood(line(), 'Nowhere.md', 2)).toEqual({ nodes: [], edges: [] })
  })

  test('a depth of nothing is the note on its own', () => {
    const around = neighbourhood(line(), 'Two.md', 0)

    expect(named(around)).toEqual(['Two'])
    expect(around.edges).toEqual([])
  })
})

describe('a space of two thousand notes and four thousand links', () => {
  /** The space the graph is measured on: two thousand notes in twenty folders,
   *  each linking to the next note and to one seven along, and every fifth one to
   *  a hub as well. That is a little over four thousand links, in a shape that has
   *  both a hub and long chains in it, which is what a space of notes looks
   *  like. */
  function many(): Record<string, string> {
    const built: Record<string, string> = { 'Plan.md': '# Plan' }

    for (let one = 0; one < 2000; one++) {
      const hub = one % 5 === 0 ? ' and [[Plan]]' : ''
      built[`folder${one % 20}/Note ${one}.md`] =
        `# Note ${one}\n\nsee [[Note ${one + 1}]] and [[Note ${one + 7}]]${hub}\n`
    }

    return built
  }

  test('builds the whole space', () => {
    // Read outside the timing: reading a space is the index's one pass over it,
    // and the graph is what is being measured here.
    const scanned = scan(many())

    // Measured by hand at 8 ms here and 60 ms in the browser; a clock in a
    // test only reports the machine's mood, so the shape is what is checked.
    const graph = graphOf(scanned)

    expect(graph.nodes).toHaveLength(2008)
    expect(graph.edges.length).toBeGreaterThan(4000)
  })

  test('takes a neighbourhood out of it', () => {
    const graph = space(many())
    const around = neighbourhood(graph, 'Plan.md', 2)

    expect(around.nodes.length).toBeGreaterThan(400)
  })
})
