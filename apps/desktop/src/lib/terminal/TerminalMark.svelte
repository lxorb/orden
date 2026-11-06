<script lang="ts">
  import { chosenIcon, chosenTint } from '../chosen-icon'
  import Icon from '../Icon.svelte'
  import { readIcon, takesTint } from '../icons'
  import { marks } from '../online/marks.svelte'
  import { isTermTarget } from '@orden/markdown/links'
  import { remote } from '../remote/hosts.svelte'
  import type { Tab } from '../workspace/documents.svelte'
  import { TERMINAL_MARKS } from './marks'
  import { terminalMark } from './naming'
  import { hostIdOf, readSpec } from './spec'

  const { tab }: { tab: Pick<Tab, 'doc' | 'running'> & { id?: string; path?: string | null } } =
    $props()

  const online = $derived(isTermTarget(tab.path ?? null))
  const spec = $derived(online ? null : readSpec(tab.doc))
  const shell = $derived(spec?.shell ?? '')
  const mark = $derived(terminalMark(shell, tab.running?.program ?? null))
  const host = $derived(hostIdOf(shell))
  const colour = $derived(
    tab.running?.colour ?? (host === null ? null : (remote.byId(host)?.colour ?? null)),
  )
  const machine = $derived(online && tab.id !== undefined ? (marks.get(tab.id) ?? 'asleep') : null)

  const chosen = $derived(
    readIcon(online ? (tab.path ? chosenIcon(tab.path) : null) : (spec?.icon ?? null)),
  )
  const tint = $derived(
    online ? (tab.path ? chosenTint(tab.path) : null) : (spec?.iconColor ?? null),
  )

  $effect(() => {
    if (host !== null) void remote.ready()
  })
</script>

<span
  class="mark"
  class:is-coloured={colour !== null}
  class:is-online={online}
  class:is-picture={chosen !== null && !takesTint(chosen)}
  style:--host={colour === null ? undefined : `var(--canvas-${colour})`}
  data-mark={mark}
  data-machine={machine}
  aria-hidden="true"
>
  <span class="drawn"><Icon icon={chosen} {tint} fallback={TERMINAL_MARKS[mark]} /></span>
  {#if online}
    <svg class="cloud" viewBox="0 0 24 24"
      ><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" /></svg
    >
    {#if machine !== null && machine !== 'awake'}<span class="state"></span>{/if}
  {/if}
</span>

<style>
  .mark {
    position: relative;
    display: block;
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
    font-size: var(--icon-md);
    stroke: currentColor;
    stroke-width: 1.6;
    opacity: 0.8;
  }

  .mark.is-picture {
    opacity: 1;
  }

  .drawn {
    display: block;
    width: 100%;
    height: 100%;
  }

  .mark.is-coloured {
    color: var(--host);
    opacity: 1;
  }

  .is-online .drawn {
    mask: radial-gradient(circle at 100% 100%, transparent 46%, #000 47%);
  }

  .cloud {
    position: absolute;
    right: -1px;
    bottom: -1px;
    width: 58%;
    height: 58%;
    fill: none;
    stroke-width: 2.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .state {
    position: absolute;
    top: -1px;
    right: -1px;
    width: 5px;
    height: 5px;
    border: 1.2px solid currentColor;
    border-radius: 50%;
    box-sizing: border-box;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }

  [data-machine='starting'] .state,
  [data-machine='stopping'] .state {
    border-right-color: transparent;
    animation: turn 0.9s linear infinite;
  }

  [data-machine='near'] .state {
    border-color: var(--callout-warning);
    background: var(--callout-warning);
  }

  [data-machine='down'] .state {
    border-color: var(--danger);
  }

  @keyframes turn {
    to {
      rotate: 1turn;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    [data-machine='starting'] .state,
    [data-machine='stopping'] .state {
      animation: none;
    }
  }
</style>
