/** In-browser stand-in for the Rust file commands, so the shell can be built
 *  and reviewed with `pnpm web` without a desktop window. Dev only. */

interface Entry {
  name: string
  path: string
  is_dir: boolean
  modified: number
  created: number
  children: Entry[]
}

function blank(name: string, path: string): Entry {
  return { name, path, is_dir: false, modified: 0, created: 0, children: [] }
}

const ROOT = '/space'

const NOTES = new Map<string, string>([
  [
    `${ROOT}/Read me.md`,
    `# Read me

Markdown, and nothing else. Prose with **strong**, *emphasis*, ~~strike~~, \`code\`,
==highlight==, H~2~O and X^2^.

> [!NOTE]
> Syntax reappears only on the line you are editing.

- bullet
- [x] finished
- [ ] pending

Inline math $E = mc^2$ sits in the sentence.

$$
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$

| Feature | Status | Notes |
| :------ | :----: | ----: |
| Live preview | done | syntax hides |
| Tables | done | click a cell |
| Sync | done | Cloudflare |

\`\`\`js
const nib = 'markdown'
\`\`\`

\`\`\`mermaid
graph LR
  A[Write] --> B[Sync]
  B --> C[Publish]
\`\`\`
`,
  ],
  [`${ROOT}/Notes/Ideas.md`, '# Ideas\n\n- One\n- Two\n'],
  [`${ROOT}/Notes/Archive/Old.md`, '# Old\n\nSuperseded.\n'],
])

/** Rebuilds the tree from the note map so writes and deletes show up. */
function tree(): Entry {
  const root: Entry = { ...blank('space', ROOT), is_dir: true }

  for (const path of [...NOTES.keys()].sort()) {
    const parts = path.slice(ROOT.length + 1).split('/')
    let parent = root
    let prefix = ROOT

    for (const [index, part] of parts.entries()) {
      prefix += `/${part}`

      if (index === parts.length - 1) {
        parent.children.push({ ...blank(part, prefix), is_dir: false })
        break
      }

      let folder = parent.children.find((child) => child.is_dir && child.name === part)
      if (!folder) {
        folder = { ...blank(part, prefix), is_dir: true }
        parent.children.push(folder)
      }
      parent = folder
    }
  }

  const sort = (entry: Entry) => {
    entry.children.sort(
      (a, b) => Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name),
    )
    entry.children.filter((child) => child.is_dir).forEach(sort)
  }
  sort(root)

  return root
}

export function fixtureInvoke<T>(command: string, args?: Record<string, unknown>): T {
  const path = String(args?.path ?? '')

  switch (command) {
    case 'read_tree':
      return tree() as T
    case 'read_note':
      return (NOTES.get(path) ?? '') as T
    case 'write_note':
      NOTES.set(path, String(args?.content ?? ''))
      return undefined as T
    case 'delete_note':
      NOTES.delete(path)
      return undefined as T
    case 'rename_note': {
      const from = String(args?.from ?? '')
      const to = String(args?.to ?? '')
      const body = NOTES.get(from)
      if (body !== undefined) {
        NOTES.delete(from)
        NOTES.set(to, body)
      }
      return undefined as T
    }
    case 'search_space': {
      const needle = String(args?.query ?? '').toLowerCase()
      const hits: unknown[] = []

      for (const [file, body] of NOTES) {
        body.split('\n').forEach((line, index) => {
          if (!line.toLowerCase().includes(needle)) return
          hits.push({ path: file, name: file.split('/').pop(), line: index, text: line.trim() })
        })
      }
      return hits as T
    }
    case 'create_folder':
      return undefined as T
    case 'delete_folder':
      for (const key of [...NOTES.keys()]) {
        if (key.startsWith(`${path}/`)) NOTES.delete(key)
      }
      return undefined as T
    default:
      throw new Error(`${command} has no browser stand-in`)
  }
}

export const FIXTURE_SPACE = { id: 'fixture', name: 'space', root: ROOT }
