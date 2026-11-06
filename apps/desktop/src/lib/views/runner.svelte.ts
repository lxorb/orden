import { untrack } from 'svelte'
import { links } from '../link-index.svelte'
import { rows } from '../rows/rows.svelte'
import { workspace } from '../workspace.svelte'
import { basesAre, heardChange, readHeld, repeatTemplates } from './running'

$effect.root(() => {
  $effect(() => {
    const paths = workspace.files.filter((one) => /\.base$/i.test(one.name)).map((one) => one.path)
    untrack(() => basesAre(paths))
  })
})

links.hearSaves((path) => {
  if (/\.base$/i.test(path)) void readHeld(path)
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
