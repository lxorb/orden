<script lang="ts">
  import {
    closeFind,
    type EditorView,
    type FindAsk,
    type FindSpec,
    findReady,
    findTally,
    type FindTally,
    findNext as findNextMatch,
    findPrevious as findPreviousMatch,
    NO_FIND,
    NO_TALLY,
    replaceEverywhere,
    replaceHere,
    selectEveryMatch,
    setFind,
  } from '@orden/editor'
  import { type Component, untrack } from 'svelte'
  import {
    Door,
    dragged,
    dropOver,
    isTreeDrag,
    whileHere,
    message,
    busy,
    viewport,
    paneCorners,
  } from '../../ui-kit/src/api'
  import {
    alone,
    followHref,
    followNote,
    tabOverview,
    workspace,
    pull,
    storeAttachment,
    storeImage,
  } from '../../workspace/src/api'
  import type { Tab } from '../../documents/src/api'
  import {
    type Pane,
    panesIn,
    paneToward,
    topRow,
    type Landing,
    EDGE,
    inside,
    type Zone,
    zoneAt,
    keepsScroll,
    scrollKeyOf,
    views,
  } from '../../panes/src/api'
  import { TAB_KINDS } from '../../tab-kinds/src/api'
  import { isDesktop } from '../../platform/src/api'
  import Editor from './Editor.svelte'
  import { Handoff, Parked } from './editor-states'
  import { keptAway } from '../../away/src/api'
  import { chrome } from '../../theme/src/api'
  import { without } from '../../graph/src/api'
  import { links, notePicture } from '../../link-index/src/api'
  import { modes } from '../../modes/src/api'
  import { placement } from './placement.svelte'
  import { rooms } from '../../collab/src/api'
  import { commandRowsLoaded, type OpenHow, sayNotice } from '@orden/contracts'
  import { explorerOn } from '../../gates/src/api'
  import {
    archivedStrip,
    askPanel,
    canvasSurface,
    chatSurface,
    emptySurface,
    explorerSurface,
    findBar,
    graphSurface,
    lockScreen,
    pagesSurface,
    passSurface,
    readingSurface,
    settingsSurface,
    terminalSurface,
    timeSurface,
    todosBoard,
    viewSurface,
    webSurface,
  } from '../../surfaces/src/api'
  import { canWriteIn } from '../../sharing/src/api'
  import { noteBehind, protection } from '../../protect/src/api'
  import { flushFirst, Tabs } from '../../tab-strip/src/api'
  import { usage } from '../../accounts/src/api'

  const { pane }: { pane: Pane } = $props()
  const here = whileHere()
  const tab = $derived(workspace.showing(pane.id))
  const scrollKept = $derived(scrollKeyOf(tab, workspace.windowSlot))
  const behind = $derived(tab ? noteBehind(tab) : null)
  const locked = $derived(protection.locked(behind))
  const attachments = $derived(workspace.graphSettings.here.attachments)
  const picture = $derived.by(() => without(links.pictureOf(attachments), workspace.leftOut))
  const archived = $derived(tab?.path ? workspace.archive.has(tab.path) : false)
  const held = $derived(workspace.heldIn(pane.id).filter((one) => !one.unloaded))
  $effect(() => {
    if (tab?.unloaded) tab.unloaded = false
  })
  const stripped = $derived(
    workspace.panes.count > 1 &&
      !workspace.panes.fills &&
      !alone.on &&
      !panesIn(topRow(workspace.panes.frame)).some((one) => one.id === pane.id),
  )
  const flush = $derived(flushFirst(pane.id))
  const atLeft = $derived(!paneToward(workspace.panes.frame, pane.id, 'left'))
  const atRight = $derived(!paneToward(workspace.panes.frame, pane.id, 'right'))
  const atFoot = $derived(!paneToward(workspace.panes.frame, pane.id, 'down'))
  const ownSurface = $derived(!!tab && (TAB_KINDS[tab.kind].takesDrops || (isDesktop && tab.kind === 'web')))
  const writing = $derived(!!tab && TAB_KINDS[tab.kind].editor && !tab.reading && !locked)
  const columns = $derived(
    pane.stacked && !viewport.touch
      ? workspace.tabsIn(pane.id).filter((one) => one.kind === 'note' && !one.reading && !protection.locked(one.path))
      : [],
  )
  const stacking = $derived(columns.length > 1 && columns.some((one) => one.id === tab?.id))
  const KEPT = 6
  const inEditor = (one: Tab) =>
    one.kind === 'note' && !one.coming && !one.reading && !protection.locked(noteBehind(one))
  const keepsAlive = (one: Tab) => inEditor(one) || one.kind === 'terminal'
  const handoff = new Handoff()
  const parked = new Parked<Tab>((one) => untrack(() => one.paneId === pane.id && workspace.tabs.includes(one)))
  let recent: string[] = []
  let alive = $state<string[]>([])
  $effect.pre(() => {
    const keeping = !stacking
    const front = keeping && tab && keepsAlive(tab) ? tab.id : null
    const notes = keeping ? held.filter(keepsAlive).map((one) => one.id) : []
    untrack(() => {
      recent = (front ? [front, ...recent.filter((id) => id !== front)] : recent).filter((id) => notes.includes(id))
      const keep = recent.slice(0, KEPT)
      alive = [...alive.filter((id) => keep.includes(id)), ...keep.filter((id) => !alive.includes(id))]
    })
  })
  $effect(() => {
    parked.keepOnly(held)
  })
  $effect(() => () => parked.shut())
  const kept = $derived(alive.flatMap((id) => held.find((one) => one.id === id) ?? []))
  const keptNotes = $derived(kept.filter(inEditor))
  const keptShells = $derived(kept.filter((one) => one.kind === 'terminal'))
  const shownKept = $derived(tab && alive.includes(tab.id) ? tab.id : null)
  const keptViews = $state<Record<string, EditorView | undefined>>({})
  const keepsMiddle = $derived(ownSurface || (writing && !tab?.coming && !modes.readOnly && canWriteIn(tab?.note)))
  const edged = $derived(keepsMiddle ? '' : undefined)
  const columnViews = $state<Record<string, EditorView | undefined>>({})
  const view = $derived(
    stacking ? columnViews[pane.activeTabId ?? ''] : shownKept === null ? undefined : keptViews[shownKept],
  )
  function takeColumn(id: string) {
    if (id === pane.activeTabId && workspace.panes.focusedId === pane.id) return
    workspace.focusPane(pane.id)
    workspace.activate(id)
  }
  type FindFlags = Pick<FindSpec, 'caseSensitive' | 'regexp' | 'wholeWord'>
  let finding = $state(false)
  let replacing = $state(false)
  let spec = $state<FindSpec>(NO_FIND)
  let tally = $state<FindTally>(NO_TALLY)
  const canReplace = $derived(!!tab && !tab.reading && !modes.readOnly && canWriteIn(tab.note) && !!view)
  async function look(next: FindSpec) {
    spec = next
    const asked = view
    if (!asked) return
    await setFind(asked, next)
    if (asked === view) tally = findTally(asked.state)
  }
  function tallySlow(slowed: EditorView) {
    if (slowed === view) tally = findTally(slowed.state)
  }
  function openFinding(ask: FindAsk) {
    replacing = ask.replace
    void look(ask.seed ? { ...spec, query: spec.regexp ? ask.pattern : ask.seed } : spec)
    finding = true
  }
  function shutFinding() {
    finding = false
    replacing = false
    if (view) closeFind(view)
    view?.focus()
  }
  async function ready(): Promise<EditorView | null> {
    const asked = view
    if (!asked || !(await findReady(asked)) || asked !== view) {
      if (asked && asked === view) tally = findTally(asked.state)
      return null
    }
    return asked
  }
  async function stepFinding(by: number) {
    const asked = await ready()
    if (!asked) return
    if (by < 0) findPreviousMatch(asked)
    else findNextMatch(asked)
    tally = findTally(asked.state)
  }
  async function selectEvery() {
    const asked = await ready()
    if (asked && selectEveryMatch(asked)) shutFinding()
  }
  async function replaceOne() {
    const asked = await ready()
    if (!asked) return
    replaceHere(asked)
    tally = findTally(asked.state)
  }
  async function replaceEvery() {
    const asked = await ready()
    if (!asked) return
    replaceEverywhere(asked)
    tally = findTally(asked.state)
  }
  let searchedIn: string | null = null
  $effect(() => {
    const here = tab?.id ?? null
    if (here === searchedIn) return
    searchedIn = here
    if (untrack(() => finding)) shutFinding()
  })
  $effect(() => {
    const current = view
    if (!current) return
    return pull.follow(current.scrollDOM)
  })
  $effect(() => {
    const current = view
    if (!current) return
    views.put(pane.id, current)
    return () => views.forget(pane.id)
  })
  $effect(() => {
    const current = view
    const showing = tab
    if (!current || !showing) return
    return placement.follow(current, showing)
  })
  function showMenu(event: MouseEvent, on: EditorView | undefined, path: string | null) {
    event.preventDefault()
    event.stopPropagation()
    void here(import('../../editor-menu/src/api')).then(async ({ showEditorMenu }) => {
      await commandRowsLoaded()
      showEditorMenu(event, on, path)
    })
  }
  async function saveImage(file: File, into: Tab): Promise<string | null> {
    if (!file.type.startsWith('image/')) return saveAttachment(file, into)
    try {
      const src = await busy.run('Storing the image', () => storeImage(file, into.path))
      void usage.refresh()
      return src
    } catch (error) {
      void usage.refresh()
      sayNotice(message(error, 'That image does not fit in your storage.'))
      return null
    }
  }
  async function saveAttachment(file: File, into: Tab): Promise<string | null> {
    try {
      return await busy.run('Storing the file', () => storeAttachment(file, into.path))
    } catch (error) {
      sayNotice(message(error, 'That file could not be kept.'))
      return null
    }
  }
  function resolveImage(src: string, from: Tab, wikilink = false): string {
    return notePicture(src, from.path, from.doc, wikilink)
  }
  function nameBlock(path: string, line: number, from: Tab): Promise<string | null> {
    return links.nameBlock(path, line, from.path)
  }
  function zoneOf(event: DragEvent & { currentTarget: HTMLElement }): Zone {
    const box = event.currentTarget.getBoundingClientRect()
    const moving = workspace.panes.dragging?.tabId ?? null
    return zoneAt(box, event.clientX, event.clientY, (side) => workspace.canLand(side, pane.id, moving))
  }
  function answers(event: DragEvent, zone: Zone): boolean {
    return isTreeDrag(event.dataTransfer) && !(keepsMiddle && zone === 'middle')
  }
  function over(event: DragEvent & { currentTarget: HTMLElement }) {
    const where = zoneOf(event)
    if (!answers(event, where)) {
      if (workspace.panes.landing?.paneId === pane.id) workspace.panes.landing = null
      return
    }
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    workspace.panes.landing = { kind: 'pane', paneId: pane.id, zone: where }
  }
  function drop(event: DragEvent & { currentTarget: HTMLElement }) {
    const where = zoneOf(event)
    if (!answers(event, where)) return
    event.preventDefault()
    const landing: Landing = { kind: 'pane', paneId: pane.id, zone: where }
    const paths = dragged(event.dataTransfer)
    workspace.panes.landing = null
    workspace.panes.dropped()
    if (paths.length) void workspace.dropNotes(paths, landing)
  }
  const landing = $derived(workspace.panes.landing)
  const zone = $derived(landing?.kind === 'pane' && landing.paneId === pane.id ? landing.zone : undefined)
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="pane"
  class:lifted={tabOverview.lifted.includes(pane.id)}
  class:straight={!stripped && flush}
  class:stripped
  class:flush
  class:at-left={atLeft}
  class:at-right={atRight}
  class:at-foot={atFoot}
  data-pane={pane.id}
  onpointerdowncapture={() => workspace.focusPane(pane.id)}
  use:dropOver={over}
  use:keepsScroll={scrollKept}
  ondragleave={(event) => {
    const box = event.currentTarget.getBoundingClientRect()
    if (landing?.paneId !== pane.id || inside(box, event.clientX, event.clientY)) return

    workspace.panes.landing = null
  }}
  ondrop={drop}
