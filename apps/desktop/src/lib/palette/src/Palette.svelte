<script lang="ts">
  import { hinting } from '../../hints/src/api'
  import {
    OUTLINE_MARK,
    GRAPH_MARK,
    SEARCH_MARK,
    recentFirst,
    overlays,
    UnsavedDot,
    viewport,
    scrollbar,
  } from '../../ui-kit/src/api'
  import { tick, untrack } from 'svelte'
  import { typeAhead } from './type-ahead'
  import { cubicOut } from 'svelte/easing'
  import type { EditorView } from '@orden/editor'
  import ChevronRight from 'lucide/dist/esm/icons/chevron-right.mjs'
  import FilePlus from 'lucide/dist/esm/icons/file-plus.mjs'
  import Server from 'lucide/dist/esm/icons/server.mjs'
  import { paletteCommands } from '../../commands/src/api'
  import { fileMark } from '../../marks/src/api'
  import { FileMark } from '../../marks/src/api'
  import { Icon } from '../../glyphs/src/api'
  import { links } from '../../link-index/src/api'
  import { AGENTS_NAME, shownName } from '../../platform/src/api'
  import { browse, RECENT } from './browse'
  import { candidates, headingCandidates, resting, rowKey, type World } from './kinds'
  import { lineAsked, modeOf } from './mode'
  import { choose, type Hands } from './choose'
  import { makeable, typedAddress, withOffers } from './offers'
  import { pieces } from '../../matching/src/api'
  import { frecency, MOST_PLACES, ranked } from '../../matching/src/api'
  import type { OpenTab, Row } from './rows'
  import { isDraft, scanHeadings } from '../../documents/src/api'
  import { lookOf } from './trying'
  import { hiddenKinds } from '../../gates/src/api'
  import { relativeTo, samePath } from '../../platform/src/api'
  import { SpaceMark, TabMark } from '../../marks/src/api'
  import { theme } from '../../theme/src/api'
  import { canWriteAt } from '../../sharing/src/api'
  import { joinPath } from '../../platform/src/api'
  import { trap } from '../../ui-controls/src/api'
  import { isDesktop } from '../../platform/src/api'
  import { type PaletteHost, paletteKind, searching, webPages, whenLoaded } from '@orden/contracts'
  import { shownAddress, visitKey } from '@orden/scan/visits'
  import { notices, paletteWords, workspace, middleOpens } from '../../workspace/src/api'
  import { fade, LAYER, scale } from '../../platform/src/api'
  import { wholeRows } from './whole-rows'
  import { distinct, keepScope, keptScope, type Scope } from './scope'

  /* eslint-disable prefer-const -- `open` is bindable, and a $props() pattern cannot be split */
  let {
    open = $bindable(false),
    view,
    ongoto,
  }: {
    open?: boolean
    view?: EditorView | undefined
    ongoto?: (line: number) => void
  } = $props()
  /* eslint-enable prefer-const */
  $effect(() => {
    if (!__EVEN_PLUGIN__ && open) whenLoaded(hinting, ({ hints }) => hints.dismiss('palette'))
  })
  let query = $state('')
  let cursor = $state(0)
  let input = $state<HTMLInputElement>()
  const asked = $derived(modeOf(query))
  const mode = $derived(asked.mode)
  const term = $derived(asked.term)
  const browses = $derived(!__EVEN_PLUGIN__ && !viewport.touch)
  const visits = paletteKind('visits')
  let forgotten = $state(0)
  const commands = $derived(open ? paletteCommands(view) : [])
  const settingRows = $derived(open ? paletteKind('settings').rows(view) : [])
  let scope = $state<Scope>('all')
  $effect(() => {
    if (open) untrack(() => (scope = keptScope()))
  })
  const spaced = $derived(workspace.shownSpaces.length > 1)
  const onlyHere = $derived(spaced && scope === 'here')
  const marksSpaces = $derived(spaced && scope === 'all')
  function flipScope() {
    scope = scope === 'all' ? 'here' : 'all'
    keepScope(scope)
    input?.focus()
  }
  const tabs = $derived(
    workspace.shownTabs.flatMap((tab): OpenTab[] => {
      const space = workspace.spaceOf(tab.note)
      if (onlyHere && space !== workspace.activeSpaceId) return []
      const url = tab.kind === 'web' ? visitKey(webPages().of(tab.id).url ?? '') : null
      return [{ id: tab.id, kind: tab.kind, path: tab.path, shown: tab.shown, url, space }]
    }),
  )
  const root = $derived(workspace.activeSpace?.root ?? null)
  let hosts = $state.raw<readonly PaletteHost[]>([])
  $effect(() => {
    if (!open || __EVEN_PLUGIN__ || !isDesktop) return
    void paletteKind('hosts')
      .list()
      .then((list) => (hosts = list))
  })
  const world = $derived.by((): World | null => {
    if (!open) return null
    follows(forgotten)
    return {
      root: root ?? '',
      files: workspace.shownFiles,
      tabs,
      active: workspace.activeTabId,
      focused: workspace.active?.kind ?? null,
      recent: workspace.recent,
      bookmarks: workspace.bookmarks.list.filter(
        (one) => !(one.kind === 'note' && samePath(one.path, AGENTS_NAME, root ?? undefined)),
      ),
      commands,
      pages: browses ? visits.list() : [],
      settings: settingRows,
      hosts,
      worth: (key) => frecency.worth(key),
      now: Date.now(),
      addressOf: (path) => links.shortcutOf(path),
    }
  })
  const all = $derived(world ? candidates(world) : [])
  const offered = $derived.by(() => {
    const whole = term.trim().toLowerCase()
    return all.filter(
      ({ item }) =>
        item.kind !== 'note' ||
        !workspace.archive.has(item.entry.path) ||
        shownName(item.entry.name).toLowerCase() === whole,
    )
  })
  const writing = $derived(workspace.active?.kind === 'note' ? view : undefined)
  const wantsHeadings = $derived(mode === 'headings' || (mode === 'everything' && term.length >= 3))
  const headings = $derived(open && wantsHeadings && writing ? scanHeadings(writing.state.doc.toString()) : [])
  const headingRows = $derived(headingCandidates(headings, mode === 'headings'))
  const taken = $derived(new Set(workspace.files.map((one) => relativeTo(root ?? '', one.path).toLowerCase())))
  const makes = $derived(
    mode === 'everything' && root && hiddenKinds.offers('note') && canWriteAt(root) ? makeable(term, taken) : null,
  )
  const address = $derived.by(() => {
    const url = browses && mode === 'everything' ? typedAddress(term) : null
    return url ? { url, shown: shownAddress(url) } : null
  })
  function commandRows(): Row[] {
    const list = all.filter((one) => one.kind === 'command')
    if (term) return ranked(term, list)
    const lately = frecency.latest('command:', 8)
    return recentFirst(list, lately, (one) => one.key ?? '').map((one) => one.item)
  }
  function hostRows(): Row[] {
    const list = all.filter((one) => one.kind === 'host')
    const found = term ? ranked(term, list) : list.map((one) => one.item)
    const offer = __EVEN_PLUGIN__ ? null : paletteKind('hosts').wanted(term)
    return offer ? [...found, { kind: 'connect', ...offer }] : found
  }
  const browsed = $derived(
    mode === 'everything' && !term && world
      ? browse(
          resting(offered, world, (key) => frecency.last(key), RECENT),
          commands,
        )
      : null,
  )
  const listed = $derived.by((): Row[] => {
    if (mode === 'commands') return commandRows()
    if (mode === 'hosts') return hostRows()
    if (mode === 'headings') return ranked(term, headingRows, MOST_PLACES)
    if (mode === 'line') {
      const line = writing ? lineAsked(term, writing.state.doc.lines) : null
      if (line === null || !writing) return []
      const text = writing.state.doc.line(line + 1).text.trim()
      return [{ kind: 'place', line, text, depth: 0, hint: String(line + 1) }]
    }
    if (!term) return browsed?.rows ?? []
    return withOffers(ranked(term, [...offered, ...headingRows]), term, address, makes)
  })
  const results = $derived(browsed ? listed : distinct(listed, shownAs))
  const spaceWith = (id: string | null) => workspace.spaces.find((one) => one.id === id) ?? null
  const spaceAt = (path: string) => {
    const root = workspace.rootHolding(path)
    return root === null ? null : (workspace.spaces.find((one) => samePath(one.root, root)) ?? null)
  }
  function fromOf(row: Row) {
    if (!marksSpaces) return null
    if (row.kind === 'note') return spaceAt(row.entry.path)
    if (row.kind === 'tab') return spaceWith(row.tab.space)
    if (row.kind === 'bookmark') return row.path === null ? null : spaceAt(row.path)
    if (row.kind !== 'place' || !workspace.active) return null
    return spaceWith(workspace.spaceOf(workspace.active.note))
  }
  function shownAs(row: Row): string {
    const facts = [row.kind, label(row), whereOf(row) ?? '', fromOf(row)?.id ?? '']
    if (row.kind === 'tab') facts.push(row.tab.id)
    if (row.kind === 'note') facts.push(row.entry.path)
    return facts.join('\n')
  }
  function label(row: Row): string {
    switch (row.kind) {
      case 'command':
        return row.command.label
      case 'note':
        return shownName(row.entry.name)
      case 'tab':
        return row.tab.shown
      case 'bookmark':
        return row.label
      case 'page':
        return row.title
      case 'setting':
        return row.setting.label
      case 'make':
        return shownName(row.make.name)
      case 'agents':
        return "AGENTS is this space's agent instructions"
      case 'address':
        return row.address
      case 'place':
        return row.text
      case 'host':
        return row.host.name
      case 'group':
        return row.group
      case 'connect':
        return row.said
    }
  }
  function whereOf(row: Row): string | null {
    switch (row.kind) {
      case 'note':
      case 'tab': {
        const byName = pieces(label(row), term).some((one) => one.hit)
        return row.folder && (row.shared || (term && !byName)) ? row.folder : null
      }
      case 'bookmark':
        return row.note
      case 'page':
        return row.title === row.address ? null : row.address
      case 'setting':
        return row.setting.where
      case 'make':
        return row.make.folder || null
      case 'agents':
        return null
      case 'host':
        return row.host.detail
      case 'group':
        return 'Open all'
      case 'command':
      case 'place':
      case 'address':
      case 'connect':
        return null
    }
  }
  function hintOf(row: Row): string | null {
    if (row.kind === 'command') return row.command.hint ?? null
    return row.kind === 'place' ? row.hint : null
  }
  const dimmed = (row: Row) => row.kind === 'command' && row.command.disabled === true
  const tabOf = (row: Extract<Row, { kind: 'tab' }>) => workspace.shownTabs.find((one) => one.id === row.tab.id)
  const unsavedTab = (row: Extract<Row, { kind: 'tab' }>) => {
    const tab = tabOf(row)
    return tab !== undefined && isDraft(tab.note)
  }
  const follows = (_value: unknown) => undefined
  $effect(() => {
    follows(term)
    follows(mode)
    cursor = 0
  })
  $effect(() => {
    if (!open) return
    input?.focus()
    typeAhead.letGo(input ?? null)
  })
  $effect(() => {
    const words = paletteWords.words
    if (!open || words === null) return
    untrack(() => {
      query = words
      paletteWords.words = null
      void tick().then(() => input?.setSelectionRange(words.length, words.length))
    })
  })
  let list = $state<HTMLElement>()
  $effect(() => {
    follows(cursor)
    list?.querySelector('.orden-row.is-on')?.scrollIntoView({ block: 'nearest' })
  })
  let trying = false
  function wear(row: Row | undefined) {
    const look = lookOf(row, theme.kept)
    if (look) {
      trying = true
      theme.preview(look.id, look.scheme, look.accent)
    } else if (trying) {
      const kept = theme.kept
      theme.preview(kept.id, kept.scheme, kept.accent)
      trying = false
    }
  }
  $effect(() => {
    const row = open ? results[cursor] : undefined
    untrack(() => wear(row))
  })
  const opensTab = (row: Row) =>
    row.kind === 'note' ||
    row.kind === 'tab' ||
    row.kind === 'page' ||
    row.kind === 'address' ||
    (row.kind === 'bookmark' && (row.mark.kind === 'heading' || row.mark.kind === 'block'))
  const hands: Hands = {
    openEntry: (path, how) => void workspace.openEntry(path, how),
    openAside: (path) => void workspace.openAside(path),
    openPage: (url, ask) => {
      const opened = workspace.openPage(url, ask)
      if (opened) visits.opened(opened, term, url)
    },
    activate: (tab) => workspace.activate(tab),
    openAtHeading: (path, heading, how) => void workspace.openAtHeading(path, heading, how),
    openAtBlock: (target, how) => void workspace.openAtBlock(target, how),
    revealFolder: (path) => workspace.revealFolder(path),
    searchFor: (words) => searching()?.show(words),
    openGraph: (view) => {
      workspace.graphSettings.take(view)
      workspace.openGraph()
    },
    showSetting: (section, label) => paletteKind('settings').show(section, label),
    agents: () => {
      if (root) void notices().then((one) => one.openInstructions(root))
    },
    make: (note) => {
      if (root) void workspace.createNote(note.folder ? joinPath(root, note.folder) : root, note.name)
    },
    goto: (line) => ongoto?.(line),
    openHost: (id) => paletteKind('hosts').open(id),
    openHosts: (ids) => paletteKind('hosts').openAll(ids),
    connect: (wanted) => paletteKind('hosts').connect(wanted),
  }
  function pick(row: Row, press?: KeyboardEvent | MouseEvent) {
    if (lookOf(row, theme)) trying = false
    const chosen = choose(row, press, hands)
    if (chosen === 'nothing') return
    const key = row.kind === 'note' ? null : rowKey(row)
    if (key) frecency.use(key)
    if (chosen !== 'close') return
    if (row.kind === 'command') typeAhead.hold(input ?? null)
    dismiss()
  }
  function forget(row: Row) {
    const key = rowKey(row)
    if (!key) return
    frecency.forget(key)
    if (row.kind === 'note') workspace.device.unremember(row.entry.path)
    if (row.kind === 'tab' && row.tab.path) workspace.device.unremember(row.tab.path)
    if (!__EVEN_PLUGIN__ && row.kind === 'page') {
      visits.forget(row.url)
    }
    forgotten++
  }
  export async function showCommands() {
    if (!query.startsWith('>')) query = `>${query}`
    open = true
    await tick()
    input?.focus()
    input?.setSelectionRange(query.length, query.length)
  }
  export function dismiss() {
    open = false
    query = ''
  }
  $effect(() => (open ? overlays.show(dismiss) : undefined))
  function spend(event: KeyboardEvent) {
    event.preventDefault()
    event.stopPropagation()
  }
  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
      spend(event)
      cursor = (cursor + 1) % Math.max(results.length, 1)
      return
    }
    if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
      spend(event)
      cursor = (cursor - 1 + results.length) % Math.max(results.length, 1)
      return
    }
    if ((event.key === 'Home' || event.key === 'End') && (event.ctrlKey || event.metaKey)) {
      spend(event)
      cursor = event.key === 'Home' ? 0 : Math.max(results.length - 1, 0)
      return
    }
    if (event.key === 'Delete' && event.shiftKey) {
      const chosen = results[cursor]
      if (chosen) {
        spend(event)
        forget(chosen)
      }
      return
    }
    if (event.key !== 'Enter') return
    if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && makes) {
      spend(event)
      pick({ kind: 'make', make: makes })
      return
    }
    const chosen = results[cursor]
    if (chosen) {
      spend(event)
      pick(chosen, event)
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="orden-scrim scrim" transition:fade={{ duration: LAYER.fade }} onclick={dismiss}></div>

  <div
    class="orden-screen palette"
    use:trap
    role="dialog"
    aria-modal="true"
    aria-label="Search notes and commands"
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    <div class="field orden-field">
      <input
        bind:this={input}
        bind:value={query}
        onkeydown={onKeydown}
        placeholder="Search"
        spellcheck="false"
        autocapitalize="off"
        autocorrect="off"
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls="orden-palette-list"
        aria-activedescendant={results.length ? `orden-palette-${cursor}` : undefined}
        aria-label="Search notes and commands"
      />
      {#if spaced}
        <button type="button" class="orden-chip scope" onclick={flipScope}
          >{scope === 'here' ? 'Only this space' : 'All spaces'}</button
        >
      {/if}
      {#if viewport.touch}
        <button type="button" class="give" onclick={dismiss}>Cancel</button>
      {/if}
    </div>

    {#if results.length}
      <ul
        bind:this={list}
        use:scrollbar
        use:wholeRows={results}
        id="orden-palette-list"
        role="listbox"
        aria-label="Search notes and commands"
      >
        {#each results as row, index (`${row.kind}:${label(row)}:${index}`)}
          {@const where = whereOf(row)}
          {@const from = fromOf(row)}
          {@const hint = hintOf(row)}
          {@const head = browsed?.heads.get(index)}
          {#if head}<li role="none" class="orden-section">{head}</li>{/if}
          <li role="none">
            <button
              class="orden-row"
              id="orden-palette-{index}"
              role="option"
              tabindex="-1"
              aria-selected={index === cursor}
              aria-disabled={dimmed(row) ? 'true' : undefined}
              class:is-on={index === cursor}
              class:dim={dimmed(row)}
              style:--depth={row.kind === 'place' ? row.depth : 0}
              onmouseenter={() => (cursor = index)}
              onclick={(event) => pick(row, event)}
              use:middleOpens={(event) => opensTab(row) && pick(row, event)}
            >
              {#if row.kind === 'command'}
                {#if row.command.checked}
                  <span class="mark tick">✓</span>
                {:else}
                  <span class="mark quiet"><Icon icon={null} fallback={ChevronRight} /></span>
                {/if}
              {:else if row.kind === 'note'}
                <FileMark mark={fileMark(row.entry.name)} path={row.entry.path} />
              {:else if row.kind === 'tab'}
                {@const tab = tabOf(row)}
                {#if tab}<TabMark {tab} />{:else}<span class="mark"></span>{/if}
              {:else if row.kind === 'bookmark'}
                {#if row.file}
                  <FileMark mark={row.file} path={row.path ?? undefined} />
                {:else}
                  <svg class="mark drawn" viewBox="0 0 13 13"
                    ><path d={row.mark.kind === 'graph' ? GRAPH_MARK : SEARCH_MARK} /></svg
                  >
                {/if}
              {:else if row.kind === 'page' || row.kind === 'address'}
                <FileMark mark="web" url={row.url} />
              {:else if row.kind === 'setting'}
                <svg class="mark drawn" viewBox="0 0 16 16"><path d={row.setting.icon} /></svg>
              {:else if row.kind === 'place'}
                <svg class="mark drawn" viewBox="0 0 13 13"><path d={OUTLINE_MARK} /></svg>
              {:else if row.kind === 'make'}
                <span class="mark quiet"><Icon icon={null} fallback={FilePlus} /></span>
              {:else if row.kind === 'host' || row.kind === 'connect' || row.kind === 'group'}
                {@const colour = row.kind === 'host' ? row.host.colour : null}
                <span class="mark" style:color={colour ? `var(--canvas-${colour})` : undefined}
                  ><Icon icon={null} fallback={Server} /></span
                >
              {/if}
              <span class="orden-row-label" dir="auto"
                >{#each pieces(label(row), mode === 'everything' || mode === 'commands' || mode === 'headings' || mode === 'hosts' ? term : '') as piece, at (at)}{#if piece.hit}<b
                      >{piece.text}</b
                    >{:else}{piece.text}{/if}{/each}</span
              >
              {#if row.kind === 'tab' && unsavedTab(row)}<UnsavedDot />{/if}
              {#if where}<span class="where">{where}</span>{/if}
              {#if from}<span class="where from"
                  ><span><SpaceMark id={from.id} name={from.name} /></span>{from.name}</span
                >{/if}
              {#if row.kind === 'setting' && row.setting.switched() !== null}
                <span class="flip" aria-hidden="true"
                  ><span class="orden-switch" class:on={row.setting.switched()}></span></span
                >
              {:else if row.kind === 'setting' && row.setting.value()}
                <span class="value">{row.setting.value()}</span>
              {:else if hint}
                <kbd>{hint}</kbd>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {:else if mode === 'headings' && !headings.length}
      <p class="nothing">No headings in this note</p>
    {:else if term}
      <p class="nothing">Nothing found</p>
    {/if}
  </div>
{/if}

<style>
  .scrim {
    --scrim-z: var(--z-screen);
  }
  .palette {
    --screen-width: var(--screen-list);
    z-index: var(--z-screen);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .field {
    flex: none;
    min-height: 0;
    padding: 0;
    border: none;
    border-bottom: 1px solid var(--line);
    border-radius: 0;
    background: none;
    transition: border-color var(--dur-fast) var(--ease-out);
  }
  .field input {
    padding: var(--space-4);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-base);
  }
  .give {
    flex: none;
    min-height: var(--touch-row);
    padding: 0 var(--touch-pad);
    border: none;
    background: none;
    color: var(--accent);
    font-family: var(--font-ui);
    font-size: var(--touch-text);
  }
  input::placeholder {
    color: var(--muted);
  }
  ul {
    box-sizing: border-box;
    min-height: 0;
    list-style: none;
    margin: 0;
    padding: var(--space-1);
    overflow-y: auto;
  }
  button.dim {
    opacity: 0.45;
  }
  .mark {
    display: grid;
    place-items: center;
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
    stroke: currentColor;
    stroke-width: 1.6;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .quiet {
    opacity: 0.8;
  }
  svg.drawn {
    stroke-width: 1.2;
    opacity: 0.8;
  }
  .tick {
    min-width: 1em;
    color: var(--accent);
    stroke: none;
  }
  .orden-row-label {
    padding-inline-start: calc(var(--depth) * var(--space-3));
  }
  [role='option'] .orden-row-label:dir(rtl) {
    padding-inline: 0 calc(var(--depth) * var(--space-3));
  }
  .orden-row-label b {
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }
  .where,
  .value {
    min-width: 0;
    flex: 0 1 auto;
    overflow: hidden;
    color: var(--muted);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .value {
    margin-inline-start: auto;
  }
  .scope {
    margin-inline-end: var(--space-3);
  }
  .from {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .flip {
    display: flex;
    flex: none;
    margin-inline-start: auto;
    scale: 0.8;
  }
  .nothing {
    margin: 0;
    padding: var(--space-4);
    color: var(--muted);
    font-size: var(--text-row);
  }
  kbd {
    flex: none;
    margin-inline-start: auto;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted);
    letter-spacing: 0.02em;
  }
  :global([data-touch]) .palette {
    top: 0;
    left: 0;
    translate: none;
    width: 100%;
    max-height: calc(100dvh - var(--keyboard));
    border-radius: 0 0 var(--radius-lg) var(--radius-lg);
    padding-top: var(--inset-top);
  }
  :global([data-touch]) .field input {
    min-height: var(--touch-row);
    padding: 0 var(--touch-pad);
    font-size: var(--touch-text);
  }
  :global([data-touch]) ul {
    max-height: 60dvh;
    padding-bottom: var(--touch-bottom);
  }
</style>
