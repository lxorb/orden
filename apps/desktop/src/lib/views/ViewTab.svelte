<script lang="ts">
  import { untrack } from 'svelte'
  import type { Tab } from '../workspace/documents.svelte'
  import { kitFor } from './kit'
  import { LiveView } from './live.svelte'
  import { fileSource, tabSource } from './source'
  import { readSpec } from './spec'
  import ViewFrame from './ViewFrame.svelte'

  const { tab }: { tab: Tab } = $props()

  const which = $derived.by(() => {
    const spec = readSpec(tab.doc) ?? {}
    return JSON.stringify([spec.builtin, spec.space, spec.path, spec.tag, spec.view])
  })

  const made = $derived.by(() => {
    const view = which
    return untrack(() => make(view))
  })

  function make(view: string) {
    const spec = readSpec(tab.doc) ?? {}
    const path = tab.path
    const live = new LiveView(path === null ? tabSource(tab) : fileSource(path, spec.view))
    return { view, live, kit: kitFor(live, spec, path, false) }
  }

  $effect(() => {
    const now = made
    return untrack(() => now.live.start())
  })

  let seen = untrack(() => tab.doc)
  $effect(() => {
    const words = tab.doc
    if (words === seen) return
    seen = words
    if (tab.path === null) untrack(() => void made.live.reload())
  })
</script>

<div class="view-tab" data-region="editor">
  {#key made}
    <ViewFrame kit={made.kit} title={tab.shown} />
  {/key}
</div>

<style>
  .view-tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }
</style>
