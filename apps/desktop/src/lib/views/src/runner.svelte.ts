import { isBaseTarget } from '@orden/markdown/links'
import { untrack } from 'svelte'
import { links } from '../../link-index.svelte'
import { rows } from '../../rows/rows.svelte'
import { basesOn } from '../../settings.svelte'
import { workspace } from '../../workspace.svelte'
import { basesAre, heardChange, readHeld, repeatTemplates } from './running'

$effect.root(() => {
  $effect(() => {
    const paths = basesOn()
      ? workspace.files.filter((one) => /\.base$/i.test(one.name)).map((one) => one.path)
      : []
    untrack(() => basesAre(paths))
  })
  $effect(() => {
    if (basesOn()) return
    const open = workspace.tabs.filter((one) => one.kind === 'view' && isBaseTarget(one.path ?? ''))
    untrack(() => {
      for (const tab of open) workspace.close(tab.id, false)
    })
  })
})

links.hearSaves((path) => {
  if (basesOn() && /\.base$/i.test(path)) void readHeld(path)
})

rows.watch(heardChange)

const repeat = () => void repeatTemplates().catch(() => undefined)
if (rows.ready) repeat()
else {
  const ready = rows.watch(() => {
    if (!rows.ready) return
    ready()
    repeat()
  })
}
setInterval(repeat, 30 * 60_000)
