import { type NoteIndex, resolveFile, resolveNote } from '@orden/editor'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { ImportPlan, Planned } from './plan'

const wrote: { command: string; path: string }[] = []

let refusing: string | null = null

const recorded: unknown[] = []

const said = new Map<string, string>()

const onDisk = new Set<string>()

const listed = new Map<string, string[]>()

vi.mock('../../platform/src/tauri', () => ({
  invoke: (command: string, args: Record<string, unknown>) => {
    if (command === 'file_stamp') {
      return Promise.resolve(onDisk.has(String(args.path)) ? { modified: 1, len: 1 } : null)
    }
    if (command === 'path_exists') return Promise.resolve(onDisk.has(String(args.path)))
    if ((command === 'read_note' || command === 'read_asset') && onDisk.has(String(args.path))) {
      return Promise.resolve('')
    }
    if (command === 'read_note' || command === 'read_asset') {
      return Promise.reject(new Error('nothing there'))
    }
    if (command === 'read_tree') {
      const root = String(args.root)
      const paths = listed.get(root) ?? []
      return Promise.resolve({
        children: paths.map((path) => ({ path: `${root}/${path}`, is_dir: false, children: [] })),
      })
    }
    if (args.path === refusing) return Promise.reject(new Error('the disk is full'))
    if (command === 'write_note') said.set(String(args.path), String(args.content))
    wrote.push({ command, path: String(args.path) })
    return Promise.resolve()
  },
  joinPath: (dir: string, relative: string) => `${dir}/${relative}`,
  isNative: false,
}))

const came: string[] = []

const described: [string, unknown][] = []

vi.mock('../../workspace/src/api', () => ({
  workspace: {
    activeSpace: { root: '/Space' },
    files: [],
    undone: { record: (action: unknown) => void recorded.push(action) },
    itemMeta: { set: (path: string, patch: unknown) => void described.push([path, patch]) },
    loadTree: () => Promise.resolve(),
    fileCame: (path: string) => {
      came.push(path)
      return Promise.resolve()
    },
  },
}))

const heard: string[] = []

vi.mock('../../link-index/src/api', () => ({
  links: {
    noteSaved: (path: string) => void heard.push(`saved ${path}`),
    cameBack: (path: string) => void heard.push(`came back ${path}`),
  },
}))
vi.mock('../../sync-store/src/api', () => ({ sync: { nudge: () => undefined } }))

const readOnly = new Set<string>()
vi.mock('../../sharing/src/api', () => ({
  canWriteAt: (path: string) =>
    ![...readOnly].some((root) => path === root || path.startsWith(`${root}/`)),
}))

const { applyImport, restamped } = await import('./apply')
const { sha256 } = await import('../../platform/src/bytes')

