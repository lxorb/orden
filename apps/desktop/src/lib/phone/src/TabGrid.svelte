<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { closeOnBack, Cross, portal } from '../../ui-kit/src/api'
  import { dur, fade, fly } from '../../platform/src/api'
  import { TabMark } from '../../marks/src/api'
  import { TAB_KINDS } from '../../tab-kinds/src/api'
  import type { Tab } from '../../documents/src/api'
  import { workspace, writeNew } from '../../workspace/src/api'
  import { tabsAway } from './swipe'

  const { onclose }: { onclose: () => void } = $props()
  const PLUS_MARK = 'M12 5v14M5 12h14'
  const PREVIEW = 600
  const tabs = $derived(workspace.tabsIn(workspace.panes.focusedId))
  const count = $derived(tabs.length === 1 ? '1 tab' : `${tabs.length} tabs`)
  let held = $state<{ id: string; x: number; dx: number; wide: number } | null>(null)
  let slid = false
  let flung = 0
  $effect(() => closeOnBack(true, onclose))
  $effect(() => {
    if (workspace.panel) onclose()
  })
  function pick(tab: Tab) {
    if (slid) return
    workspace.activate(tab.id)
    onclose()
  }
  function fresh(event: Event) {
    onclose()
    writeNew(event)
  }
  function down(event: PointerEvent, tab: Tab) {
    slid = false
    const card = event.currentTarget as HTMLElement
    held = { id: tab.id, x: event.clientX, dx: 0, wide: card.offsetWidth }
  }
  function moved(event: PointerEvent) {
    if (!held) return
    held.dx = event.clientX - held.x
    if (Math.abs(held.dx) > 8) slid = true
  }
  function up(tab: Tab) {
    const was = held
    held = null
    if (!was || !tabsAway(was.dx, was.wide)) return
    flung = was.dx
    workspace.close(tab.id)
  }
  function shut(tab: Tab) {
    flung = 0
    workspace.close(tab.id)
  }
  function keyed(event: KeyboardEvent) {
    if (event.key === 'Escape') onclose()
  }
  function preview(tab: Tab): string | null {
    return TAB_KINDS[tab.kind].editor ? tab.doc.trimStart().slice(0, PREVIEW) : null
  }
</script>

<svelte:window onkeydown={keyed} />

<div
  class="grid-sheet"
  role="dialog"
  aria-label="Tabs"
  data-tab-grid
  data-turns-pages
  use:portal
  transition:fade={{ duration: dur(160) }}
>
  <div class="cards">
    {#each tabs as tab (tab.id)}
      {@const on = tab.id === workspace.activeTabId}
      {@const away = held?.id === tab.id ? held.dx : 0}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="card"
        class:on
        class:held={held?.id === tab.id}
        data-tab-card={tab.id}
        style:translate={away ? `${away}px 0` : undefined}
        style:opacity={away && held ? 1 - Math.min(1, Math.abs(away) / held.wide) * 0.6 : undefined}
        onpointerdown={(event) => down(event, tab)}
        onpointermove={moved}
        onpointerup={() => up(tab)}
        onpointercancel={() => (held = null)}
        out:fly={{
          x: Math.sign(flung) * 160,
          y: flung ? 0 : 12,
          duration: dur(180),
          easing: cubicOut,
        }}
      >
        <div class="head">
          <span class="mark"><TabMark {tab} /></span>
          <span class="name" dir="auto">{tab.shown}</span>
          <button
            class="shut"
            aria-label="Close {tab.shown}"
            onpointerdown={(event) => event.stopPropagation()}
            onclick={() => shut(tab)}><Cross small /></button
          >
        </div>
        <button class="page" aria-label="Open {tab.shown}" onclick={() => pick(tab)}>
          {#if preview(tab) !== null}
            <span class="words" dir="auto">{preview(tab)}</span>
          {:else}
            <span class="big"><TabMark {tab} /></span>
          {/if}
        </button>
      </div>
    {:else}
      <p class="none">No open tabs</p>
    {/each}
  </div>

  <div class="bar">
    <button class="orden-glyph plus" aria-label="New note" onclick={fresh}>
      <svg viewBox="0 0 24 24"><path d={PLUS_MARK} /></svg>
    </button>
    <span class="count">{count}</span>
    <button class="done" onclick={onclose}>Done</button>
  </div>
</div>

<style>
  .grid-sheet {
    position: fixed;
    inset: 0;
    z-index: var(--z-sheet);
    display: flex;
    flex-direction: column;
    background: var(--surface);
    touch-action: pan-y;
  }
  .cards {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
    align-content: start;
    gap: var(--space-3);
    padding: calc(var(--inset-top) + var(--space-3)) max(var(--space-3), var(--inset-right)) var(--space-3)
      max(var(--space-3), var(--inset-left));
  }
  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    aspect-ratio: 3 / 4;
    min-width: 0;
    overflow: hidden;
    border-radius: var(--radius-lg);
    background: var(--bg);
    box-shadow:
      var(--shadow-sm),
      0 0 0 1px var(--line);
    touch-action: pan-y;
    transition:
      translate var(--dur-fast) var(--ease-out),
      opacity var(--dur-fast) var(--ease-out);
  }
  .card.held {
    transition: none;
  }
  .card.on {
    box-shadow:
      var(--shadow-sm),
      0 0 0 2px var(--accent);
  }
  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding-inline-start: var(--space-2);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
    box-shadow: inset 0 -1px var(--line);
  }
  .mark {
    flex: none;
    display: grid;
    place-items: center;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .shut {
    flex: none;
    width: var(--touch-target);
    height: var(--row-height);
    display: grid;
    place-items: center;
    padding: 0;
    border: none;
    background: none;
    color: var(--muted);
    -webkit-tap-highlight-color: transparent;
  }
  .shut :global(svg) {
    width: 10px;
    height: 10px;
    stroke-width: 1.4;
  }
  .page {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    padding: var(--space-2);
    overflow: hidden;
    border: none;
    background: none;
    color: var(--text);
    text-align: start;
    font: inherit;
    -webkit-tap-highlight-color: transparent;
    mask-image: linear-gradient(to bottom, black 70%, transparent);
  }
  .words {
    display: block;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: var(--font-content);
    font-size: 0.6875rem;
    line-height: 1.4;
  }
  .big {
    height: 100%;
    display: grid;
    place-items: center;
    color: var(--muted);
    transform: scale(2.4);
  }
  .none {
    grid-column: 1 / -1;
    margin: var(--space-6) 0;
    text-align: center;
    color: var(--muted);
  }
  .bar {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-height: var(--touch-row);
    padding: var(--space-1) max(var(--space-2), var(--inset-right)) max(var(--space-1), var(--inset-bottom))
      max(var(--space-2), var(--inset-left));
    background: var(--bg);
    box-shadow: inset 0 1px var(--line);
  }
  .plus svg {
    stroke-width: 2;
  }
  .count {
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--muted-strong);
  }
  .done {
    min-width: var(--touch-target);
    min-height: var(--touch-target);
    padding: 0 var(--space-2);
    border: none;
    background: none;
    color: var(--accent);
    font: inherit;
    font-weight: var(--weight-strong);
    -webkit-tap-highlight-color: transparent;
  }
</style>
