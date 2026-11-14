<script lang="ts">
  import type { Tab } from '../../workspace.svelte'
  import { TAB_KINDS } from '../../workspace/tab-kinds'
  import { SvelteSet } from 'svelte/reactivity'
  import { without } from '../../graph'
  import { links } from '../../link-index.svelte'
  import { workspace } from '../../workspace.svelte'
  import {
    askPanel,
    canvasSurface,
    graphSurface,
    chatSurface,
    explorerSurface,
    timeSurface,
    pagesSurface,
    viewSurface,
  } from '../../surfaces.svelte'
  import { faces } from './faces.svelte'
  import { snapshotFrom } from './mirror'

  const {
    tabs,
    width,
    height,
  }: {
    tabs: readonly Tab[]
    width: number
    height: number
  } = $props()

  const SETTLED = 250
  const SOONEST = 800
  const LONGEST = 2500

  const tried = new SvelteSet<string>()
  const next = $derived(
    tabs.find(
      (tab) => TAB_KINDS[tab.kind].preview === 'drawn' && !tried.has(tab.id) && !faces.of(tab.id),
    ) ?? null,
  )
  let current = $state<Tab | null>(null)
  let stage = $state<HTMLElement>()

  $effect(() => {
    const one = next
    if (current || !one) return
    tried.add(one.id)
    current = one
  })

  $effect(() => {
    const tab = current
    const node = stage
    if (!tab || !node) return
    let quiet: ReturnType<typeof setTimeout> | undefined
    const begun = performance.now()
    const done = () => {
      watching.disconnect()
      clearTimeout(quiet)
      clearTimeout(cap)
      if (current !== tab) return
      const box = new DOMRect(0, 0, width, height)
      if (node.childElementCount) faces.drew(tab, snapshotFrom(node, box)())
      current = null
    }
    const settle = () => {
      clearTimeout(quiet)
      const since = performance.now() - begun
      quiet = setTimeout(done, since > LONGEST ? 0 : Math.max(SETTLED, SOONEST - since))
    }
    const watching = new MutationObserver(settle)
    watching.observe(node, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    })
    const cap = setTimeout(done, LONGEST)
    settle()
    return () => {
      watching.disconnect()
      clearTimeout(quiet)
      clearTimeout(cap)
    }
  })
</script>

{#if current}
  <div
    class="offstage"
    style:width="{width}px"
    style:height="{height}px"
    inert
    aria-hidden="true"
    bind:this={stage}
  >
    {#key current.id}
      {#if current.kind === 'graph'}
        {#await graphSurface() then Graph}<Graph
            graph={without(
              links.pictureOf(workspace.graphSettings.here.attachments),
              workspace.leftOut,
            )}
            whole
            current={workspace.relativeNote}
            onopen={() => undefined}
            onescape={() => undefined}
          />{/await}
      {:else if current.kind === 'canvas'}
        {#await canvasSurface() then Canvas}<Canvas tab={current} focused={false} />{/await}
      {:else if current.kind === 'pages' || current.kind === 'pdf'}
        {#await pagesSurface() then Pages}<Pages tab={current} focused={false} />{/await}
      {:else if current.kind === 'view'}
        {#await viewSurface() then ViewTab}<ViewTab tab={current} />{/await}
      {:else if current.kind === 'channel'}
        {#await chatSurface() then ChatTab}<ChatTab tab={current} />{/await}
      {:else if current.kind === 'chat'}
        {#await askPanel() then ChatPanel}<ChatPanel wide />{/await}
      {:else if current.kind === 'explorer'}
        {#await explorerSurface() then ExplorerTab}<ExplorerTab
            tab={current}
            focused={false}
          />{/await}
      {:else if current.kind === 'time'}
        {#await timeSurface() then TimeTab}<TimeTab tab={current} />{/await}
      {/if}
    {/key}
  </div>
{/if}

<style>
  .offstage {
    position: fixed;
    top: 0;
    left: -100000px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg);
    pointer-events: none;
  }
</style>
