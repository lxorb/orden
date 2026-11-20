import { isPanel, type Panel } from '../../session/src/api'
import { TAB_KINDS, type TabKind, type TabPanel } from '../../tab-kinds/src/api'

export interface Filling {
  kind: TabKind
  markdown: boolean
  headings: number
  footnotes: number
}
const declared = (panel: TabPanel, tab: Filling): boolean =>
  (TAB_KINDS[tab.kind].panels as readonly TabPanel[]).includes(panel)
const ASKS: Partial<Record<Panel, (tab: Filling) => boolean>> = {
  outline: (tab) =>
    declared('outline', tab) &&
    (tab.kind === 'pages' || tab.kind === 'pdf' || (tab.markdown && tab.headings + tab.footnotes > 0)),
  links: (tab) => declared('links', tab),
}
export function fills(id: Panel, tab: Filling | null): boolean {
  if (!isPanel(id)) return false
  const asks = ASKS[id]
  return !asks || (tab !== null && asks(tab))
}
