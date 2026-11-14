<script lang="ts">
  import { tick } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { ACCENTS, accentSetting, accentTokens } from '../../../accents'
  import { paintsOver } from '../../../theme/src/api'
  import Swatches from '../../../Swatches.svelte'
  import { closeOnBack } from '../../../backstack.svelte'
  import { fade, fly, LAYER, scale } from '../../../motion'
  import { overlays } from '../../../overlays'
  import { SCHEME_CHOICES, SCHEME_NAMES } from './schemes'
  import { scrollbar } from '../../../scrollbar'
  import { settings } from '../../../settings.svelte'
  import { pullsAway } from '../../../sheet-pull'
  import { segmented } from '../../../slide'
  import { type Scheme, type SchemeChoice, theme } from '../../../theme/src/api'
  import { store } from '../gallery/store.svelte'
  import { trap } from '../../../trap'
  import { viewport } from '../../../viewport.svelte'
  import { type Look, lookOf } from './looks'
  import Mini from './Mini.svelte'
  import { picking } from './picking.svelte'

  const SIDES: Scheme[] = ['light', 'dark']

  let tokens = $state<string | null>(null)
  void import('@orden/themes/tokens.css?raw').then((one) => (tokens = one.default))

  const custom = $derived(
    picking.open ? (document.getElementById('orden-custom-css')?.textContent ?? '') : '',
  )

  type Info = (typeof theme.all)[number]

  function looksOf(one: Info): Look[] {
    if (tokens === null) return []

    const sheets = [tokens, one.css ?? '', custom]
    return SIDES.filter((side) => one.variants.includes(side)).map((side) =>
      lookOf(sheets, side, {
        ...(paintsOver(one.css ?? '', accentSetting()) ? {} : accentTokens(theme.accent, side)),
        ...(one.pictured === true ? dimOf(one.id) : {}),
      }),
    )
  }

  function dimOf(id: string): Record<string, string> {
    const dim = theme.keptFor(id, 'dim')
    return typeof dim === 'number' ? { '--orden-dim': `${dim}%` } : {}
  }

  const shown = $derived.by(() => {
    const term = picking.query.trim().toLowerCase()
    return term ? theme.all.filter((one) => one.name.toLowerCase().includes(term)) : theme.all
  })

  let browsing = $state(false)

  const cursor = $derived(
    browsing
      ? shown.length
      : shown.findIndex((one) => one.id === (picking.pointed.id ?? picking.kept.id)),
  )

  const COLUMNS = 3

  const seeing = $derived(
    picking.pointed.id !== null
      ? 'id'
      : picking.pointed.scheme !== null
        ? 'scheme'
        : picking.pointed.accent !== null
          ? 'accent'
          : null,
  )

  const keptScheme = $derived<SchemeChoice>(theme.switchable ? picking.kept.scheme : theme.current)

  const place = $derived.by(() => {
    const at = picking.at
    if (viewport.touch || !at) return null

    const tall = window.innerHeight
    const above = at.top > tall / 2
    return {
      above,
      left: `clamp(8px, ${at.x - 24}px, calc(100vw - var(--picker-width) - 8px))`,
      y: above ? tall - at.top + 6 : at.bottom + 6,
      room: above ? at.top - 14 : tall - at.bottom - 14,
    }
  })

  let grid = $state<HTMLElement>()

  let panel = $state<HTMLElement>()
  $effect(() =>
    picking.open
      ? overlays.show(
          () => picking.close(),
          () => [panel],
        )
      : undefined,
  )
  $effect(() => closeOnBack(picking.open, () => picking.close()))

  function arriving(node: Element) {
    return viewport.touch
      ? fly(node, { y: 48, duration: LAYER.rise, easing: cubicOut })
      : scale(node, { duration: LAYER.rise, start: LAYER.start, easing: cubicOut })
  }

  async function moveTo(index: number) {
    const last = shown.length
    const to = Math.max(0, Math.min(index, last))
    const one = shown[to]

    browsing = to === last
    picking.point('id', one ? one.id : null)

    await tick()
    grid?.querySelector('.card.is-on')?.scrollIntoView({ block: 'nearest' })
  }

  function typed(text: string) {
    picking.query = text
    browsing = false

    const first = shown[0]
    if (!text.trim()) picking.point('id', null)
    else if (first) picking.point('id', first.id)
    else void moveTo(shown.length)
  }

  function choose(id: string) {
    picking.keepTheme(id)
    if (!viewport.touch) picking.close()
  }

  function browse() {
    const term = picking.query.trim()
    picking.close()
    settings.show('appearance')
    store.query = term
    store.show()
  }

  function spend(event: KeyboardEvent) {
    event.preventDefault()
    event.stopPropagation()
  }

  function onKeydown(event: KeyboardEvent) {
    const steps: Record<string, number> = {
      ArrowDown: COLUMNS,
      ArrowUp: -COLUMNS,
      ArrowRight: 1,
      ArrowLeft: -1,
    }
    const step = steps[event.key]

    if (step !== undefined) {
      spend(event)
      void moveTo(cursor < 0 ? 0 : cursor + step)
      return
    }

    if ((event.key === 'Home' || event.key === 'End') && (event.ctrlKey || event.metaKey)) {
      spend(event)
      void moveTo(event.key === 'Home' ? 0 : shown.length)
      return
    }

    if (event.key !== 'Enter') return
    spend(event)
    if (browsing) browse()
    else choose(picking.pointed.id ?? picking.kept.id)
  }
