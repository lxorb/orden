<script lang="ts">
  import { closeOnBack } from './ui-kit/src/api'
  import { overlays } from './ui-kit/src/api'
  import Twist from './Twist.svelte'
  import { workspace } from './workspace.svelte'
  import {
    DEEPEST,
    LEAST_DISTANCE,
    LEAST_FADE,
    LEAST_LINES,
    LEAST_PUSH,
    LEAST_SPREAD,
    MOST_DISTANCE,
    MOST_FADE,
    MOST_GROUPS,
    MOST_LINES,
    MOST_PUSH,
    MOST_SPREAD,
    SHALLOWEST,
  } from './workspace/graph-settings.svelte'

  const {
    open,
    span,
    at,
    playing,
    onopen,
    onplay,
    onscrub,
  }: {
    open: boolean
    span: { from: number; to: number } | null
    at: number
    playing: boolean
    onopen: (open: boolean) => void
    onplay: () => void
    onscrub: (at: number) => void
  } = $props()

  const CARD_MARK = 'M2 3.5h9M2 9.5h9M4.6 1.9v3.2M8.4 7.9v3.2'
  const ADD_MARK = 'M6.5 3v7M3 6.5h7'
  const DROP_MARK = 'M3.8 3.8l5.4 5.4M9.2 3.8l-5.4 5.4'
  const PLAY_MARK = 'M4 2.6 10.4 6.5 4 10.4z'
  const PAUSE_MARK = 'M4.4 3v7M8.6 3v7'

  const settings = $derived(workspace.graphSettings.here)
  const spread = $derived(settings.spread)

  let forcing = $state(false)

  let corner = $state<HTMLElement>()
  $effect(() =>
    open
      ? overlays.show(
          () => onopen(false),
          () => [corner],
        )
      : undefined,
  )
  $effect(() => closeOnBack(open, () => onopen(false)))

  function addGroup() {
    const held = settings.groups
    const colour = (held.length % MOST_GROUPS) + 1
    workspace.graphSettings.set({ groups: [...held, { query: '', colour }] })
  }

  function setGroup(index: number, change: { query?: string; colour?: number }) {
    workspace.graphSettings.set({
      groups: settings.groups.map((group, one) =>
        one === index ? { ...group, ...change } : group,
      ),
    })
  }

  function dropGroup(index: number) {
    workspace.graphSettings.set({ groups: settings.groups.filter((_one, at) => at !== index) })
  }

  function nextColour(index: number, colour: number) {
    setGroup(index, { colour: (colour % MOST_GROUPS) + 1 })
  }

  async function keepView() {
    const { prompt } = await import('./ui-kit/src/api')
    const name = await prompt.ask({ title: 'Add view to Essentials', confirmLabel: 'Keep' })
    if (!name) return

    workspace.bookmarks.toggle(workspace.bookmarks.forGraph(name, settings))
  }
</script>