beforeEach(() => {
  wrote.length = 0
  heard.length = 0
  recorded.length = 0
  refusing = null
  readOnly.clear()
  onDisk.clear()
  listed.clear()
  said.clear()
  described.length = 0
})

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

  test('has a wikilink written from the top of the vault name its note from the top of the space', () => {
    const plan = planOf([
      note('Projects/Plan.md', '# P'),
      file('Trips/Map.png'),
      note(
        'Home.md',
        'See [[/Projects/Plan]], [[/Projects/Plan#Goals|goals]] and ![[/Trips/Map.png]].',
      ),
    ])

    expect(textAt(restamped(plan, new Set(), 'Inbox').files, 'Inbox/Home.md')).toBe(
      'See [[/Inbox/Projects/Plan]], [[/Inbox/Projects/Plan#Goals|goals]] and ![[/Inbox/Trips/Map.png]].',
    )
    expect(
      textAt(restamped(plan, new Set(['inbox/projects/plan.md']), 'Inbox').files, 'Inbox/Home.md'),
    ).toBe(
      'See [[/Inbox/Projects/Plan 2]], [[/Inbox/Projects/Plan 2#Goals|goals]] and ![[/Inbox/Trips/Map.png]].',
    )
  })

  test('keeps a wikilink from the top that names nothing in the vault as it was written', () => {
    const stamped = restamped(
      planOf([note('Home.md', 'See [[/Elsewhere/Plan]].')]),
      new Set(),
      'Inbox',
    )

    expect(textAt(stamped.files, 'Inbox/Home.md')).toBe('See [[/Elsewhere/Plan]].')
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

  test('a picture a reference names follows it', () => {
    const taken = new Set(['assets/shot.png'])
    const stamped = restamped(
      planOf([note('Trip.md', '![shot][s]\n\n[s]: assets/shot.png\n'), file('assets/shot.png')]),
      taken,
      '',
    )

    expect(textAt(stamped.files, 'Trip.md')).toBe('![shot][s]\n\n[s]: assets/shot%202.png\n')
  })

  test('a wikilink escaped with a backslash is words, and stays as it was', () => {
    const taken = new Set(['plan.md'])
    const stamped = restamped(
      planOf([
        note('Help.md', 'Write \\[[Plan]] to link the plan: [[Plan]].\n'),
        note('Plan.md', '# Plan'),
      ]),
      taken,
      '',
    )

    expect(textAt(stamped.files, 'Help.md')).toBe(
      'Write \\[[Plan]] to link the plan: [[Plan 2]].\n',
    )
  })

  test('a picture a vault embeds by its name follows it, its size and all', () => {
    const taken = new Set(['brain/photo.png', 'brain/home.md'])
    const stamped = restamped(
      planOf([note('Home.md', 'Look: ![[photo.png]] and ![[photo.png|300]]\n'), file('photo.png')]),
      taken,
      'Brain',
    )

    expect(stamped.files.map((one) => one.path)).toEqual(['Brain/Home 2.md', 'Brain/photo 2.png'])
    expect(textAt(stamped.files, 'Brain/Home 2.md')).toBe(
      'Look: ![[photo 2.png]] and ![[photo 2.png|300]]\n',
    )
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

  test('a link written as an example in code stays as it was written', () => {
    const guide = 'Type `[[Plan]]` to link, or [[Plan]].\n\n```\n[[Plan]] and ![](shot.png)\n```\n'
    const stamped = restamped(
      planOf([note('Guide.md', guide), note('Plan.md', '# Plan'), file('shot.png')]),
      new Set(['plan.md', 'shot.png']),
      '',
    )

    expect(textAt(stamped.files, 'Guide.md')).toBe(
      'Type `[[Plan]]` to link, or [[Plan 2]].\n\n```\n[[Plan]] and ![](shot.png)\n```\n',
    )
  })

  test('a canvas card follows the note it shows', () => {
    const board = '{"nodes":[{"id":"a","type":"file","file":"Plan.md"}],"edges":[]}'
    const stamped = restamped(
      planOf([
        note('Plan.md', '# Plan'),
        { kind: 'file', path: 'Board.canvas', bytes: new TextEncoder().encode(board) },
      ]),
      new Set(['plan.md']),
      '',
    )
    const canvas = stamped.files.find((one) => one.path === 'Board.canvas')

    expect(canvas?.kind === 'file' && new TextDecoder().decode(canvas.bytes)).toBe(
      board.replace('Plan.md', 'Plan 2.md'),
    )
  })

  test('a canvas landed in a folder still shows the notes and pictures it showed', () => {
    const board = JSON.stringify({
      nodes: [
        { id: 'a', type: 'file', file: 'Plan.md' },
        { id: 'b', type: 'file', file: 'Trips/Map.png' },
        { id: 'c', type: 'group', label: 'G', background: 'Trips/Map.png' },
        { id: 'd', type: 'file', file: 'https://example.com/a.png' },
      ],
      edges: [],
    })
    const stamped = restamped(
      planOf([
        note('Plan.md', '# Plan'),
        file('Trips/Map.png'),
        { kind: 'file', path: 'Boards/Board.canvas', bytes: new TextEncoder().encode(board) },
      ]),
      new Set(['vault/plan.md']),
      'Vault',
    )
    const canvas = stamped.files.find((one) => one.path === 'Vault/Boards/Board.canvas')

    expect(
      JSON.parse(canvas?.kind === 'file' ? new TextDecoder().decode(canvas.bytes) : '{}'),
    ).toEqual({
      nodes: [
        { id: 'a', type: 'file', file: 'Vault/Plan 2.md' },
        { id: 'b', type: 'file', file: 'Vault/Trips/Map.png' },
        { id: 'c', type: 'group', label: 'G', background: 'Vault/Trips/Map.png' },
        { id: 'd', type: 'file', file: 'https://example.com/a.png' },
      ],
      edges: [],
    })
  })

  test('a base landed in a folder still filters the folders it filtered', () => {
    const base = [
      'filters:',
      '  and:',
      '    - file.inFolder("Projects")',
      '    - file.folder != "Projects/Old"',
      'views:',
      '  - type: table',
      '    name: Mine',
      '    filters: file.path.startsWith("Projects/Mine") && status == "Projects"',
      '',
    ].join('\n')
    const stamped = restamped(
      planOf([
        note('Projects/Plan.md', '# Plan'),
        { kind: 'file', path: 'Projects.base', bytes: new TextEncoder().encode(base) },
      ]),
      new Set(),
      'Vault',
    )
    const landed = stamped.files.find((one) => one.path === 'Vault/Projects.base')

    expect(landed?.kind === 'file' && new TextDecoder().decode(landed.bytes)).toBe(
      base
        .replace('"Projects")', '"Vault/Projects")')
        .replace('"Projects/Old"', '"Vault/Projects/Old"')
        .replace('"Projects/Mine"', '"Vault/Projects/Mine"'),
    )
  })

  test('a base drawn in a note landed in a folder still filters the folders it filtered', () => {
    const said = (folder: string) =>
      `# Home\n\n\`\`\`base\nfilters: file.inFolder("${folder}")\n\`\`\`\n\n    file.inFolder("Projects")\n`
    const stamped = restamped(planOf([note('Home.md', said('Projects'))]), new Set(), 'Vault')

    expect(textAt(stamped.files, 'Vault/Home.md')).toBe(said('Vault/Projects'))
  })

  test('a base drawn in a note written with Windows line ends still filters the folders it filtered', async () => {
    const said = (folder: string) =>
      `# Home\r\n\r\n\`\`\`base\r\nfilters: file.inFolder("${folder}")\r\n\`\`\`\r\n`
    const files = await vaultLanded([], ['Home.md', said('Projects')])

    expect(textAt(files, 'Inbox/Home.md')).toBe(said('Inbox/Projects'))
  })

  test('a folder note and its folder step aside together', () => {
    const base = '```base\nfilters:\n  and:\n    - file.folder + ".md" == this.file.path\n```\n'
    const stamped = restamped(
      planOf([
        note('Home.md', 'See [[Tasks]] and [[Buy milk]].'),
        note('Tasks/Buy milk.md', '# Buy milk'),
        note('Tasks.md', base),
        note('Tasks/Sub.md', '# Sub'),
        note('Tasks/Sub/Deep.md', '# Deep'),
      ]),
      new Set(['tasks.md', 'tasks/buy milk.md']),
      '',
    )

    expect(stamped.files.map((one) => one.path)).toEqual([
      'Home.md',
      'Tasks 2/Buy milk.md',
      'Tasks 2.md',
      'Tasks 2/Sub.md',
      'Tasks 2/Sub/Deep.md',
    ])
    expect(textAt(stamped.files, 'Home.md')).toBe('See [[Tasks 2]] and [[Buy milk]].')
  })

  test('a base that filters a folder follows the folder when it steps aside', () => {
    const base = (folder: string) =>
      `filters:\n  or:\n    - file.inFolder("${folder}")\n    - file.path.startsWith("${folder}/Sub/")\n    - file.inFolder("Other")\n`
    const drawn = (folder: string) => `# Home\n\n\`\`\`base\n${base(folder)}\`\`\`\n`
    for (const [folder, taken] of [
      ['', 'tasks.md'],
      ['In', 'in/tasks.md'],
    ] as const) {
      const stamped = restamped(
        planOf([
          note('Tasks.md', '# T'),
          note('Tasks/Buy milk.md', '# B'),
          note('Home.md', drawn('Tasks')),
          { kind: 'file', path: 'Tasks.base', bytes: new TextEncoder().encode(base('Tasks')) },
        ]),
        new Set([taken]),
        folder,
      )
      const inside = (path: string) => (folder ? `${folder}/${path}` : path)
      const landed = stamped.files.find((one) => one.path === inside('Tasks.base'))
      const other = (text: string) => (folder ? text.replace('"Other"', `"${folder}/Other"`) : text)

      expect(stamped.files.map((one) => one.path)).toContain(inside('Tasks 2/Buy milk.md'))
      expect(landed?.kind === 'file' && new TextDecoder().decode(landed.bytes)).toBe(
        other(base(inside('Tasks 2'))),
      )
      expect(textAt(stamped.files, inside('Home.md'))).toBe(other(drawn(inside('Tasks 2'))))
    }
  })

  test('a link that names the folder follows the folder when it steps aside', () => {
    const stamped = restamped(
      planOf([
        note('Home.md', 'See [[Tasks/Buy milk]], [[tasks/Sub/Deep|deep]] and [[Sub/Deep]].'),
        note('Tasks.md', '# T'),
        note('Tasks/Buy milk.md', '# B'),
        note('Tasks/Sub/Deep.md', '# D'),
      ]),
      new Set(['tasks.md']),
      '',
    )

    expect(textAt(stamped.files, 'Home.md')).toBe(
      'See [[Tasks 2/Buy milk]], [[Tasks 2/Sub/Deep|deep]] and [[Sub/Deep]].',
    )
  })

  test('a markdown link written from the top follows its note when it steps aside', () => {
    const stamped = restamped(
      planOf([
        note('Notes/Day.md', 'See [p](Projects/Plan.md) and [q](/Projects/Plan.md).'),
        note('Projects/Plan.md', '# P'),
      ]),
      new Set(['projects/plan.md']),
      '',
    )

    expect(textAt(stamped.files, 'Notes/Day.md')).toBe(
      'See [p](Projects/Plan%202.md) and [q](../Projects/Plan%202.md).',
    )
  })

  test('a folder the space already fills moves its folder note aside with it', () => {
    const stamped = restamped(
      planOf([note('Tasks.md', '# Tasks'), note('Tasks/Buy milk.md', '# Buy milk')]),
      new Set(['tasks/old.md']),
      'In',
    )

    expect(stamped.files.map((one) => one.path)).toEqual(['In/Tasks.md', 'In/Tasks/Buy milk.md'])

    const filled = restamped(
      planOf([note('Tasks.md', '# Tasks'), note('Tasks/Buy milk.md', '# Buy milk')]),
      new Set(['tasks/old.md']),
      '',
    )
    expect(filled.files.map((one) => one.path)).toEqual(['Tasks 2.md', 'Tasks 2/Buy milk.md'])
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

  test('counts as taken however its accents are composed', () => {
    const decomposed = 'Cafe\u0301.md'
    const stamped = restamped(planOf([note(decomposed, 'x')]), new Set(['caf\u00e9.md']), '')

    expect(stamped.files[0]?.path).toBe('Cafe\u0301 2.md')
  })
})

async function vaultLanded(taken: string[], ...files: [string, string?][]): Promise<Planned[]> {
  const { readAs } = await import('./read')
  const { sourceOf } = await import('./sources')
  const sources = [['.obsidian/app.json', '{}'] as const, ...files].map(([path, body]) =>
    sourceOf(path, new TextEncoder().encode(body ?? 'x')),
  )
  return restamped(await readAs('obsidian', sources), new Set(taken), 'Inbox').files
}

describe('a vault landed beside notes of the same name', () => {
  test('keeps a link to the root Plan on it when only Projects/Plan steps aside', async () => {
    const files = await vaultLanded(
      ['inbox/projects/plan.md'],
      ['Plan.md', '# The root plan'],
      ['Projects/Plan.md', '# The project plan'],
      ['Home.md', 'Start with [[Plan]].'],
    )

    expect(files.map((one) => one.path)).toContain('Inbox/Projects/Plan 2.md')
    expect(textAt(files, 'Inbox/Home.md')).toBe('Start with [[Plan]].\n')
  })

  test('has a link that names the folder follow its note when it steps aside', async () => {
    const files = await vaultLanded(
      ['inbox/projects/plan.md'],
      ['Plan.md', '# The root plan'],
      ['Projects/Plan.md', '# The project plan'],
      ['Home.md', 'See [[Projects/Plan]].'],
    )

    expect(textAt(files, 'Inbox/Home.md')).toBe('See [[Projects/Plan 2]].\n')
  })

  test('has a link written from the top of the vault still name its note from the top of the space', async () => {
    const { setLinkWriting } = await import('../../link-format/src/api')
    for (const format of ['absolute', 'shortest'] as const) {
      setLinkWriting(format)
      try {
        const files = await vaultLanded(
          ['inbox/projects/plan.md'],
          ['Projects/Plan.md', '# The project plan'],
          ['Areas/Plan.md', '# The area plan'],
          ['Notes/Near.md', '# Near'],
          [
            'Notes/Sub/Day.md',
            'See [[Projects/Plan]], [[Near]] and [x](../Near.md).\n\n[r]: /Notes/Near.md\n',
          ],
        )

        expect(textAt(files, 'Inbox/Notes/Sub/Day.md')).toBe(
          format === 'absolute'
            ? 'See [Projects/Plan](Inbox/Projects/Plan%202.md), [Near](Inbox/Notes/Near.md) and [x](Inbox/Notes/Near.md).\n\n[r]: ../Near.md\n'
            : 'See [Projects/Plan](Inbox/Projects/Plan%202.md), [Near](Near.md) and [x](Near.md).\n\n[r]: ../Near.md\n',
        )
      } finally {
        setLinkWriting('wikilink')
      }
    }
  })

  test('has a link written in another case follow its note, in the case it was written', async () => {
    const files = await vaultLanded(
      ['inbox/kit.md'],
      ['Kit.md', '# Kit'],
      ['Trip.md', 'Pack the [[kit]].'],
    )

    expect(files.map((one) => one.path)).toContain('Inbox/Kit 2.md')
    expect(textAt(files, 'Inbox/Trip.md')).toBe('Pack the [[kit 2]].\n')
  })

  test('has a link with words in a table follow its note when it steps aside', async () => {
    const files = await vaultLanded(
      ['inbox/kit.md'],
      ['Kit.md', '# Kit'],
      ['Trip.md', '| What | Where |\n| --- | --- |\n| [[Kit\\|the kit]] | hall |\n'],
    )

    expect(textAt(files, 'Inbox/Trip.md')).toBe(
      '| What | Where |\n| --- | --- |\n| [[Kit 2\\|the kit]] | hall |\n',
    )
  })

  test('has a markdown link to a picture follow it with its title kept', async () => {
    const files = await vaultLanded(
      ['inbox/shot.png'],
      ['shot.png'],
      ['Trip.md', '![](shot.png "The view")'],
    )

    expect(files.map((one) => one.path)).toContain('Inbox/shot 2.png')
    expect(textAt(files, 'Inbox/Trip.md')).toBe('![](shot%202.png "The view")\n')
  })

  test('has a markdown link to a page of a PDF follow it with the page kept', async () => {
    const files = await vaultLanded(
      ['inbox/paper.pdf'],
      ['Paper.pdf'],
      ['Trip.md', 'Read [page 3](Paper.pdf#page=3).'],
    )

    expect(textAt(files, 'Inbox/Trip.md')).toBe('Read [page 3](Paper%202.pdf#page=3).\n')
  })

  test('has a picture whose name holds brackets follow it when it steps aside', async () => {
    const files = await vaultLanded(
      ['inbox/screenshot (1).png'],
      ['Screenshot (1).png'],
      ['Trip.md', '![](Screenshot%20(1).png)'],
    )

    expect(files.map((one) => one.path)).toContain('Inbox/Screenshot (1) 2.png')
    expect(textAt(files, 'Inbox/Trip.md')).toBe('![](Screenshot%20%281%29%202.png)\n')
  })
})

function spaceIndex(notes: readonly string[], files: readonly string[], from: string): NoteIndex {
  const ref = (path: string) => ({
    path,
    name: (path.split('/').pop() ?? path).replace(/\.md$/, ''),
    headings: [],
    blocks: [],
    aliases: [],
  })
  return { notes: notes.map(ref), files, path: from, read: () => Promise.resolve(null) }
}

function targetsIn(text: string): string[] {
  return [...text.matchAll(/\[\[([^\]|#]+)/g)].map((one) => one[1] ?? '')
}

describe('a vault landed in a folder of a space that holds notes of the same name', () => {
  test('has a link by name reach the note it came with, not the namesake already there', async () => {
    const files = await vaultLanded(
      ['Ideas.md', 'cover.png'],
      ['Ideas.md', '# v'],
      ['cover.png'],
      ['Daily/Day.md', 'See [[Ideas]], [[Ideas#Later]] and ![[cover.png]].'],
    )
    const landed = files.map((one) => one.path)
    const index = spaceIndex(
      ['Ideas.md', ...landed.filter((path) => path.endsWith('.md'))],
      ['cover.png', ...landed.filter((path) => !path.endsWith('.md'))],
      'Inbox/Daily/Day.md',
    )
    const [ideas, later, cover] = targetsIn(textAt(files, 'Inbox/Daily/Day.md'))

    expect(resolveNote(index, ideas ?? '')?.path).toBe('Inbox/Ideas.md')
    expect(resolveNote(index, later ?? '')?.path).toBe('Inbox/Ideas.md')
    expect(resolveFile(index, cover ?? '', 'wikilink')).toBe('Inbox/cover.png')
    expect(textAt(files, 'Inbox/Daily/Day.md')).toBe(
      'See [[Inbox/Ideas|Ideas]], [[Inbox/Ideas#Later]] and ![[Inbox/cover.png]].\n',
    )
  })

  test('has a picture by name reach the one it came with when the space holds one beside the link', async () => {
    const files = await vaultLanded(
      ['Inbox/Daily/cover.png'],
      ['A/cover.png'],
      ['Daily/Day.md', '![[cover.png]]'],
    )
    const landed = files.map((one) => one.path)
    const index = spaceIndex(
      landed.filter((path) => path.endsWith('.md')),
      ['Inbox/Daily/cover.png', ...landed.filter((path) => !path.endsWith('.md'))],
      'Inbox/Daily/Day.md',
    )
    const [cover] = targetsIn(textAt(files, 'Inbox/Daily/Day.md'))

    expect(resolveFile(index, cover ?? '', 'wikilink')).toBe('Inbox/A/cover.png')
  })

  test('keeps a link by name that already reaches the note it came with', async () => {
    const files = await vaultLanded(
      ['Ideas.md', 'Archive/Old/Plan.md'],
      ['Ideas.md', '# v'],
      ['Plan.md', '# p'],
      ['Day.md', 'See [[Ideas]] and [[Plan]].'],
    )

    expect(textAt(files, 'Inbox/Day.md')).toBe('See [[Ideas]] and [[Plan]].\n')
  })

  test('has a link in a table keep its cell when it names the note from the top', async () => {
    const files = await vaultLanded(
      ['Ideas.md'],
      ['Ideas.md', '# v'],
      ['Daily/Day.md', '| What |\n| --- |\n| [[Ideas]] |\n'],
    )

    expect(textAt(files, 'Inbox/Daily/Day.md')).toBe(
      '| What |\n| --- |\n| [[Inbox/Ideas\\|Ideas]] |\n',
    )
  })

  test('names the note from the very top when even its path is held beside the link', () => {
    const stamped = restamped(
      planOf([
        note('Projects/Ideas.md', '# v'),
        note('Daily/Projects/Day.md', 'See [[Projects/Ideas]].'),
      ]),
      new Set(['Daily/Projects/Ideas.md']),
      '',
    )
    const index = spaceIndex(
      ['Daily/Projects/Ideas.md', 'Projects/Ideas.md', 'Daily/Projects/Day.md'],
      [],
      'Daily/Projects/Day.md',
    )
    const text = textAt(stamped.files, 'Daily/Projects/Day.md')

    expect(text).toBe('See [[/Projects/Ideas|Projects/Ideas]].')
    expect(resolveNote(index, targetsIn(text)[0] ?? '')?.path).toBe('Projects/Ideas.md')
  })
})

describe('an import into a space that is not the one open', () => {
  test('has a link by name reach the note it came with, not that space’s namesake', async () => {
    listed.set('/Other', ['Ideas.md', 'cover.png'])
    await applyImport(
      planOf([
        note('Ideas.md', '# mine'),
        file('cover.png'),
        note('Daily/Day.md', 'See [[Ideas]] and ![[cover.png]].'),
      ]),
      { root: '/Other', folder: 'Vault' },
    )

    expect(said.get('/Other/Vault/Daily/Day.md')).toBe(
      'See [[Vault/Ideas|Ideas]] and ![[Vault/cover.png]].',
    )
  })
})

describe('an import into a space that already holds an earlier copy', () => {
  test('does not write over a picture the file list does not show', async () => {
    onDisk.add('/Space/Brain/photo.png')
    onDisk.add('/Space/Brain/.obsidian/app.json')
    const landed = await applyImport(
      planOf([
        note('Home.md', 'Look: ![[photo.png]]\n'),
        file('photo.png'),
        file('.obsidian/app.json'),
      ]),
      { root: '/Space', folder: 'Brain' },
    )

    expect(landed.paths).toEqual([
      '/Space/Brain/Home.md',
      '/Space/Brain/photo 2.png',
      '/Space/Brain/.obsidian/app 2.json',
    ])
    expect(landed.stepped).toBe(2)
  })

  test('has the note follow the picture that stepped aside', async () => {
    onDisk.add('/Space/Brain/photo.png')
    await applyImport(planOf([note('Home.md', 'Look: ![[photo.png]]\n'), file('photo.png')]), {
      root: '/Space',
      folder: 'Brain',
    })

    expect(said.get('/Space/Brain/Home.md')).toBe('Look: ![[photo 2.png]]\n')
    expect(wrote.map((one) => one.path)).not.toContain('/Space/Brain/photo.png')
  })

  test('does not write over notes of a space that is not the one open', async () => {
    onDisk.add('/Other/Brain/Home.md')
    onDisk.add('/Other/Brain/Home 2.md')
    const landed = await applyImport(planOf([note('Home.md', '# Home, the new copy\n')]), {
      root: '/Other',
      folder: 'Brain',
    })

    expect(landed.paths).toEqual(['/Other/Brain/Home 3.md'])
  })
})

describe('a page note and its paper', () => {
  test('a PDF named as a page note’s paper steps aside from the note already there', () => {
    const stamped = restamped(planOf([file('Report.pages.pdf')]), new Set(['Report.pages']), '')

    expect(stamped.files[0]?.path).toBe('Report.pages 2.pdf')
    expect(stamped.stepped).toBe(1)
  })

  test('a page note steps aside from a PDF already there under its paper’s name', () => {
    const stamped = restamped(planOf([file('Report.pages')]), new Set(['report.pages.pdf']), '')

    expect(stamped.files[0]?.path).toBe('Report 2.pages')
  })

  test('a note and its paper that come together stay together', () => {
    const stamped = restamped(
      planOf([file('Report.pages.pdf'), file('Report.pages')]),
      new Set(['Report.pages']),
      '',
    )

    expect(stamped.files.map((one) => one.path)).toEqual(['Report 2.pages.pdf', 'Report 2.pages'])
  })

  test('a pair inside a folder note’s folder goes with the folder, and stays a pair', () => {
    const stamped = restamped(
      planOf([
        file('Tasks/Report.pages.pdf'),
        note('Tasks.md', '# Tasks'),
        file('Tasks/Report.pages'),
      ]),
      new Set(['Tasks.md']),
      '',
    )

    expect(stamped.files.map((one) => one.path)).toEqual([
      'Tasks 2/Report.pages.pdf',
      'Tasks 2.md',
      'Tasks 2/Report.pages',
    ])
  })

  test('a PDF steps aside from a page note the file list does not show', async () => {
    onDisk.add('/Other/Report.pages')
    const landed = await applyImport(planOf([file('Report.pages.pdf')]), {
      root: '/Other',
      folder: '',
    })

    expect(landed.paths).toEqual(['/Other/Report.pages 2.pdf'])
  })
})

describe('a path no space would take', () => {
  const target = { root: '/Work', folder: '' }

  test('is refused before a single file is written, when it climbs out', async () => {
    const plan = planOf([note('Plan.md', '# Plan'), note('../../outside.md', '# not yours')])

    await expect(applyImport(plan, target)).rejects.toThrow(/outside the space/)
    expect(wrote).toEqual([])
  })

  test('and when it names a disk of its own', async () => {
    const plan = planOf([file('C:/Windows/System32/drivers/etc/hosts')])

    await expect(applyImport(plan, target)).rejects.toThrow(/outside the space/)
    expect(wrote).toEqual([])
  })

  test('while an import of ordinary names writes every one of them', async () => {
    const landed = await applyImport(planOf([note('Plan.md', '# Plan'), file('assets/x.png')]), {
      root: '/Work',
      folder: 'In',
    })

    expect(wrote).toEqual([
      { command: 'write_note', path: '/Work/In/Plan.md' },
      { command: 'write_bytes', path: '/Work/In/assets/x.png' },
    ])
    expect(landed.paths).toEqual(['/Work/In/Plan.md', '/Work/In/assets/x.png'])
  })

  test('and tells the link index about each of them, a picture as much as a note', async () => {
    await applyImport(planOf([note('Plan.md', '# Plan'), file('assets/x.png')]), {
      root: '/Work',
      folder: '',
    })

    expect(heard).toEqual(['saved /Work/Plan.md', 'came back /Work/assets/x.png'])
  })

  test('and says each of them was made, as every file operation is said', async () => {
    came.length = 0
    await applyImport(planOf([note('Plan.md', '# Plan'), file('assets/x.png')]), {
      root: '/Work',
      folder: '',
    })

    expect(came).toEqual(['/Work/Plan.md', '/Work/assets/x.png'])
  })
})

describe('an import that fails partway', () => {
  test('is still one thing to undo for what it wrote', async () => {
    refusing = '/Space/C.md'

    await expect(
      applyImport(planOf([note('A.md', 'a'), note('B.md', 'b'), note('C.md', 'c')]), {
        root: '/Space',
        folder: '',
      }),
    ).rejects.toThrow('the disk is full')

    expect(recorded).toEqual([
      {
        kind: 'import',
        paths: ['/Space/A.md', '/Space/B.md'],
        wrote: { '/Space/A.md': await sha256('a'), '/Space/B.md': await sha256('b') },
      },
    ])
  })
})

describe('a space shared to be read', () => {
  test('is refused before a single file is written', async () => {
    readOnly.add('/Theirs')
    const plan = planOf([note('Plan.md', '# Plan'), file('assets/x.png')])

    await expect(applyImport(plan, { root: '/Theirs', folder: 'In' })).rejects.toThrow(
      /could not be written/,
    )
    expect(wrote).toEqual([])
    expect(recorded).toEqual([])
  })
})
