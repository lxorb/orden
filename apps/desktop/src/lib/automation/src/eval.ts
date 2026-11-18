import { links } from '../../link-index/src/api'
import { invoke } from '../../platform/src/api'
import { workspace } from '../../workspace/src/api'
import { portOf, searching, settingsWindow } from '@orden/contracts'

async function working(path: string): Promise<string | null> {
  const { workingFolder } = await import('../../web-backend/src/api')
  return workingFolder(path)
}

function surface(): Record<string, unknown> {
  const web = portOf('web.scripts')
  const pages = web.ok ? web.value.pages : undefined
  const search = searching()?.panel
  return { workspace, links, search, settings: settingsWindow(), pages, invoke, working }
}

export async function evaluate(code: string): Promise<unknown> {
  const given = surface()
  const answer = await compiled(code)(given)
  return plain(answer)
}

type Script = (orden: Record<string, unknown>) => Promise<unknown>

function compiled(code: string): Script {
  try {
    return made(`return (async () => (${code}))()`)
  } catch {
    return made(`return (async () => { ${code} })()`)
  }
}

function made(body: string): Script {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- turning a string into code is the whole verb
  return new Function('orden', body) as Script
}

function plain(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value ?? null)) as unknown
  } catch {
    return String(value)
  }
}