</script>

<svelte:window onresize={() => place && picking.close()} />

{#if picking.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="orden-scrim is-clear scrim"
    transition:fade={{ duration: LAYER.fade }}
    onclick={() => picking.close()}
  ></div>

  <div
    class="picker orden-host"
    class:orden-layer={place !== null}
    class:orden-screen={place === null && !viewport.touch}
    class:sheet={viewport.touch}
    class:above={place?.above}
    data-seeing={seeing}
    style:left={place?.left}
    style:top={place && !place.above ? `${place.y}px` : undefined}
    style:bottom={place?.above ? `${place.y}px` : undefined}
    style:max-height={place ? `${place.room}px` : undefined}
    bind:this={panel}
    use:trap
    use:pullsAway={viewport.touch ? () => picking.close() : null}
    role="dialog"
    aria-modal="true"
    aria-label="Themes"
    tabindex="-1"
    transition:arriving
  >
    {#if viewport.touch}<div class="grip" aria-hidden="true"></div>{/if}

    <div class="head">
      <div class="orden-field find">
        <input
          value={picking.query}
          oninput={(event) => typed(event.currentTarget.value)}
          onkeydown={onKeydown}
          placeholder="Search themes"
          spellcheck="false"
          autocapitalize="off"
          autocorrect="off"
          role="combobox"
          aria-expanded="true"
          aria-controls="orden-theme-cards"
          aria-activedescendant={cursor >= 0 ? `orden-theme-${cursor}` : undefined}
          aria-label="Search themes"
          data-lands
        />
      </div>

      <div
        class="orden-segmented modes"
        role="radiogroup"
        tabindex="-1"
        aria-label="Mode"
        use:segmented
        onpointerleave={() => picking.point('scheme', null)}
      >
        {#each SCHEME_CHOICES as choice (choice)}
          <button
            type="button"
            class:on={choice === keptScheme}
            title={SCHEME_NAMES[choice]}
            aria-label={SCHEME_NAMES[choice]}
            aria-pressed={choice === keptScheme}
            disabled={!theme.offers(choice)}
            onpointermove={() => theme.offers(choice) && picking.point('scheme', choice)}
            onclick={() => picking.keepScheme(choice)}
          >
            <svg viewBox="0 0 14 14" aria-hidden="true">
              {#if choice === 'system'}
                <circle cx="7" cy="7" r="5.2" /><path
                  class="half"
                  d="M7 1.8a5.2 5.2 0 0 1 0 10.4z"
                />
              {:else if choice === 'dark'}
                <path d="M12 8.6A5.6 5.6 0 1 1 5.4 2a4.4 4.4 0 0 0 6.6 6.6z" />
              {:else}
                <circle cx="7" cy="7" r="3" /><path
                  d="M7 0v2M7 12v2M0 7h2M12 7h2M2.5 2.5l1.4 1.4M10.1 10.1l1.4 1.4M11.5 2.5l-1.4 1.4M3.9 10.1l-1.4 1.4"
                />
              {/if}
            </svg>
          </button>
        {/each}
      </div>
    </div>

    <div
      bind:this={grid}
      id="orden-theme-cards"
      class="grid"
      style:--columns={COLUMNS}
      role="listbox"
      tabindex="-1"
      aria-label="Themes"
      data-scrolls
      use:scrollbar={shown.length}
      onpointerleave={() => {
        browsing = false
        picking.point('id', null)
      }}
    >
      {#each shown as one, index (one.id)}
        <button
          type="button"
          class="card"
          class:is-on={index === cursor}
          class:kept={one.id === picking.kept.id}
          id="orden-theme-{index}"
          role="option"
          tabindex="-1"
          aria-selected={index === cursor}
          onpointermove={() => {
            browsing = false
            picking.point('id', one.id)
          }}
          onclick={() => choose(one.id)}
        >
          <Mini
            looks={looksOf(one)}
            desk={one.translucent === true}
            pictured={one.pictured === true}
          />
          <span class="name">{one.name}</span>
        </button>
      {/each}

      <button
        type="button"
        class="card browse"
        class:is-on={browsing}
        id="orden-theme-{shown.length}"
        role="option"
        tabindex="-1"
        aria-selected={browsing}
        onpointermove={() => {
          browsing = true
          picking.point('id', null)
        }}
        onclick={browse}
      >
        <span class="more">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
        </span>
        <span class="name">Browse</span>
      </button>
    </div>

    <div class="foot" class:owned={theme.accentIsTheme} inert={theme.accentIsTheme}>
      <Swatches
        options={ACCENTS.map((one) => ({
          value: one.id,
          label: one.name,
          colour: one[theme.current],
        }))}
        label="Accent"
        chosen={picking.kept.accent}
        onchoose={(id: string) => picking.keepAccent(id)}
        onpoint={(id: string | null) => picking.point('accent', id)}
      />
    </div>
  </div>
{/if}

<style>
  .scrim {
    --scrim-z: var(--z-menu);
  }

  .picker {
    --picker-width: var(--screen-list);
    --screen-width: var(--picker-width);

    position: fixed;
    z-index: var(--z-menu);
    width: min(var(--picker-width), calc(100vw - 16px));
    display: flex;
    flex-direction: column;
    max-height: calc(100dvh - 16px);
    overflow: hidden;
    transform-origin: top left;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  .picker[data-seeing] {
    border-color: transparent;
    background: transparent;
    box-shadow: none;
  }

  .head > *,
  .grid {
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .picker[data-seeing='id'] .head,
  .picker[data-seeing='accent'] .head {
    border-color: transparent;
  }

  .picker[data-seeing='id'] .head > :not(:focus-within),
  .picker[data-seeing='id'] .card:not(.is-on),
  .picker[data-seeing='id'] .foot,
  .picker[data-seeing='scheme'] .grid,
  .picker[data-seeing='scheme'] .foot,
  .picker[data-seeing='accent'] .head > :not(:focus-within),
  .picker[data-seeing='accent'] .grid {
    opacity: 0.08;
  }

  .picker[data-seeing='id'] .card.is-on {
    background: var(--surface);
    box-shadow: var(--shadow-lg);
  }

  .picker.orden-screen {
    transform-origin: top center;
  }

  .picker.above {
    transform-origin: bottom left;
  }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border-bottom: 1px solid var(--line);
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  .find {
    flex: 1;
    min-width: 0;
  }

  .modes {
    flex: none;
  }

  .modes button {
    padding: 0 var(--space-2);
  }

  .modes svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .modes .half {
    fill: currentColor;
  }

  .grid {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
    align-content: start;
    gap: var(--space-2);
    padding: var(--space-2);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
    padding: 5px;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    text-align: start;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      opacity var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  .card.is-on {
    background: var(--surface-hover);
    color: var(--text-strong);
  }

  .card :global(.mini) {
    transition:
      translate var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  .card.is-on :global(.mini) {
    translate: 0 -1px;
  }

  .card.kept :global(.mini) {
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--text) 12%, transparent),
      0 0 0 2px var(--surface),
      0 0 0 4px var(--accent);
  }

  .card:active {
    background: var(--surface-press);
  }

  .name {
    padding: 0 2px;
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card.kept .name {
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }

  .more {
    display: grid;
    place-items: center;
    aspect-ratio: 16 / 10;
    border: 1px dashed var(--line-strong);
    border-radius: var(--radius-sm);
    color: var(--muted);
  }

  .more svg {
    width: var(--icon-lg);
    height: var(--icon-lg);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
  }

  .foot {
    flex: none;
    padding: var(--space-2) var(--space-3) var(--space-3);
    border-top: 1px solid var(--line);
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .foot.owned {
    opacity: 0.4;
  }

  .sheet {
    top: auto;
    left: 0;
    right: 0;
    bottom: var(--keyboard, 0px);
    width: 100%;
    max-height: min(80dvh, calc(100dvh - var(--keyboard, 0px) - var(--space-5)));
    padding-bottom: var(--touch-bottom);
    border-top: 1px solid var(--line-strong);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: var(--surface);
    box-shadow: var(--shadow-lg);
  }

  .grip {
    flex: none;
    width: 36px;
    height: 4px;
    margin: 8px auto 2px;
    border-radius: 2px;
    background: var(--line-strong);
  }
</style>
