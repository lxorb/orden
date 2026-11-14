<script lang="ts">
  import LoaderCircle from 'lucide/dist/esm/icons/loader-circle.mjs'
  import { agentMarks } from './agent-marks.svelte'
  import { wearsChosen } from './chosen-icon'
  import { markOf } from './file-mark'
  import FileMark from './FileMark.svelte'
  import { ASK_MARK, GRAPH_MARK } from './panel-marks'
  import { terminalMark } from './surfaces.svelte'
  import { type Page, pages, siteMark } from './web-tab/src/api'
  import { readWebFile } from '@orden/scan/shortcut'
  import { type Tab, workspace } from './workspace.svelte'
  import { TAB_KINDS } from './workspace/tab-kinds'

  const { tab }: { tab: Tab } = $props()

  const mark = $derived(markOf(tab.kind))

  const traits = $derived(TAB_KINDS[tab.kind])

  const page = $derived<Page | null>(mark === 'web' ? pages.of(tab.id) : null)

  const file = $derived(page && tab.path !== null ? readWebFile(tab.path, tab.doc) : null)

  const found = $derived(
    page && !wearsChosen(tab.path)
      ? siteMark(page.icon, page.url ?? tab.address ?? file?.url, file?.icon)
      : null,
  )

  const worn = $derived(agentMarks.on[tab.id] ?? null)

  const opened = $derived(tab.id in agentMarks.opened)
  const front = $derived(workspace.showing(tab.paneId)?.id === tab.id)
  $effect(() => {
    if (!opened || !front) return
    agentMarks.opened = Object.fromEntries(
      Object.entries(agentMarks.opened).filter(([id]) => id !== tab.id),
    )
  })

  let broken = $state(false)

  $effect(() => {
    if (found) broken = false
  })
</script>

{#if worn}
  <span
    class="mark agent"
    class:turning={!worn.stopped}
    class:resting={worn.stopped}
    style:--agent={worn.colour}
    aria-hidden="true"
  >
    <svg viewBox="0 0 13 13"><path d={ASK_MARK} /></svg>
  </span>
{:else if opened && !front}
  <span class="mark agent resting" aria-hidden="true">
    <svg viewBox="0 0 13 13"><path d={ASK_MARK} /></svg>
  </span>
{:else if page?.loading}
  <span class="mark quiet turning" aria-hidden="true">
    <svg viewBox="0 0 24 24">
      {#each LoaderCircle as [tag, attrs], index (index)}
        <svelte:element this={tag} {...attrs} />
      {/each}
    </svg>
  </span>
{:else if found && !broken}
  <span class="mark" aria-hidden="true">
    <img src={found} alt="" draggable="false" onerror={() => (broken = true)} />
  </span>
{:else if traits.liveMark}
  {#await terminalMark()}
    <FileMark mark="terminal" />
  {:then Mark}
    <Mark {tab} />
  {:catch}
    <FileMark mark="terminal" />
  {/await}
{:else if mark}
  <FileMark
    {mark}
    path={tab.path ?? undefined}
    url={page ? (page.url ?? tab.address ?? file?.url ?? undefined) : undefined}
  />
{:else}
  <span class="mark quiet" aria-hidden="true">
    <svg class="graph" viewBox="0 0 13 13"
      ><path d={traits.glyph === 'ask' ? ASK_MARK : GRAPH_MARK} /></svg
    >
  </span>
{/if}

<style>
  .mark {
    display: block;
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
  }

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .quiet {
    opacity: 0.8;
  }

  svg {
    display: block;
    width: 100%;
    height: 100%;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .turning svg {
    stroke-width: 1.6;
    animation: turn 1s linear infinite;
  }

  .agent svg {
    fill: var(--agent);
    stroke: var(--agent);
    stroke-width: 0.6;
    transition:
      fill var(--dur-base) var(--ease-out),
      stroke var(--dur-base) var(--ease-out);
  }

  .agent.resting svg {
    fill: var(--muted);
    stroke: var(--muted);
  }

  .graph {
    stroke-width: calc(1.6 * 13 / 24);
  }

  @media (prefers-reduced-motion: reduce) {
    .turning svg {
      animation: none;
      opacity: 0.6;
    }
  }

  @keyframes turn {
    to {
      transform: rotate(1turn);
    }
  }
</style>
