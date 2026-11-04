<script lang="ts">
  /** The one picker in the app, for everything that can wear an icon: a note, a
   *  canvas or a folder in the file list, and the space itself. What is being chosen
   *  for is in icon-choice.svelte.ts rather than in a prop, because a row is drawn deep
   *  inside a tree of these components and a space is named somewhere else entirely;
   *  this is mounted once, over the whole page.
   *
   *  Every set, thousands of icons, one search field and no tabs (#1096): the question
   *  is always the same question - what should this wear - and which set holds the
   *  answer is nobody's business but icon-sets.ts's. A search ranks every icon of every
   *  set by how well it answers; with nothing typed, the last few chosen come first and
   *  then one list across all the sets. The sets arrive as the sheet first opens, and
   *  the brands, which are most of the weight, once somebody searches or scrolls to the
   *  end of the rest.
   *
   *  The grid draws only the rows on screen. Two thousand emoji is two thousand
   *  elements, and a sheet that took a second to open every time would be a sheet
   *  nobody used; what is drawn is the window plus a row on either side, which is a
   *  hundred-odd cells however large the set is.
   *
   *  What is left is where the icon is kept, and that is the one thing that differs
   *  between the targets: a note's and a canvas's belong to the file and are written
   *  into it, a folder's to the space that holds it, a space's to this device. Hence
   *  the last row, which says what the thing falls back to when it wears nothing - a
   *  letter for a space, and for everything in the file list the mark that says what
   *  it is. */
  import { account } from './account.svelte'
  import { ACCENTS } from './accents'
  import { closeOnBack } from './backstack.svelte'
  import Icon from './Icon.svelte'
  import { iconChoice } from './icon-choice.svelte'
  import { tintOf, wear, wornBy } from './icon-target'
  import { iconLibrary } from './icon-library.svelte'
  import { iconRecent } from './icon-recent.svelte'
  import { LATER_SETS, type LoadedSet, mergeSets, PICKER_SETS, pickerCredit } from './icon-sets'
  import {
    EMOJI_OUTLINE,
    type IconEntry,
    rankIcons,
    readIcon,
    sameIcon,
    SITE_ICONS,
    takesTint,
    writtenIcon,
  } from './icons'
  import { t } from './i18n.svelte'
  import { dur, LAYER } from './motion'
  import { overlays } from './overlays'
  import { segmented } from './slide'
  import { trap } from './trap'
  import { viewport } from './viewport.svelte'
  import { untrack } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { fade, scale } from 'svelte/transition'

  /** How wide and tall one cell is, in pixels: a comfortable click under a pointer,
   *  and a thumb's target under a finger.
   *
   *  One number, in script rather than in the stylesheet, because the window is worked
   *  out from it: a cell the CSS made larger than the arithmetic thought it was would
   *  draw the wrong rows. The stylesheet takes it from here.
   *
   *  `MARGIN` is how far past the window the drawn rows reach, which is what keeps a
   *  fast scroll from showing a gap. */
  const POINTER_CELL = 38
  const TOUCH_CELL = 48
  const MARGIN = 2

  /** How many a search answers with. Past this nobody is reading, they are typing
   *  another word - and the ranking is over every icon in the set either way. */
  const FOUND = 300

  /** How many rows the Web icons take before anything is typed (#1054): the sites seen
   *  last, which are the ones reached for. The rest are a search away. */
  const SITE_ROWS = 2

  let query = $state('')
  let field = $state<HTMLInputElement>()
  let scroller = $state<HTMLElement>()
  let width = $state(0)
  let height = $state(0)
  let top = $state(0)
  /** Which cell the arrows are on, as an index into `cells`. */
  let at = $state(0)
  /** Whether the arrows have been used since the sheet opened or the search changed
   *  (#1116): only then is the cell they are on marked. Marked from the start, the
   *  first cell read as one hovered, or as one chosen, before anybody touched a key. */
  let walked = $state(false)
  /** The colour the next pick is drawn in. Starts as the one the thing already wears,
   *  so changing the icon keeps the colour and changing the colour keeps the icon. */
  let tint = $state<string | null>(null)
  /** Whether the emoji are offered in one colour (#1097): each cell of an emoji the
   *  outlines draw holds its outline instead, written as its own value, so the one
   *  search finds an emoji either way and this says which of the two a pick is. Kept
   *  from one opening to the next, and set by what the thing wears where it is one. */
  let outlined = $state(false)

  const cell = $derived(viewport.touch ? TOUCH_CELL : POINTER_CELL)
  const target = $derived(iconChoice.target)

  /** Whether the sets that wait for a search or a scroll have been asked for. */
  let wanted = $state(false)

  /** What the thing being chosen for wears now, as written. */
  const worn = $derived(target === null ? null : wornBy(target))

  const written = $derived(readIcon(worn))

  /** The outlines, once asked for and here. */
  const twins = $derived(outlined ? (iconLibrary.loaded[EMOJI_OUTLINE] ?? null) : null)

  /** What a cell writes: the emoji's outline in its place where they are asked for and
   *  it has one, else the value the cell holds. A flag, which has no outline, stays the
   *  flag it is. */
  const variant = (name: string): string => {
    const twin = twins?.twin?.(name)
    return twin ? writtenIcon(EMOJI_OUTLINE, twin) : name
  }

  /** Whether a set the sheet opens with is still on its way. A set this build leaves
   *  out does not hold the others back, and nor does one that waits for a search: the
   *  list is what did arrive. */
  const pending = $derived(PICKER_SETS.some((id) => !LATER_SETS.has(id) && iconLibrary.loading(id)))
  const absent = $derived(PICKER_SETS.every((id) => iconLibrary.absent[id]))

  /** Every set as one collection, whose names are the values a cell writes. */
  const held = $derived.by(() => {
    if (pending || absent) return null

    const parts: { id: string; held: LoadedSet }[] = []
    for (const id of PICKER_SETS) {
      const one = iconLibrary.loaded[id]
      if (one) parts.push({ id, held: one })
    }

    return parts.length ? mergeSets(parts) : null
  })

  /** Whether there is an account whose sites the Web icons are (#1054): a device nobody
   *  is signed in on has no list, and says nothing about one. */
  const signedIn = $derived(account.accountToken !== null)

  /** The account's sites as a set, where there is an account and its service keeps
   *  them: a service from before the Web icons leaves the section out altogether. */
  const siteSet = $derived.by(() => {
    const set = signedIn ? iconLibrary.loaded[SITE_ICONS] : undefined
    return set && !set.unoffered ? set : null
  })

  /** The Web icons (#1054): the marks of the sites the account has been to, the most
   *  recently seen first, under the values a cell writes. Read off the account's list,
   *  so one seen on another device is here without having been opened on this one. */
  const sites = $derived.by((): IconEntry[] => {
    return (siteSet?.entries ?? []).map((one) => ({
      ...one,
      name: writtenIcon(SITE_ICONS, one.name),
    }))
  })

  const columns = $derived(Math.max(1, Math.floor((width || cell * 8) / cell)))

  /** The Web icons shown before anything is typed. */
  const siteRow = $derived(sites.slice(0, columns * SITE_ROWS))

  /** Every cell, in the order it is shown: what a search found among every set and the
   *  sites, or with nothing typed the latest sites and then the sets' own order. */
  const cells = $derived.by(() => {
    if (!held) return []
    if (query) return rankIcons([...sites, ...held.entries], query, FOUND)
    return [...siteRow.map((one) => one.name), ...held.entries.map((one) => one.name)]
  })

  /** A row of the grid: a heading where a group begins, or a run of cells. Every row is
   *  one cell tall, headings included, which is what lets the window be worked out
   *  with one division rather than a table of heights. */
  type Row = { head: string } | { names: string[] } | { note: string }

  /** Groups only where the set has them and nothing has been typed. A search is
   *  already an order - the best answer first - and cutting it into Unicode's
   *  categories would bury the answer under a heading. */
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

    // The sites first, as a group of their own, and a line where there are none yet.
    const web: Row[] = !siteSet
      ? []
      : [
          { head: t('Web icons') },
          ...(siteRow.length
            ? runs(siteRow.map((one) => one.name))
            : [{ note: t('Sites you visit will appear here') }]),
        ]

    return [
      ...web,
      ...held.groups.flatMap((group) => [{ head: group.label }, ...runs(group.names)]),
    ]
  })

  /** What each cell is called, for a reader who cannot see it. The set's own words
   *  rather than its name: an emoji's name is the character itself, which a screen
   *  reader announces as the picture and not as "rocket". */
  const words = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const map = new Map<string, string>()

    for (const entry of held?.entries ?? []) map.set(entry.name, entry.words)
    for (const entry of sites) map.set(entry.name, entry.words)

    return map
  })

  const called = (name: string) => words.get(name) ?? name

  /** Which row each cell sits on, so the arrows can put the one they moved onto in
   *  view. */
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

  /** Reads a value for its own sake, so the effect around it follows it. The same
   *  helper PromptSheet uses, and for the same reason. */
  const reads = (_value: unknown) => undefined

  /** How long the field waits for the sheet's own transition before it takes the
   *  keyboard. Focusing an element that is still scaling up scrolls the sheet. */
  const FOCUS = 40

  let focusing: ReturnType<typeof setTimeout> | undefined

  // The sheet is up the moment somebody asks for it; a set of icons is a chunk of its
  // own and arrives after, which is what the quiet line in the middle says.
  $effect(() => {
    const asked = iconChoice.target
    if (!asked) return

    // What it wears, read once as the sheet opens: an icon out of a set that waits for a
    // search has its set fetched now, so the cell it is in is there to be seen.
    const wears = untrack(() => readIcon(wornBy(asked)))
    const set = iconLibrary.setFor(wears)
    wanted = set !== null && LATER_SETS.has(set)
    if (set === EMOJI_OUTLINE) outlined = true
    else if (wears?.kind === 'emoji') outlined = false

    query = ''
    at = 0
    walked = false
    top = 0
    // Read once too: a colour painted while the sheet is up is written to the thing at
    // once, and following it would start the sheet over under the reader's search.
    tint = untrack(() => tintOf(asked))

    // The account's sites again, for a picker opened after they were first asked for:
    // one seen on another device since then. At most every so often; see site-icons.
    if (untrack(() => iconLibrary.loaded[SITE_ICONS])) {
      void import('./web-tab/site-icons.svelte').then((one) => one.siteIcons.refresh())
    }

    clearTimeout(focusing)
    focusing = setTimeout(() => field?.focus(), dur(FOCUS))
  })

  // Every set, each fetched once; see icon-library.svelte.ts. The ones that wait, once
  // somebody searches or has scrolled to the end of the rest.
  $effect(() => {
    if (!target) return
    const all = wanted || query.trim() !== ''
    for (const id of PICKER_SETS) if (all || !LATER_SETS.has(id)) iconLibrary.load(id)
    if (signedIn) iconLibrary.load(SITE_ICONS)
    if (outlined) iconLibrary.load(EMOJI_OUTLINE)
  })

  // Scrolled to within a screen of the end: the rest is wanted.
  $effect(() => {
    if (!wanted && held && height && top + height * 2 >= rows.length * cell) wanted = true
  })

  // A fresh set of answers starts at the first of them: the cell the arrows were on is
  // no longer the one under them.
  $effect(() => {
    reads(query)
    at = 0
    walked = false
  })

  // Nothing is waiting to be focused once the sheet has gone.
  $effect(() => () => clearTimeout(focusing))

  // Escape closes it, like everything else the app puts over a note; see overlays.ts.
  $effect(() => (target ? overlays.show(() => iconChoice.close()) : undefined))
  $effect(() => closeOnBack(target !== null, () => iconChoice.close()))

  /** One written value onto the thing being chosen for, and the sheet shut. The
   *  targets differ in nothing but where the value goes; see icon-target.ts. */
  function chose(said: string | null) {
    const asked = iconChoice.target
    if (!asked) return

    // A colour goes only with an icon that takes one: a line, an emoji's outline.
    const colour = takesTint(readIcon(said)) ? tint : null

    wear(asked, said, colour)

    iconRecent.add(said)
    iconChoice.close()
  }

  /** A colour on its own, which only means anything for something already wearing an
   *  icon that takes one (`takesTint`): an emoji and a coloured drawing have their own
   *  colours. Written at once, so a row of dots reads as a row of dots rather than as a
   *  setting to confirm. */
  function paint(colour: string | null) {
    tint = colour

    const asked = iconChoice.target
    if (!asked || !takesTint(written) || worn === null) return

    wear(asked, worn, colour)
  }

  /** The arrows walk the grid and Enter takes what they are on. Read from the search
   *  field, which is where the keyboard already is: a grid that had to be tabbed into
   *  would be a grid nobody reached. */
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
      // The first press shows where the arrows are, and moves from there after.
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

  /** Scrolls the row a cell sits on into view, which is what keeps the arrows from
   *  walking off the bottom of the window. */
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
    class="nib-scrim scrim"
    transition:fade={{ duration: LAYER.fade }}
    onclick={() => iconChoice.close()}
  ></div>

  <div
    class="nib-screen sheet"
    use:trap
    role="dialog"
    aria-modal="true"
    aria-label={t('Choose an icon')}
    style:--cell="{cell}px"
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    <input
      class="nib-field"
      bind:this={field}
      bind:value={query}
      onkeydown={onKey}
      placeholder={t('Search icons - work, journal, money…')}
      spellcheck="false"
      autocapitalize="off"
      autocorrect="off"
    />

    <!-- The last few, whichever set each came from: somebody marking a month of
         folders reaches for the same handful, and reaching for them should not mean
         typing the same words again. -->
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
        <!-- A set that is not in this build, or a chunk that would not come down.
             Said once, calmly, rather than left loading for ever. -->
        <p class="empty">{t('That set is not here')}</p>
      {:else if !held}
        <p class="empty">{t('Loading…')}</p>
      {:else if !cells.length}
        <p class="empty">{t('Nothing found')}</p>
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
                  <!-- What this icon is called, once: the cell asked twice, over a
                       window of a few hundred cells. And what it writes, which is the
                       emoji's outline where those are asked for. -->
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

    <!-- The emoji in their own colours or in one (#1097): a choice of drawing for the
         same emoji the one search found, not a tab of its own. Left out where this build
         has no outlines, the plugin's. -->
    {#if !iconLibrary.absent[EMOJI_OUTLINE]}
      <div class="nib-segmented variant" role="radiogroup" aria-label={t('Emoji')} use:segmented>
        <button
          type="button"
          role="radio"
          aria-checked={!outlined}
          class:on={!outlined}
          onclick={() => (outlined = false)}
        >
          {t('Colour')}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={outlined}
          class:on={outlined}
          onclick={() => (outlined = true)}
        >
          {t('One colour')}
        </button>
      </div>
    {/if}

    <!-- The colour a line icon, or an emoji's outline, is drawn in. Only those take it:
         an emoji, a coloured drawing and a logo are already pictures in their own
         colours, and painting over one would be painting over somebody's drawing.
         Chosen before or after the icon, which is why the dots are always there. -->
    <div class="tints" role="group" aria-label={t('Colour')}>
      <button
        type="button"
        class="tint plain"
        aria-label={t('Plain')}
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

    <button class="clear" onclick={() => chose(null)}>
      {target.kind === 'space'
        ? t('Use the first letter instead')
        : t('Use the plain mark instead')}
    </button>

    <!-- Who drew the sets, and under what licence: somebody else drew most of them. -->
    <p class="credit">{pickerCredit()}</p>
  </div>
{/if}

<style>
  /* `.nib-screen` in the themes package: where it hangs, how tall it may get, and a
     sheet's width of the scale. */
  .sheet {
    --screen-width: var(--screen-sheet);

    z-index: var(--z-sheet);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
  }

  /* The window, and inside it a box as tall as every row there is, so the scrollbar
     tells the truth about a set of two thousand while only a screenful is drawn. It
     is what gives way when the sheet reaches the most it may be. */
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

  /* A group's name, in the same row height as the cells: one height for every row is
     what keeps the window one division rather than a table. */
  /* In line with the glyphs below it, not with the cells' edges (#1116). */
  .head {
    padding: 0 calc((var(--cell) - var(--icon-lg)) / 2);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--muted);
  }

  /* What the Web icons say while there are none yet (#1054). */
  .note {
    padding: 0 calc((var(--cell) - var(--icon-lg)) / 2);
    font-size: var(--text-sm);
    color: var(--muted);
  }

  /* One row of them and no scrollbar: a second row of recent icons would be a second
     grid, and the grid is right below it. */
  .recent {
    display: flex;
    overflow: hidden;
  }

  /* One box for the glyph and for every mark on it - hovered, walked to, chosen - in
     every section and either drawing of an emoji (#1116): no padding of the browser's
     own, and the glyph centred in it by flex, which centres a glyph wider than its box
     too where a grid track grows to the right of it. */
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

  /* Where the arrows are: a ring, not the hover's fill, so the two never read as one
     (#1116). */
  .cell.at {
    box-shadow: inset 0 0 0 2px var(--accent);
    color: var(--text-strong);
  }

  /* Only under a pointer that hovers. WebKit leaves the last tap's hover on
     whatever is under the finger when the picker rises, and in a grid of marks it
     read as a second one chosen beside the one that is. */
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

  /* The box Icon.svelte fills, and the size an emoji in it is set at. */
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

  /* As wide as its two words, not the sheet: a choice beside the grid, not a tab strip. */
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

  /* No colour is a colour too: the foreground the rest of the list is drawn in. */
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

  /* On the keys rather than under them, as every other sheet is; see Sheet.svelte.
     The marks give up what the keys take: at the foot of the screen they ran on
     under the keyboard, and what a search found there could not be reached. */
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
