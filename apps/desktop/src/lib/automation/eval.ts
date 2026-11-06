import { links } from '../link-index.svelte'
import { search } from '../search.svelte'
import { settings } from '../settings.svelte'
import { workspace } from '../workspace.svelte'
import { pages } from '../web-tab/pages.svelte'

function surface(): Record<string, unknown> {
  return { workspace, links, search, settings, pages }
}

export async function evaluate(code: string): Promise<unknown> {
  const answer = await compiled(code)(surface())
  return plain(answer)
}

type Script = (nib: Record<string, unknown>) => Promise<unknown>

function compiled(code: string): Script {
  try {
    return made(`return (async () => (${code}))()`)
  } catch {
    return made(`return (async () => { ${code} })()`)
  }
}

function made(body: string): Script {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- turning a string into code is the whole verb
  return new Function('nib', body) as Script
}

function plain(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value ?? null)) as unknown
  } catch {
    return String(value)
  }
}