<div class="corner" bind:this={corner}>
  {#if open}
    <div class="orden-layer card">
      <input
        class="orden-field"
        type="text"
        value={settings.filter}
        placeholder="Name, path or tag"
        aria-label="Filter"
        spellcheck="false"
        autocapitalize="off"
        autocorrect="off"
        oninput={(event) => workspace.graphSettings.set({ filter: event.currentTarget.value })}
      />

      <button
        class="orden-row"
        role="switch"
        aria-checked={settings.orphans}
        onclick={() => workspace.graphSettings.set({ orphans: !settings.orphans })}
      >
        <span class="orden-row-label">Orphans</span>
        <span class="orden-switch" class:on={settings.orphans} aria-hidden="true"></span>
      </button>

      <button
        class="orden-row"
        role="switch"
        aria-checked={settings.attachments}
        onclick={() => workspace.graphSettings.set({ attachments: !settings.attachments })}
      >
        <span class="orden-row-label">Attachments</span>
        <span class="orden-switch" class:on={settings.attachments} aria-hidden="true"></span>
      </button>

      <div class="dial">
        <span>Depth</span>
        <input
          class="orden-slider"
          type="range"
          min={SHALLOWEST}
          max={DEEPEST}
          step="1"
          value={settings.depth}
          aria-label="Depth"
          style:--fill="{((settings.depth - SHALLOWEST) / (DEEPEST - SHALLOWEST)) * 100}%"
          oninput={(event) =>
            workspace.graphSettings.set({ depth: Number(event.currentTarget.value) })}
        />
      </div>

      <div class="rule"></div>

      {#each settings.groups as group, index (index)}
        <div class="group">
          <button
            class="swatch"
            style:--swatch="var(--canvas-{group.colour})"
            title="Colour {String(group.colour)}"
            aria-label="Colour {String(group.colour)}"
            onclick={() => nextColour(index, group.colour)}
          ></button>

          <input
            class="orden-field"
            type="text"
            value={group.query}
            placeholder="Name, path or tag"
            aria-label="Colour a group"
            spellcheck="false"
            autocapitalize="off"
            autocorrect="off"
            oninput={(event) => setGroup(index, { query: event.currentTarget.value })}
          />

          <button class="drop" title="Remove" aria-label="Remove" onclick={() => dropGroup(index)}>
            <svg viewBox="0 0 13 13"><path d={DROP_MARK} /></svg>
          </button>
        </div>
      {/each}

      {#if settings.groups.length < MOST_GROUPS}
        <button class="orden-row" onclick={addGroup}>
          <svg class="orden-row-mark" viewBox="0 0 13 13"><path d={ADD_MARK} /></svg>
          <span class="orden-row-label">Colour a group</span>
        </button>
      {/if}

      <div class="rule"></div>

      <button class="orden-row" aria-expanded={forcing} onclick={() => (forcing = !forcing)}>
        <span class="orden-row-label">Forces</span>
        <span class="chevron"><Twist open={forcing} /></span>
      </button>

      {#if forcing}
        <div class="dial">
          <span>Spread</span>
          <input
            class="orden-slider"
            type="range"
            min={LEAST_SPREAD}
            max={MOST_SPREAD}
            step="0.25"
            value={spread}
            aria-label="Spread"
            style:--fill="{((spread - LEAST_SPREAD) / (MOST_SPREAD - LEAST_SPREAD)) * 100}%"
            oninput={(event) =>
              workspace.graphSettings.set({ spread: Number(event.currentTarget.value) })}
          />
        </div>

        <div class="dial">
          <span>Link distance</span>
          <input
            class="orden-slider"
            type="range"
            min={LEAST_DISTANCE}
            max={MOST_DISTANCE}
            step="4"
            value={settings.distance}
            aria-label="Link distance"
            style:--fill="{((settings.distance - LEAST_DISTANCE) /
              (MOST_DISTANCE - LEAST_DISTANCE)) *
              100}%"
            oninput={(event) =>
              workspace.graphSettings.set({ distance: Number(event.currentTarget.value) })}
          />
        </div>

        <div class="dial">
          <span>Push</span>
          <input
            class="orden-slider"
            type="range"
            min={LEAST_PUSH}
            max={MOST_PUSH}
            step="10"
            value={settings.push}
            aria-label="Push"
            style:--fill="{((settings.push - LEAST_PUSH) / (MOST_PUSH - LEAST_PUSH)) * 100}%"
            oninput={(event) =>
              workspace.graphSettings.set({ push: Number(event.currentTarget.value) })}
          />
        </div>

        <button
          class="orden-row"
          role="switch"
          aria-checked={settings.gather}
          onclick={() => workspace.graphSettings.set({ gather: !settings.gather })}
        >
          <span class="orden-row-label">Gather</span>
          <span class="orden-switch" class:on={settings.gather} aria-hidden="true"></span>
        </button>
      {/if}

      <div class="dial">
        <span>Lines</span>
        <input
          class="orden-slider"
          type="range"
          min={LEAST_LINES}
          max={MOST_LINES}
          step="1"
          value={settings.lines}
          aria-label="Lines"
          style:--fill="{((settings.lines - LEAST_LINES) / (MOST_LINES - LEAST_LINES)) * 100}%"
          oninput={(event) =>
            workspace.graphSettings.set({ lines: Number(event.currentTarget.value) })}
        />
      </div>

      <div class="dial">
        <span>Text fade</span>
        <input
          class="orden-slider"
          type="range"
          min={LEAST_FADE}
          max={MOST_FADE}
          step="0.25"
          value={settings.fade}
          aria-label="Text fade"
          style:--fill="{((settings.fade - LEAST_FADE) / (MOST_FADE - LEAST_FADE)) * 100}%"
          oninput={(event) =>
            workspace.graphSettings.set({ fade: Number(event.currentTarget.value) })}
        />
      </div>

      <button
        class="orden-row"
        role="switch"
        aria-checked={settings.arrows}
        onclick={() => workspace.graphSettings.set({ arrows: !settings.arrows })}
      >
        <span class="orden-row-label">Arrows</span>
        <span class="orden-switch" class:on={settings.arrows} aria-hidden="true"></span>
      </button>

      <button
        class="orden-row"
        role="switch"
        aria-checked={settings.sized}
        onclick={() => workspace.graphSettings.set({ sized: !settings.sized })}
      >
        <span class="orden-row-label">Size by links</span>
        <span class="orden-switch" class:on={settings.sized} aria-hidden="true"></span>
      </button>

      {#if span}
        <div class="rule"></div>

        <div class="time">
          <button
            class="press"
            title={playing ? 'Pause' : 'Play'}
            aria-label={playing ? 'Pause' : 'Play'}
            onclick={onplay}
          >
            <svg viewBox="0 0 13 13" class:filled={!playing}>
              <path d={playing ? PAUSE_MARK : PLAY_MARK} />
            </svg>
          </button>

          <input
            class="orden-slider"
            type="range"
            min={span.from}
            max={span.to}
            step={Math.max(1, Math.round((span.to - span.from) / 400))}
            value={at}
            aria-label="Over time"
            style:--fill="{((at - span.from) / (span.to - span.from)) * 100}%"
            oninput={(event) => onscrub(Number(event.currentTarget.value))}
          />
        </div>
      {/if}

      <div class="rule"></div>

      <button class="orden-row" onclick={() => void keepView()}>
        <span class="orden-row-label">Add view to Essentials</span>
      </button>

      <button class="orden-row" onclick={() => workspace.graphSettings.reset()}>
        <span class="orden-row-label">Reset</span>
      </button>
    </div>
  {/if}

  <button
    class="tab"
    class:on={open}
    title="Graph controls"
    aria-label="Graph controls"
    aria-pressed={open}
    onclick={() => onopen(!open)}
  >
    <svg viewBox="0 0 13 13"><path d={CARD_MARK} /></svg>
  </button>
</div>

<style>
  .corner {
    position: absolute;
    inset-inline-start: var(--space-2);
    bottom: calc(var(--space-2) + var(--inset-bottom));
    z-index: var(--z-tools);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    max-width: calc(100% - 2 * var(--space-2));
  }

  .card {
    box-sizing: border-box;
    width: min(21rem, 100%);
    max-height: calc(100vh - 8rem);
    max-height: calc(100dvh - 8rem);
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: var(--space-2);
    overflow-y: auto;
    overscroll-behavior-y: contain;
    animation: lift var(--dur-fast) var(--ease-out);
  }

  @keyframes lift {
    from {
      opacity: 0;
      translate: 0 6px;
    }
  }

  .rule {
    flex: none;
    height: 1px;
    margin: var(--space-2) var(--row-pad);
    background: var(--line);
  }

  .group {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .group input {
    flex: 1;
    min-width: 0;
  }

  .swatch {
    flex: none;
    width: var(--icon-lg);
    height: var(--icon-lg);
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--swatch);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 28%, transparent);
    cursor: default;
    transition: scale var(--dur-fast) var(--ease-spring);
  }

  .swatch:active {
    scale: 1.08;
  }

  .tab,
  .drop,
  .press {
    flex: none;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--muted-strong);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .tab {
    background: var(--surface-3);
    border: 1px solid var(--line-strong);
    box-shadow: var(--shadow-md);
  }

  @media (hover: hover) {
    .drop:hover,
    .press:hover {
      color: var(--text-strong);
      background: var(--surface-hover);
    }

    .tab:hover {
      color: var(--text-strong);
      border-color: var(--muted);
    }
  }

  .drop:active,
  .press:active {
    background: var(--press);
  }

  .tab.on {
    color: var(--accent);
  }

  svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  svg.filled {
    fill: currentColor;
    stroke: none;
  }

  .chevron {
    display: block;
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
    color: var(--muted);
  }

  .dial {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--row-gap);
    min-height: var(--row-height);
    padding: 0 var(--row-pad);
  }

  .dial span {
    flex: none;
    min-width: 7rem;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
  }

  .dial input {
    flex: 0 1 11rem;
    min-width: 0;
  }

  .time {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .time input {
    flex: 1;
    min-width: 0;
  }

  :global([data-touch]) .tab,
  :global([data-touch]) .drop,
  :global([data-touch]) .press {
    width: var(--touch-target);
    height: var(--touch-target);
  }

  :global([data-touch]) svg {
    width: var(--icon-lg);
    height: var(--icon-lg);
  }
</style>