>
  {#if stripped}
    <div class="head" data-chrome="top" data-theme={chrome.theme}>
      <Tabs paneId={pane.id} />
    </div>
  {/if}

  <div class="card">
    <Door open={finding && writing} load={() => findBar()}>
      {#snippet children(FindBar)}
        <FindBar
          query={spec.query}
          count={tally.count}
          current={tally.current}
          capped={tally.capped}
          slow={tally.slow ?? false}
          flags={spec}
          onflags={(flags: FindFlags) => void look({ ...spec, ...flags })}
          {replacing}
          replacement={spec.replace}
          onreplacing={(open: boolean) => {
            replacing = open
          }}
          onreplacement={(typed: string) => void look({ ...spec, replace: typed })}
          onreplace={canReplace ? () => void replaceOne() : undefined}
          onreplaceall={canReplace ? () => void replaceEvery() : undefined}
          onstep={(by: number) => void stepFinding(by)}
          onselectall={() => void selectEvery()}
          onclose={shutFinding}
          onquery={(typed: string) => void look({ ...spec, query: typed })}
        />
      {/snippet}
    </Door>

    {#if !__EVEN_PLUGIN__}
      <Door open={archived && !!tab?.path} load={() => archivedStrip()}>
        {#snippet children(ArchivedStrip)}
          <ArchivedStrip path={tab?.path ?? ''} />
        {/snippet}
      </Door>
    {/if}

    {#if tab && behind && locked}
      {#key tab.id}
        {#await lockScreen() then LockScreen}
          <LockScreen path={behind} focused={workspace.panes.focusedId === pane.id} />
        {:catch}
          {@render unreachable()}
        {/await}
      {/key}
    {:else if tab?.kind === 'graph'}
      {#await graphSurface() then Graph}
        <Graph
          graph={picture}
          whole
          current={workspace.relativeNote}
          focused={workspace.panes.focusedId === pane.id}
          onopen={(path: string, how: OpenHow) => workspace.openRelative(path, how)}
          onescape={() => void workspace.closeAsking(tab.id)}
        />
      {:catch}
        {@render unreachable()}
      {/await}
    {:else if tab?.kind === 'canvas'}
      {@render surface(canvasSurface, tab)}
    {:else if tab?.kind === 'pages' || tab?.kind === 'pdf'}
      {@render surface(pagesSurface, tab)}
    {:else if tab?.kind === 'web'}
      {@render surface(webSurface, tab)}
    {:else if tab?.kind === 'view' && tab.path === null}
      {#key tab.id}
        {#await todosBoard() then TodosBoard}
          <TodosBoard />
        {:catch}
          {@render unreachable()}
        {/await}
      {/key}
    {:else if tab?.kind === 'view'}
      {@render surface(viewSurface, tab)}
    {:else if tab?.kind === 'channel'}
      {@render surface(chatSurface, tab)}
    {:else if tab?.kind === 'chat'}
      {#key tab.id}
        {#await askPanel() then ChatPanel}
          <ChatPanel wide {tab} />
        {:catch}
          {@render unreachable()}
        {/await}
      {/key}
    {:else if tab?.kind === 'terminal'}

    {:else if tab?.kind === 'explorer'}
      {#if explorerOn()}
        {@render surface(explorerSurface, tab)}
      {/if}
    {:else if tab?.kind === 'pass'}
      {@render surface(passSurface, tab)}
    {:else if tab?.kind === 'settings'}
      {#key tab.id}
        {#await settingsSurface() then SettingsPanel}
          <SettingsPanel />
        {:catch}
          {@render unreachable()}
        {/await}
      {/key}
    {:else if tab?.kind === 'time'}
      {@render surface(timeSurface, tab)}
    {:else if tab?.coming}
      <div class="coming" role="status">
        {keptAway.offline && tab.path !== null && keptAway.at(tab.path) !== null
          ? 'Not on this device. It opens once you are online again.'
          : 'Loading…'}
      </div>
    {:else if tab?.reading}
      {@render surface(readingSurface, tab)}
    {:else if stacking}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="stack" data-region="editor">
        {#each columns as one (one.id)}
          <section class="column" class:is-active={one.id === pane.activeTabId} onfocusin={() => takeColumn(one.id)}>
            <button
              class="spine"
              title={one.shown}
              aria-label={one.shown}
              aria-pressed={one.id === pane.activeTabId}
              onclick={() => workspace.activate(one.id)}
            >
              <span class="orden-row-label" dir="auto">{one.shown}</span>
            </button>
            <div class="sheet" oncontextmenu={(event: MouseEvent) => showMenu(event, columnViews[one.id], one.path)}>
              {@render editor(one, columnViews, true, one.id === pane.activeTabId, held)}
            </div>
          </section>
        {/each}
      </div>
    {:else if !tab}
      {#await emptySurface() then NewHere}
        <NewHere paneId={pane.id} />
      {:catch}
        {@render unreachable()}
      {/await}
    {/if}

    {#each keptNotes as one (one.id)}
      {@const here = one.id === shownKept}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class:editor={here}
        class:kept={!here}
        hidden={!here}
        data-region={here ? 'editor' : undefined}
        oncontextmenu={(event: MouseEvent) => showMenu(event, keptViews[one.id], one.path)}
      >
        {@render editor(one, keptViews, here, here, [one])}
      </div>
    {/each}

    {#each keptShells as one (one.id)}
      {@const here = one.id === shownKept}
      <div class:shell={here} class:kept={!here} hidden={!here} inert={!here}>
        {#await terminalSurface() then Terminal}
          {@const Shell = Terminal as Component<{ tab: Tab; focused: boolean; shown: boolean }>}
          <Shell tab={one} focused={here && workspace.panes.focusedId === pane.id} shown={here} />
        {:catch}
          {@render unreachable()}
        {/await}
      </div>
    {/each}

    {#if paneCorners.draw && workspace.panes.focusedId === pane.id}
      {@render paneCorners.draw()}
    {/if}
  </div>

  {#if workspace.panes.dragging}
    <div class="zones" class:sides={keepsMiddle} style:--band="{EDGE * 100}%">
      <div class="zone whole" class:lit={zone === 'middle'}></div>
      <div class="zone left" class:lit={zone === 'left'} data-covers={edged}></div>
      <div class="zone right" class:lit={zone === 'right'} data-covers={edged}></div>
      <div class="zone up" class:lit={zone === 'top'} data-covers={edged}></div>
      <div class="zone down" class:lit={zone === 'bottom'} data-covers={edged}></div>
    </div>
  {/if}
</div>

{#snippet surface(load: () => Promise<Component<{ tab: Tab; focused: boolean }>>, shown: Tab)}
  {#key shown.id}
    {#await load() then Surface}
      <Surface tab={shown} focused={workspace.panes.focusedId === pane.id} />
    {:catch}
      {@render unreachable()}
    {/await}
  {/key}
{/snippet}

{#snippet editor(one: Tab, into: Record<string, EditorView | undefined>, shown: boolean, front: boolean, kept: Tab[])}
  <Editor
    bind:view={into[one.id]}
    tab={one}
    {shown}
    focused={front && workspace.panes.focusedId === pane.id}
    {kept}
    {parked}
    {handoff}
    onimage={saveImage}
    resolveimage={resolveImage}
    openlink={followHref}
    notes={(which: Tab) => links.index(which.path, which.note.shared !== null)}
    opennote={followNote}
    nameblock={nameBlock}
    onfind={(ask: FindAsk | null) => (ask ? openFinding(ask) : shutFinding())}
    onfindslow={tallySlow}
    onselection={(current: EditorView) => {
      views.moved(current)
      placement.remember(current)
      rooms.moved(current)
    }}
  />
{/snippet}

{#snippet unreachable()}
  <div class="coming" role="alert">
    <button class="orden-button" onclick={() => location.reload()}>Reload</button>
  </div>
{/snippet}

<style>
  .pane {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--content-ground, var(--bg));
    border-radius: var(--card-radius);
    overflow: clip;
    box-shadow:
      var(--card-shadow),
      0 0 0 1px var(--card-edge);
    transition: border-radius var(--dur-base) var(--ease-out);
  }
  .pane.at-left {
    border-top-left-radius: var(--left-edge, var(--card-radius));
    border-bottom-left-radius: var(--left-edge, var(--card-radius));
  }
  .pane.at-right {
    border-top-right-radius: var(--right-edge, var(--card-radius));
    border-bottom-right-radius: var(--right-edge, var(--card-radius));
  }
  .pane.at-foot {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }
  .pane.straight {
    border-start-start-radius: 0;
  }
  .card {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-radius: inherit;
  }
  .pane:has(> .card > :global(.here)) {
    background: var(--empty-ground, var(--bg));
  }
  .pane.stripped,
  .pane.stripped:has(> .card > :global(.here)) {
    background: none;
    box-shadow: none;
    overflow: visible;
  }
  .pane.stripped > .card {
    overflow: clip;
    background: var(--content-ground, var(--bg));
    box-shadow:
      var(--card-shadow),
      0 0 0 1px var(--card-edge);
  }
  .pane.stripped > .head {
    border-top-left-radius: inherit;
    border-top-right-radius: inherit;
  }
  .pane.stripped.flush > .card {
    border-start-start-radius: 0;
  }
  .pane.stripped > .card:has(> :global(.here)) {
    background: var(--empty-ground, var(--bg));
  }
  .pane.lifted,
  .pane.lifted:has(> .card > :global(.here)),
  .pane.lifted > .card {
    background: none;
    box-shadow: none;
  }
  .pane.lifted > :global(:not(.head)) {
    opacity: 0;
  }
  :global(html[data-overview]) .pane:has(> .card > :global(.here)) {
    opacity: calc(1 - var(--overview-open, 1));
    pointer-events: none;
  }
  .head {
    position: relative;
    z-index: var(--z-tools);
    display: flex;
    align-items: stretch;
    flex: none;
    height: var(--titlebar-height);
    background: var(--tab-frame);
    overflow-x: clip;
  }
  .editor {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .kept {
    display: none;
  }
  .shell {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .stack {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }
  .stack::-webkit-scrollbar {
    display: none;
  }
  .column {
    position: relative;
    flex: 1 0 var(--stack-column);
    min-width: 0;
    display: flex;
    border-inline-start: 1px solid var(--line);
    transition: flex-basis var(--dur-base) var(--ease-out);
  }
  .column:first-child {
    border-inline-start: 0;
  }
  .column.is-active {
    flex-basis: var(--stack-column-wide);
  }
  .spine {
    position: sticky;
    inset-inline-start: 0;
    z-index: var(--z-raised);
    flex: none;
    width: var(--titlebar-height);
    border: 0;
    padding: var(--space-3) 0;
    background: var(--surface);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: pointer;
    text-align: start;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  .spine .orden-row-label {
    display: block;
    max-height: 100%;
    overflow: hidden;
    writing-mode: vertical-rl;
    text-orientation: mixed;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (hover: hover) {
    .spine:hover {
      color: var(--text);
    }
  }
  .column.is-active .spine {
    background: var(--content-ground, var(--bg));
    color: var(--text-strong);
  }
  .sheet {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
  }
  .coming {
    flex: 1;
    display: grid;
    place-items: center;
    min-height: 0;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    user-select: none;
    -webkit-user-select: none;
  }
  .zones {
    position: absolute;
    inset: 0;
    z-index: var(--z-grip);
    pointer-events: none;
    border-radius: inherit;
    overflow: clip;
  }
  .zones.sides .zone.whole {
    pointer-events: none;
  }
  .zone {
    position: absolute;
    pointer-events: auto;
    background: var(--accent-soft);
    border: 1px solid transparent;
    opacity: 0;
    transition:
      opacity var(--dur-fast) var(--ease-out),
      inset var(--dur-base) var(--ease-out);
  }
  .zone.lit {
    opacity: 1;
    border-color: var(--accent-line);
  }
  .zone.whole {
    inset: 0;
  }
  .zone.left {
    inset: 0 auto 0 0;
    width: var(--band);
  }
  .zone.right {
    inset: 0 0 0 auto;
    width: var(--band);
  }
  .zone.up {
    inset: 0 0 auto 0;
    height: var(--band);
  }
  .zone.down {
    inset: auto 0 0 0;
    height: var(--band);
  }
</style>
