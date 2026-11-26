import { fileBytes, invoke, isNative, keep, storedText } from '../../platform/src/api'
import { handOver, type ZipEntry, zipOf } from '../../files-out/src/api'

const SWITCH = 'orden:web-ending'
const DISMISSED = 'orden:web-ending-dismissed'
export const ENDS = '<date>'
export const GET_ORDEN = 'https://orden.so/download?from=web-ending'
export const EXPORT_NAME = 'Orden export.zip'
export const WEB_ENDING = `Orden on the web ends on ${ENDS}. Get Orden for your desktop, or Orden Notes, Todo, Chat and Track for your phone.`
export const WEB_EXPORTED = `Your spaces were saved as ${EXPORT_NAME}. Orden on the web ends on ${ENDS}.`
function dayOf(now: Date): string {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}
export function webEndingDue(
  now: Date = new Date(),
  search: string = location.search,
  driven: boolean = __DRIVEABLE__,
): boolean {
  if (isNative || new URLSearchParams(search).has('demo')) return false
  if (driven && storedText(SWITCH) !== 'show') return false
  return storedText(DISMISSED) !== dayOf(now)
}
export function dismissWebEnding(now: Date = new Date()): void {
  keep(DISMISSED, dayOf(now))
}
interface Listed {
  path: string
  is_dir: boolean
  children?: Listed[]
}
function filesIn(node: Listed): string[] {
  return (node.children ?? []).flatMap((child) => (child.is_dir ? filesIn(child) : [child.path]))
}
export async function spaceEntries(roots: readonly string[]): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = []
  for (const root of roots) {
    const tree = await invoke<Listed>('read_tree', {
      root,
      options: { every: true, papers: true, showHidden: false },
    })
    for (const path of filesIn(tree)) {
      entries.push({ path: path.replace(/\\/g, '/').replace(/^\/+/, ''), body: await fileBytes(path) })
    }
  }
  return entries
}
export async function exportSpaces(roots: readonly string[]): Promise<number> {
  const entries = await spaceEntries(roots)
  const bytes = await zipOf(entries)
  handOver(EXPORT_NAME, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }))
  return entries.length
}
