<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { dur, fade } from '../../platform/src/api'
  import { isDesktop } from '../../platform/src/api'
  import { trap } from '../../ui-controls/src/api'
  import { BROWSERS, NOTES_APPS } from './catalog'
  import { gate } from './gate.svelte'
  import { type Box, guideCards, placeCard, shownBox, targetOf } from './guide'
  import { setup } from './setup-state.svelte'

  const WAIT = 600
  const SWAP = 180

  const notesApp = NOTES_APPS.find((one) => one.id === setup.answers.notes) ?? null
  const cards = guideCards({
    notes: setup.brought.notes && notesApp ? { id: notesApp.id, name: notesApp.name } : null,
    browser: setup.brought.browser
      ? (BROWSERS.find((one) => one.id === setup.answers.browser)?.name ?? null)
      : null,
    ai: setup.brought.ai,
    code: setup.answers.code,
    terminals: isDesktop,
  })

  let at = $state(0)
  let ready = $state(false)
  let swapping = $state(false)
  let width = $state(0)
  let height = $state(0)
  let room = $state({ width: innerWidth, height: innerHeight })
  let spot = $state<Box | null>(null)
  let left = $state(0)
  let top = $state(0)

  const card = $derived(cards[at] ?? cards[0])
  const last = $derived(at === cards.length - 1)

  function placing(size: { width: number; height: number }, shown: (typeof cards)[number]) {
    room = { width: innerWidth, height: innerHeight }
    const placed = placeCard(shownBox(targetOf(shown.at), room), size, room)
    spot = placed.spot
    left = placed.left
    top = placed.top
  }

  function place() {
    if (card) placing({ width, height }, card)
  }

  $effect(() => {
    const size = { width, height }
    const shown = card
    if (ready && shown) untrack(() => placing(size, shown))
  })

  function go(to: number) {
    swapping = true
    setTimeout(() => {
      at = to
      swapping = false
    }, dur(SWAP))
  }

  function next() {
    if (last) end()
    else go(at + 1)
  }

  function end() {
    gate.guiding = false
  }

  function pressed(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    end()
  }

  onMount(() => {
    const showing = setTimeout(() => (ready = true), WAIT)
    return () => clearTimeout(showing)
  })
</script>

<svelte:window onresize={place} onkeydown={pressed} />

{#if ready && card}
  <div class="guide" data-covers="all" transition:fade={{ duration: dur(300) }}>
    <div
      class="spot"
      class:none={spot === null}
      style:left="{spot?.x ?? room.width / 2}px"
      style:top="{spot?.y ?? room.height * 0.4}px"
      style:width="{spot?.width ?? 0}px"
      style:height="{spot?.height ?? 0}px"
    ></div>
    <div
      class="card"
      class:swapping
      role="dialog"
      aria-modal="true"
      aria-labelledby="guide-title"
      bind:offsetWidth={width}
      bind:offsetHeight={height}
      style:left="{left}px"
      style:top="{top}px"
      use:trap
    >
      <div class="title" id="guide-title" aria-live="polite">{card.title}</div>
      <div class="text">{card.text}</div>
      <div class="foot">
        <span class="dots" aria-hidden="true">
          {#each cards as one, index (one.title)}
            <i class:on={index === at}></i>
          {/each}
        </span>
        {#if !last}
          <button class="orden-button is-quiet small" type="button" onclick={end}> Skip </button>
        {/if}
        <button class="orden-button small" type="button" data-lands onclick={next}>
          {last ? 'Done' : 'Next'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .guide {
    position: fixed;
    inset: 0;
    z-index: var(--z-stage);
  }

  .spot {
    position: absolute;
    border-radius: 12px;
    box-shadow: 0 0 0 200vmax rgb(0 0 0 / 0.32);
    pointer-events: none;
    transition:
      left 0.55s var(--ease-out),
      top 0.55s var(--ease-out),
      width 0.55s var(--ease-out),
      height 0.55s var(--ease-out);
  }

  .card {
    position: absolute;
    width: min(320px, calc(100% - 32px));
    padding: 18px 18px 14px;
    border-radius: 16px;
    background: var(--bg);
    color: var(--text);
    box-shadow:
      0 18px 50px rgb(0 0 0 / 0.22),
      0 0 0 1px var(--line);
    transition:
      left 0.55s var(--ease-out),
      top 0.55s var(--ease-out),
      opacity 0.3s;
  }

  .card.swapping {
    opacity: 0;
  }

  .title {
    margin-bottom: 6px;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-strong);
  }

  .text {
    font-size: 14px;
    line-height: 1.5;
    color: var(--muted);
  }

  .foot {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 16px;
  }

  .small {
    min-height: 34px;
    padding: 0 16px;
    font-size: 14px;
  }

  .dots {
    display: flex;
    gap: 5px;
    margin-inline-end: auto;
  }

  .dots i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--line);
    transition:
      background 0.3s,
      width 0.3s;
  }

  .dots i.on {
    width: 16px;
    border-radius: 3px;
    background: var(--accent);
  }

  @media (prefers-reduced-motion: reduce) {
    .spot,
    .card,
    .dots i {
      transition: none;
    }
  }
</style>
