import { AGENTS_NAME } from './note-name'
import { joinPath } from './tauri'
import { writeFile } from './workspace/write-file'
import { workspace } from './workspace.svelte'

export { AGENTS_NAME }

export const AGENTS_SEED = `# AGENTS

These are my notes. Write in the language and style they are written in, and ask before deleting, moving or renaming any of them.

## Memory
`

export function isUntouchedAgents(path: string, content: string): boolean {
  const name = path.split(/[\\/]/u).at(-1) ?? ''
  return name === AGENTS_NAME && content === AGENTS_SEED
}

export async function seedAgents(root: string): Promise<void> {
  await writeFile(joinPath(root, AGENTS_NAME), AGENTS_SEED).catch(() => undefined)
  await workspace.loadTree()
}
