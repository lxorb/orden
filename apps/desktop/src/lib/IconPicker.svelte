<script lang="ts">
  import { account } from './accounts/src/api'
  import { ACCENTS } from './theme/src/api'
  import { closeOnBack } from './ui-kit/src/api'
  import Icon from './Icon.svelte'
  import { iconChoice } from './icon-choice.svelte'
  import { tintOf, wear, wornBy } from './icon-target'
  import { iconLibrary } from './icon-library.svelte'
  import { iconRecent } from './icon-recent.svelte'
  import { LATER_SETS, type LoadedSet, mergeSets, PICKER_SETS, pickerCredit } from './icon-sets'
  import {
    EMOJI_OUTLINE,
    type IconEntry,
    inOneColour,
    rankIcons,
    readIcon,
    sameIcon,
    SITE_ICONS,
    takesTint,
    writtenIcon,
  } from './ui-kit/src/api'
  import { dur, fade, LAYER, scale } from './platform/src/api'
  import { overlays } from './ui-kit/src/api'
  import { segmented } from './ui-kit/src/api'
  import { trap } from './ui-controls/src/api'
  import { viewport } from './ui-kit/src/api'
  import { untrack } from 'svelte'
  import { cubicOut } from 'svelte/easing'

  const POINTER_CELL = 38
  const TOUCH_CELL = 48
  const MARGIN = 2

  const FOUND = 300

  const SITE_ROWS = 2

  let query = $state('')
  let field = $state<HTMLInputElement>()
  let scroller = $state<HTMLElement>()
  let width = $state(0)
  let height = $state(0)
  let top = $state(0)
  let at = $state(0)
  let walked = $state(false)
  let tint = $state<string | null>(null)
  let outlined = $state(false)

  const cell = $derived(viewport.touch ? TOUCH_CELL : POINTER_CELL)
  const target = $derived(iconChoice.target)

  let wanted = $state(false)

  const worn = $derived(target === null ? null : wornBy(target))

  const written = $derived(readIcon(worn))

  const twins = $derived(outlined ? (iconLibrary.loaded[EMOJI_OUTLINE] ?? null) : null)

  const variant = (name: string): string => {
    const twin = twins?.twin?.(name)
    return twin ? writtenIcon(EMOJI_OUTLINE, twin) : name
  }

  const shows = (name: string): boolean => !twins || inOneColour(readIcon(variant(name)))

  const pending = $derived(PICKER_SETS.some((id) => !LATER_SETS.has(id) && iconLibrary.loading(id)))
  const absent = $derived(PICKER_SETS.every((id) => iconLibrary.absent[id]))

  const held = $derived.by(() => {
    if (pending || absent) return null

    const parts: { id: string; held: LoadedSet }[] = []
    for (const id of PICKER_SETS) {
      const one = iconLibrary.loaded[id]
      if (one) parts.push({ id, held: one })
    }

    return parts.length ? mergeSets(parts) : null
  })

  const signedIn = $derived(account.accountToken !== null)

  const siteSet = $derived.by(() => {
    const set = signedIn ? iconLibrary.loaded[SITE_ICONS] : undefined
    return set && !set.unoffered ? set : null
  })

  const sites = $derived.by((): IconEntry[] => {
    return (siteSet?.entries ?? []).map((one) => ({
      ...one,
      name: writtenIcon(SITE_ICONS, one.name),
    }))
  })

  const columns = $derived(Math.max(1, Math.floor((width || cell * 8) / cell)))

  const siteRow = $derived(sites.slice(0, columns * SITE_ROWS))

  const cells = $derived.by(() => {
    if (!held) return []
    if (query) return rankIcons([...sites, ...held.entries], query, FOUND).filter(shows)
    return [...siteRow.map((one) => one.name), ...held.entries.map((one) => one.name)].filter(shows)
  })

  type Row = { head: string } | { names: string[] } | { note: string }

  const rows = $derived.by((): Row[] => {
    if (!held) return []

    const runs = (names: readonly string[]): Row[] => {
      const out: Row[] = []
      for (let from = 0; from < names.length; from += columns) {
        out.push({ names: names.slice(from, from + columns) })
      }

      return out
    }

    if (query || !held.groups.length) return runs(cells)

    const web: Row[] =
      !siteSet || twins
        ? []
        : [
            { head: 'Web icons' },
            ...(siteRow.length
              ? runs(siteRow.map((one) => one.name))
              : [{ note: 'Sites you visit will appear here' }]),
          ]

    return [
      ...web,
      ...held.groups.flatMap((group) => [
        { head: group.label },
        ...runs(group.names.filter(shows)),
      ]),
    ]
  })

  const words = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const map = new Map<string, string>()

    for (const entry of held?.entries ?? []) map.set(entry.name, entry.words)
    for (const entry of sites) map.set(entry.name, entry.words)

    return map
  })

  const called = (name: string) => words.get(name) ?? name

  const rowOf = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const map = new Map<string, number>()

    rows.forEach((row, index) => {
      if ('names' in row) for (const name of row.names) map.set(name, index)
    })

    return map
  })

  const shown = $derived({
    from: Math.max(0, Math.floor(top / cell) - MARGIN),
    to: Math.min(rows.length, Math.ceil((top + height) / cell) + MARGIN),
  })

  const reads = (_value: unknown) => undefined

  const FOCUS = 40

  let focusing: ReturnType<typeof setTimeout> | undefined

  $effect(() => {
    const asked = iconChoice.target
    if (!asked) return

    const wears = untrack(() => readIcon(wornBy(asked)))
    const set = iconLibrary.setFor(wears)
    wanted = set !== null && LATER_SETS.has(set)
    if (set === EMOJI_OUTLINE) outlined = true
    else if (wears?.kind === 'emoji') outlined = false

    query = ''
    at = 0
    walked = false
    top = 0
    tint = untrack(() => tintOf(asked))

    if (untrack(() => iconLibrary.loaded[SITE_ICONS])) {
      void import('./web-tab/site-icons.svelte').then((one) => one.siteIcons.refresh())
    }

    clearTimeout(focusing)
    focusing = setTimeout(() => field?.focus(), dur(FOCUS))
  })

  $effect(() => {
    if (!target) return
    const all = wanted || query.trim() !== ''
    for (const id of PICKER_SETS) if (all || !LATER_SETS.has(id)) iconLibrary.load(id)
    if (signedIn) iconLibrary.load(SITE_ICONS)
    if (outlined) iconLibrary.load(EMOJI_OUTLINE)
  })

  $effect(() => {
    if (!wanted && held && height && top + height * 2 >= rows.length * cell) wanted = true
  })

  $effect(() => {
    reads(query)
    at = 0
    walked = false
  })

  $effect(() => () => clearTimeout(focusing))

  $effect(() => (target ? overlays.show(() => iconChoice.close()) : undefined))
  $effect(() => closeOnBack(target !== null, () => iconChoice.close()))

  function chose(said: string | null) {
    const asked = iconChoice.target
    if (!asked) return

    const colour = takesTint(readIcon(said)) ? tint : null

    wear(asked, said, colour)

    iconRecent.add(said)
    iconChoice.close()
  }

  function paint(colour: string | null) {
    tint = colour

    const asked = iconChoice.target
    if (!asked || !takesTint(written) || worn === null) return

    wear(asked, worn, colour)
  }

  function onKey(event: KeyboardEvent) {
    const steps: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: columns,
      ArrowUp: -columns,
    }

    const step = steps[event.key]
    if (step !== undefined && cells.length) {
      event.preventDefault()
      if (walked) at = Math.min(cells.length - 1, Math.max(0, at + step))
      walked = true
      reach(cells[at])
      return
    }

    const here = cells[at]
    if (event.key === 'Enter' && here !== undefined) {
      event.preventDefault()
      chose(variant(here))
    }
  }

  function reach(name: string | undefined) {
    const row = name === undefined ? undefined : rowOf.get(name)
    if (row === undefined || !scroller) return

    const start = row * cell
    if (start < scroller.scrollTop) scroller.scrollTop = start
    else if (start + cell > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = start + cell - scroller.clientHeight
    }
  }
