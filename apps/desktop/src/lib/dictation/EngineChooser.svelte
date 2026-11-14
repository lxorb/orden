<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { transcriberNow } from '../ai/hears'
  import { dur, fly } from '../platform/src/api'
  import { overlays } from '../overlays'
  import { type Engine, engines, whereTo } from './engines.svelte'
  import { local } from './local.svelte'
  import { type Dictates, voice } from './voice.svelte'

  const { owner, button, below }: { owner: Dictates; button: HTMLButtonElement; below: boolean } =
    $props()

  let layer = $state<HTMLElement>()

  const place = $derived.by(() => {
    const at = button.getBoundingClientRect()
    const gap = 6
    const edge = 8
    return {
      right: `${Math.max(edge, window.innerWidth - at.right)}px`,
      top: below ? `${at.bottom + gap}px` : 'auto',
      bottom: below ? 'auto' : `${window.innerHeight - at.top + gap}px`,
      most: `${Math.max(160, at.right - edge)}px`,
    }
  })

  $effect(() =>
    overlays.show(
      () => {
        if (voice.asking === owner) voice.asking = null
      },
      () => [layer, button],
    ),
  )

  function said(engine: Engine): { name: string; where: string } {
    if (engine === 'auto') {
      const fallback = engines.offered().find((one) => one === 'provider' || one === 'account')
      return {
        name: 'Auto',
        where: fallback
          ? `On this computer once its ${size()} speech model is here; until then ${said(fallback).name}`
          : here(),
      }
    }
    if (engine === 'local') return { name: 'This computer', where: here() }
    if (engine === 'device') {
      return {
        name: 'This device',
        where: 'Audio goes to this device’s speech recognition, which may use its maker’s servers',
      }
    }
    if (engine === 'account') {
      return {
        name: 'Orden account',
        where: 'Audio goes to Orden and Cloudflare, and is not kept',
      }
    }
    const provider = transcriberNow()
    const to = provider ? whereTo(provider) : { local: false, host: '' }
    return {
      name: provider?.name ?? 'Your AI provider',
      where: to.local ? 'Stays on this computer' : `Audio goes to ${to.host}`,
    }
  }

  function here(): string {
    return `Stays on this computer. Downloads a ${size()} speech model once`
  }

  function size(): string {
    return `${Math.round((local.machine?.model.bytes ?? 0) / 1e6)} MB`
  }

  function choose(engine: Engine) {
    engines.choose(engine)
    voice.asking = null
    void voice.start(owner)
  }
</script>

<div
  bind:this={layer}
  class="orden-layer chooser"
  style:right={place.right}
  style:top={place.top}
  style:bottom={place.bottom}
  style:--most={place.most}
  role="dialog"
  aria-label="Dictate with"
  transition:fly={{ y: below ? -4 : 4, duration: dur(130), easing: cubicOut }}
>
  <p class="head">Dictate with</p>
  {#each engines.offered() as engine (engine)}
    {@const one = said(engine)}
    <button
      type="button"
      class="orden-row road"
      onpointerdown={(event) => event.preventDefault()}
      onclick={() => choose(engine)}
    >
      <span class="words">
        <span class="name">{one.name}</span>
        <span class="where">{one.where}</span>
      </span>
    </button>
  {/each}
</div>

<style>
  .chooser {
    position: fixed;
    z-index: var(--z-popover);
    width: max-content;
    max-width: min(20rem, var(--most));
    padding: 4px;
  }

  .head {
    margin: 0;
    padding: 4px var(--row-pad) 2px;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
  }

  .road {
    height: auto;
    padding-block: 5px;
  }

  .words {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .name {
    color: var(--text-strong);
  }

  .where {
    color: var(--muted);
    font-size: var(--text-xs);
    white-space: normal;
  }
</style>
