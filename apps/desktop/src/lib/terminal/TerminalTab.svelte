<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import FindBar from '../FindBar.svelte'
  import Outward from '../Outward.svelte'
  import { dur, fly } from '../motion'
  import { hostOf } from '@orden/online/urls'
  import OnlineStatus from '../online/OnlineStatus.svelte'
  import type { Tab } from '../workspace.svelte'
  import { sessionOf } from './sessions.svelte'

  const { tab: shown, focused }: { tab: Tab; focused: boolean } = $props()

  const tab = untrack(() => shown)
  const session = sessionOf(tab)

  let place = $state<HTMLElement>()

  onMount(() => {
    if (place)
      void session.attach(
        place,
        untrack(() => focused),
      )

    return () => session.detach()
  })

  $effect(() => {
    if (focused) untrack(() => session.focus())
  })
</script>

<div class="terminal" data-region="editor">
  {#if session.finding}
    <FindBar
      query={session.query}
      count={session.found.count}
      current={session.found.at}
      onstep={(by: number) => session.step(by)}
      onclose={() => session.closeFind()}
      onquery={(typed: string) => session.look(typed)}
    />
  {/if}

  <div class="place" class:is-waiting={!session.live} bind:this={place}></div>

  {#if session.status}
    <OnlineStatus status={session.status} onretry={() => session.retry()} />
  {/if}

  {#if session.offline}
    <div class="bar offline" transition:fly={{ y: 8, duration: dur(150), easing: cubicOut }}>
      <button type="button" onclick={() => session.reconnect()}>Reconnect</button>
    </div>
  {:else if session.resumable !== null}
    <div class="bar" transition:fly={{ y: 8, duration: dur(150), easing: cubicOut }}>
      <button type="button" onclick={() => session.resume()}>Resume</button>
    </div>
  {:else if session.offered !== null}
    <div class="bar" transition:fly={{ y: 8, duration: dur(150), easing: cubicOut }}>
      <button type="button" onclick={() => session.openOffered()}
        ><span class="words">{hostOf(session.offered)}<Outward /></span></button
      >
    </div>
  {/if}
</div>

<style>
  .terminal {
    position: relative;
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--terminal-ground, var(--bg));
  }

  .place {
    position: relative;
    flex: 1;
    min-height: 0;
    transition: opacity var(--dur-base) var(--ease-out);
  }

  .place.is-waiting {
    opacity: 0.55;
  }

  .place :global(.orden-terminal) {
    position: absolute;
    inset: var(--space-2) 0 0 var(--space-3);
  }

  .place :global(.xterm) {
    height: 100%;
  }

  .place :global(.xterm-viewport) {
    background-color: transparent;
  }

  .place :global(.orden-echoing .xterm-cursor) {
    box-shadow: none !important;
    outline: none !important;
  }

  .bar {
    position: absolute;
    bottom: var(--space-4);
    left: 50%;
    translate: -50% 0;
    display: flex;
    padding: var(--space-1);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-md);
  }

  .bar button {
    padding: var(--space-1) var(--space-3);
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .bar .words {
    display: block;
  }

  @media (hover: hover) {
    .bar button:hover {
      background: var(--surface-hover);
    }
  }

  .bar button:active {
    background: var(--surface-press);
  }
</style>
