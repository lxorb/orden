import { reveal, showLabel } from '../../../files-out/src/api'
import { links } from '../../../link-index/src/api'
import { fileMark } from '../../../marks/src/api'
import { isDesktop, nameOf, platform, spaceHolding } from '../../../platform/src/api'
import { menu, type MenuEntry, viewport } from '../../../ui-kit/src/api'
import { howFor, opensLink, type TabAsk, tabAsk, workspace } from '../../../workspace/src/api'
import { type Here, placeOf, withPaths } from './paths'

let home: string | null = null
const homeFound =
  isDesktop && !__EVEN_PLUGIN__
    ? import('@tauri-apps/api/path')
        .then((path) => path.homeDir())
        .then((found) => (home = found))
        .catch(() => null)
    : Promise.resolve(null)
function opensHere(path: string): boolean {
  if (spaceHolding(workspace.spaces, path) === null) return false
  const mark = fileMark(nameOf(path))
  return mark !== 'file' && mark !== 'picture'
}
function chatHere(root: string | null): Here {
  return {
    root,
    system: platform(),
    spaces: workspace.spaces,
    holds: (path) => links.holdsFile(path),
    opens: opensHere,
    reveals: isDesktop && !__EVEN_PLUGIN__,
  }
}
export const chatPaths = (html: string, root: string | null): string => withPaths(html, chatHere(root))
const saidAt = (event: MouseEvent): string | null =>
  (event.target as Element | null)?.closest<HTMLElement>('[data-path]')?.dataset.path ?? null
async function open(path: string, ask: TabAsk) {
  if (viewport.drawer) workspace.closePanel('right')
  await workspace.openEntry(path, howFor(ask))
}
async function placed(said: string, root: string | null): Promise<string | null> {
  if (/^~[\\/]/.test(said.trim())) await homeFound
  return placeOf(said, chatHere(root), home)
}
export function followPath(event: MouseEvent, root: string | null): boolean {
  const said = saidAt(event)
  if (said === null || !opensLink(event)) return false
  event.preventDefault()
  const ask = tabAsk(event)
  void placed(said, root).then((path) => {
    if (path === null) return
    if (opensHere(path)) return open(path, ask)
    return reveal(path, { system: true })
  })
  return true
}
export function pathMenu(event: MouseEvent, root: string | null): boolean {
  const said = saidAt(event)
  const path = said === null ? null : placeOf(said, chatHere(root), home)
  if (path === null) return false
  const rows: MenuEntry[] = []
  if (opensHere(path)) rows.push({ label: 'Open in a new tab', run: () => void open(path, 'front') })
  if (chatHere(root).reveals) {
    rows.push({ label: showLabel(platform(), false), run: () => void reveal(path, { system: true }) })
  }
  if (!rows.length) return false
  menu.show(event, rows)
  return true
}
