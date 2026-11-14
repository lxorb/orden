import { mount, unmount } from 'svelte'
import { workspace } from '../../workspace.svelte'
import { isUnsaved } from '../../workspace/drafts'
import SavePlace from './SavePlace.svelte'

let open: { tab: string; close: () => void } | null = null

export function askPlace(tabId: string | null, saved?: () => void): void {
  const tab = workspace.tabs.find((one) => one.id === (tabId ?? workspace.activeTabId))
  if (!tab || !isUnsaved(tab.note) || open?.tab === tab.id) return
  open?.close()

  let shown: ReturnType<typeof mount> | null = null
  const close = () => {
    if (!shown) return
    const going = shown
    shown = null
    if (open?.tab === tab.id) open = null
    void unmount(going, { outro: true })
  }

  shown = mount(SavePlace, {
    target: document.body,
    props: { tab, anchor: anchorOf(tab.id), onclose: close, onsaved: saved },
  })
  open = { tab: tab.id, close }
}

function anchorOf(id: string): DOMRect | null {
  const node =
    [...document.querySelectorAll<HTMLElement>('[data-tab]')].find(
      (one) => one.dataset.tab === id,
    ) ?? document.querySelector('[data-save-anchor]')
  const box = node?.getBoundingClientRect()
  return box && box.width > 0 ? box : null
}
