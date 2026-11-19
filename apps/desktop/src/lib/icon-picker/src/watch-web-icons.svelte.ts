import { untrack } from 'svelte'
import { links } from '../../link-index/src/api'
import { samePath } from '../../platform/src/api'
import { workspace } from '../../workspace/src/api'
import { sweepSpace } from './web-icons'

export function watchWebIcons(): () => void {
  return $effect.root(() => {
    $effect(() => {
      const root = workspace.activeSpace?.root ?? null
      if (root === null || links.scanning) return
      untrack(() => {
        if (samePath(links.rootOf(), root)) sweepSpace(root)
      })
    })
  })
}