</script>

{#if target}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="orden-scrim scrim"
    transition:fade={{ duration: LAYER.fade }}
    onclick={() => iconChoice.close()}
  ></div>

  <div
    class="orden-screen sheet"
    use:trap
    role="dialog"
    aria-modal="true"
    aria-label="Choose an icon"
    style:--cell="{cell}px"
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    <input
      class="orden-field"
      bind:this={field}
      bind:value={query}
      onkeydown={onKey}
      placeholder="Search icons - work, journal, money…"
      spellcheck="false"
      autocapitalize="off"
      autocorrect="off"
    />

    {#if iconRecent.list.length}
      <div class="recent">
        {#each iconRecent.list as one (one)}
          <button
            type="button"
            class="cell"
            title={one}
            aria-label={one}
            class:active={sameIcon(one, worn)}
            onclick={() => chose(one)}
          >
            <span class="glyph"><Icon icon={readIcon(one)} {tint} /></span>
          </button>
        {/each}
      </div>
    {/if}

    <div
      class="grid"
      bind:this={scroller}
      bind:clientWidth={width}
      bind:clientHeight={height}
      onscroll={() => (top = scroller?.scrollTop ?? 0)}
    >
      {#if absent}
        <p class="empty">That set is not here</p>
      {:else if !held}
        <p class="empty">Loading…</p>
      {:else if !cells.length}
        <p class="empty">Nothing found</p>
      {:else}
        <div class="tall" style:height="{rows.length * cell}px">
          {#each rows.slice(shown.from, shown.to) as row, index (shown.from + index)}
            <div class="row" style:top="{(shown.from + index) * cell}px">
              {#if 'head' in row}
                <span class="head">{row.head}</span>
              {:else if 'note' in row}
                <span class="note">{row.note}</span>
              {:else}
                {#each row.names as written (written)}
                  {@const label = called(written)}
                  {@const value = variant(written)}
                  <button
                    type="button"
                    class="cell"
                    title={label}
                    aria-label={label}
                    class:active={sameIcon(value, worn)}
                    class:at={walked && cells[at] === written}
                    onclick={() => chose(value)}
                  >
                    <span class="glyph"><Icon icon={readIcon(value)} {tint} /></span>
                  </button>
                {/each}
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    {#if !iconLibrary.absent[EMOJI_OUTLINE]}
      <div class="orden-segmented variant" role="radiogroup" aria-label="Emoji" use:segmented>
        <button
          type="button"
          role="radio"
          aria-checked={!outlined}
          class:on={!outlined}
          onclick={() => (outlined = false)}
        >
          Colour
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={outlined}
          class:on={outlined}
          onclick={() => (outlined = true)}
        >
          One colour
        </button>
      </div>
    {/if}

    {#if target.kind !== 'pass'}
      <div class="tints" role="group" aria-label="Colour">
        <button
          type="button"
          class="tint plain"
          aria-label="Plain"
          aria-pressed={tint === null}
          class:on={tint === null}
          onclick={() => paint(null)}
        ></button>
        {#each ACCENTS as accent (accent.id)}
          <button
            type="button"
            class="tint"
            aria-label={accent.name}
            aria-pressed={tint === accent.id}
            class:on={tint === accent.id}
            style:--dot={accent.dark}
            onclick={() => paint(accent.id)}
          ></button>
        {/each}
      </div>
    {/if}

    <button class="clear" onclick={() => chose(null)}>
      {target.kind === 'space' ? 'Use the first letter instead' : 'Use the plain mark instead'}
    </button>

    <p class="credit">{pickerCredit()}</p>
  </div>
{/if}

<style>
  .sheet {
    --screen-width: var(--screen-sheet);

    z-index: var(--z-sheet);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
  }

  .grid {
    min-height: 0;
    max-height: 46vh;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .tall {
    position: relative;
  }

  .row {
    position: absolute;
    inset-inline: 0;
    height: var(--cell);
    display: flex;
    align-items: center;
  }

  .head {
    padding: 0 calc((var(--cell) - var(--icon-lg)) / 2);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--muted);
  }

  .note {
    padding: 0 calc((var(--cell) - var(--icon-lg)) / 2);
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .recent {
    display: flex;
    overflow: hidden;
  }

  .cell {
    width: var(--cell);
    height: var(--cell);
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    cursor: default;
    transition:
      background var(--dur-instant) var(--ease-out),
      color var(--dur-instant) var(--ease-out);
  }

  .cell.at {
    box-shadow: inset 0 0 0 2px var(--accent);
    color: var(--text-strong);
  }

  @media (hover: hover) {
    .cell:hover {
      background: var(--accent-soft);
      color: var(--text-strong);
    }
  }

  .cell.active {
    background: var(--accent);
    color: var(--accent-ink);
  }

  .glyph {
    display: block;
    width: var(--icon-lg);
    height: var(--icon-lg);
    font-size: var(--icon-lg);
    stroke: currentColor;
    stroke-width: 1.8;
  }

  .empty {
    margin: 0;
    padding: var(--space-5) 0;
    text-align: center;
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .credit {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .tints {
    display: flex;
    gap: 6px;
  }

  .variant {
    align-self: flex-start;
  }

  .tint {
    width: 18px;
    height: 18px;
    flex: none;
    border: 1px solid var(--line-strong);
    border-radius: 50%;
    background: var(--dot);
    cursor: default;
  }

  .plain {
    background: var(--text);
  }

  .tint.on {
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 3px var(--accent);
  }

  .clear {
    align-self: flex-start;
    padding: 6px 10px;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: default;
  }

  .clear:hover {
    background: var(--surface-2);
    color: var(--text-strong);
  }

  :global([data-touch]) .sheet {
    top: auto;
    bottom: var(--keyboard);
    left: 0;
    translate: none;
    width: 100%;
    max-height: min(88dvh, calc(100dvh - var(--keyboard) - var(--inset-top)));
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    padding-bottom: var(--touch-bottom);
  }
</style>
