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
    setReadOnlyMode,
  } from '@orden/editor'
  import { untrack } from 'svelte'
  import Door from './Door.svelte'
  import { whileHere } from './while-here'
  import { alone } from './alone.svelte'
  import type { Tab } from './workspace.svelte'
  import { type Pane, panesIn, topRow } from './workspace/pane-tree'
  import type { Landing } from './workspace/panes.svelte'
  import { TAB_KINDS } from './workspace/tab-kinds'
  import { isDesktop } from './platform/src/api'
  import { dragged, dropOver, isTreeDrag } from './drag-paths'
  import Editor from './Editor.svelte'
  import { message } from './ui-kit/src/api'
  import { keptAway } from './web/away.svelte'
  import { busy } from './ui-kit/src/api'

  import { chrome } from './theme/src/api'
  import { without } from './graph'
  import { links } from './link-index.svelte'
  import { modes } from './modes.svelte'
  import { pull } from './pull.svelte'
  import { notePicture } from './note-images'
  import { placement } from './placement.svelte'
  import { rooms } from './collab/src/api'
  import { appsOn, explorerOn, settings } from './settings.svelte'
  import {
    applicationSurface,
    archivedStrip,
    askPanel,
    canvasSurface,
    chatSurface,
    emptySurface,
    explorerSurface,
    passSurface,
    settingsSurface,
    timeSurface,
    findBar,
    graphSurface,
    lockScreen,
    pagesSurface,
    readingSurface,
    tabOverview,
    terminalSurface,
    viewSurface,
    todosBoard,
    webSurface,
  } from './surfaces.svelte'
  import { canWriteIn } from './sharing.svelte'
  import { shortcuts } from './shortcuts.svelte'
  import { storeAttachment, storeImage } from './assets'
  import Tabs from './Tabs.svelte'
  import { flushFirst } from './tab-strip/flush'
  import { followHref, followNote } from './open-link'
  import type { OpenHow } from './new-tab'
  import { usage } from './usage.svelte'
  import { viewport } from './ui-kit/src/api'
  import { views } from './views.svelte'
  import { workspace } from './workspace.svelte'
  import { keepsScroll, scrollKeyOf } from './kept-scroll'
  import { noteBehind } from './protect/protection.svelte'
  import { paneCorners } from './pane-corners.svelte'
  import { EDGE, inside, type Zone, zoneAt } from './workspace/zones'

  const { pane }: { pane: Pane } = $props()

  const here = whileHere()

  const tab = $derived(workspace.showing(pane.id))
  const scrollKept = $derived(scrollKeyOf(tab, workspace.windowSlot))
  const behind = $derived(tab ? noteBehind(tab) : null)
  const locked = $derived(workspace.protection.locked(behind))

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
  const ownSurface = $derived(
    !!tab && (TAB_KINDS[tab.kind].takesDrops || (isDesktop && tab.kind === 'web')),
  )
  const writing = $derived(!!tab && TAB_KINDS[tab.kind].editor && !tab.reading && !locked)

  const columns = $derived(
    pane.stacked && !viewport.touch
      ? workspace
          .tabsIn(pane.id)
          .filter(
            (one) => one.kind === 'note' && !one.reading && !workspace.protection.locked(one.path),
          )
      : [],
  )

  const stacking = $derived(columns.length > 1 && columns.some((one) => one.id === tab?.id))

  let view = $state<EditorView>()

  const keepsMiddle = $derived(
    ownSurface || (writing && !tab?.coming && !modes.readOnly && canWriteIn(tab?.note)),
  )

  const edged = $derived(keepsMiddle ? '' : undefined)

  const columnViews = $state<Record<string, EditorView | undefined>>({})

  $effect(() => {
    if (!stacking) return

    const current = columnViews[pane.activeTabId ?? '']
    if (current && current !== view) view = current
  })

  type FindFlags = Pick<FindSpec, 'caseSensitive' | 'regexp' | 'wholeWord'>

  let finding = $state(false)
  let replacing = $state(false)
  let spec = $state<FindSpec>(NO_FIND)
  let tally = $state<FindTally>(NO_TALLY)

  const canReplace = $derived(
    !!tab && !tab.reading && !modes.readOnly && canWriteIn(tab.note) && !!view,
  )

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
    void look(ask.seed ? { ...spec, query: ask.seed } : spec)
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
    modes.apply(current)
    shortcuts.apply(current)

    return () => {
      views.forget(pane.id)
      modes.forget(current)
      shortcuts.forget(current)
    }
  })

  $effect(() => {
    const current = view
    const showing = tab
    if (!current || !showing) return

    return placement.follow(current, showing)
  })

  $effect(() => {
    const current = view
    const note = tab?.note
    if (!current) return

    setReadOnlyMode(current, modes.readOnly || !canWriteIn(note))
  })

  function showMenu(event: MouseEvent, on: EditorView | undefined, path: string | null) {
    event.preventDefault()
    event.stopPropagation()
    void here(import('./editor-menu')).then(({ showEditorMenu }) => showEditorMenu(event, on, path))
  }

  async function saveImage(file: File, into: Tab): Promise<string | null> {
    if (!file.type.startsWith('image/')) return saveAttachment(file, into)

    try {
      const src = await busy.run('Storing the image', () => storeImage(file, into.path))
      void usage.refresh()
      return src
    } catch (error) {
      void usage.refresh()
      settings.error = message(error, 'That image does not fit in your storage.')
      return null
    }
  }

  async function saveAttachment(file: File, into: Tab): Promise<string | null> {
    try {
      return await busy.run('Storing the file', () => storeAttachment(file, into.path))
    } catch (error) {
      settings.error = message(error, 'That file could not be kept.')
      return null
    }
  }

  function resolveImage(src: string, from: Tab): string {
    return notePicture(src, from.path, from.doc)
  }

  function nameBlock(path: string, line: number, from: Tab): Promise<string | null> {
    return links.nameBlock(path, line, from.path)
  }

  function zoneOf(event: DragEvent & { currentTarget: HTMLElement }): Zone {
    const box = event.currentTarget.getBoundingClientRect()
    const moving = workspace.panes.dragging?.tabId ?? null

    return zoneAt(box, event.clientX, event.clientY, (side) =>
      workspace.canLand(side, pane.id, moving),
    )
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
  const zone = $derived(
    landing?.kind === 'pane' && landing.paneId === pane.id ? landing.zone : undefined,
  )
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="pane"
  class:lifted={tabOverview.lifted.includes(pane.id)}
  class:straight={!stripped && flushFirst(pane.id)}
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
    {#key tab.id}
      {#await canvasSurface() then Canvas}
        <Canvas {tab} focused={workspace.panes.focusedId === pane.id} />
      {:catch}
        {@render unreachable()}
      {/await}
    {/key}
  {:else if tab?.kind === 'pages' || tab?.kind === 'pdf'}
    {#key tab.id}
      {#await pagesSurface() then Pages}
        <Pages {tab} focused={workspace.panes.focusedId === pane.id} />
      {:catch}
        {@render unreachable()}
      {/await}
    {/key}
  {:else if tab?.kind === 'web'}
    {#key tab.id}
      {#await webSurface() then WebTab}
        <WebTab {tab} focused={workspace.panes.focusedId === pane.id} />
      {:catch}
        {@render unreachable()}
      {/await}
    {/key}
  {:else if tab?.kind === 'view' && tab.path === null}
    {#key tab.id}
      {#await todosBoard() then TodosBoard}
        <TodosBoard />
      {:catch}
        {@render unreachable()}
      {/await}
    {/key}
  {:else if tab?.kind === 'view'}
    {#key tab.id}
      {#await viewSurface() then ViewTab}
        <ViewTab {tab} />
      {:catch}
        {@render unreachable()}
      {/await}
    {/key}
  {:else if tab?.kind === 'channel'}
    {#key tab.id}
      {#await chatSurface() then ChatTab}
        <ChatTab {tab} />
      {:catch}
        {@render unreachable()}
      {/await}
    {/key}
  {:else if tab?.kind === 'chat'}
    {#await askPanel() then ChatPanel}
      <ChatPanel wide />
    {:catch}
      {@render unreachable()}
    {/await}
  {:else if tab?.kind === 'terminal'}
    {#key tab.id}
      {#await terminalSurface() then TerminalTab}
        <TerminalTab {tab} focused={workspace.panes.focusedId === pane.id} />
      {:catch}
        {@render unreachable()}
      {/await}
    {/key}
  {:else if tab?.kind === 'application'}
    {#if appsOn()}
      {#key tab.id}
        {#await applicationSurface() then ApplicationTab}
          <ApplicationTab {tab} />
        {:catch}
          {@render unreachable()}
        {/await}
      {/key}
    {/if}
  {:else if tab?.kind === 'explorer'}
    {#if explorerOn()}
      {#key tab.id}
        {#await explorerSurface() then ExplorerTab}
          <ExplorerTab {tab} focused={workspace.panes.focusedId === pane.id} />
        {:catch}
          {@render unreachable()}
        {/await}
      {/key}
    {/if}
  {:else if tab?.kind === 'pass'}
    {#key tab.id}
      {#await passSurface() then PassTab}
        <PassTab {tab} focused={workspace.panes.focusedId === pane.id} />
      {:catch}
        {@render unreachable()}
      {/await}
    {/key}
  {:else if tab?.kind === 'settings'}
    {#key tab.id}
      {#await settingsSurface() then SettingsPanel}
        <SettingsPanel />
      {:catch}
        {@render unreachable()}
      {/await}
    {/key}
  {:else if tab?.kind === 'time'}
    {#key tab.id}
      {#await timeSurface() then TimeTab}
        <TimeTab {tab} />
      {:catch}
        {@render unreachable()}
      {/await}
    {/key}
  {:else if tab?.coming}
    <div class="coming" role="status">
      {keptAway.offline && tab.path !== null && keptAway.at(tab.path) !== null
        ? 'Not on this device. It opens once you are online again.'
        : 'Loading…'}
    </div>
  {:else if tab?.reading}
    {#key tab.id}
      {#await readingSurface() then Reading}
        <Reading {tab} focused={workspace.panes.focusedId === pane.id} />
      {:catch}
        {@render unreachable()}
      {/await}
    {/key}
  {:else if stacking}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="stack" data-region="editor">
      {#each columns as one (one.id)}
        <section class="column" class:is-active={one.id === pane.activeTabId}>
          <button
            class="spine"
            title={one.shown}
            aria-label={one.shown}
            aria-pressed={one.id === pane.activeTabId}
            onclick={() => workspace.activate(one.id)}
          >
            <span class="orden-row-label" dir="auto">{one.shown}</span>
          </button>
          <div
            class="sheet"
            oncontextmenu={(event: MouseEvent) => showMenu(event, columnViews[one.id], one.path)}
          >
            <Editor
              bind:view={columnViews[one.id]}
              tab={one}
              focused={workspace.panes.focusedId === pane.id && one.id === pane.activeTabId}
              kept={held}
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
          </div>
        </section>
      {/each}
    </div>
  {:else if tab}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="editor"
      data-region="editor"
      oncontextmenu={(event: MouseEvent) => showMenu(event, view, tab.path)}
    >
      <Editor
        bind:view
        {tab}
        focused={workspace.panes.focusedId === pane.id}
        kept={held}
        onimage={saveImage}
        resolveimage={resolveImage}
        openlink={followHref}
        notes={(one: Tab) => links.index(one.path, one.note.shared !== null)}
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
    </div>
  {:else}
    {#await emptySurface() then NewHere}
      <NewHere paneId={pane.id} />
    {:catch}
      {@render unreachable()}
    {/await}
  {/if}

  {#if paneCorners.draw && workspace.panes.focusedId === pane.id}
    {@render paneCorners.draw()}
  {/if}

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
  }

  .pane.straight {
    border-start-start-radius: 0;
  }

  .pane:has(> .head) {
    background: linear-gradient(
      transparent var(--titlebar-height),
      var(--content-ground, var(--bg)) 0
    );
  }

  .pane:global([data-underlay])::before {
    background: var(--content-ground, var(--bg));
  }

  .pane:global([data-underlay]):has(> .head)::before {
    background: linear-gradient(
      transparent var(--titlebar-height),
      var(--content-ground, var(--bg)) 0
    );
  }

  .pane:has(> :global(.here)),
  .pane:has(> .head):has(> :global(.here)) {
    background: var(--empty-ground, var(--bg));
  }

  .pane.lifted,
  .pane.lifted:has(> .head),
  .pane.lifted:has(> .head):has(> :global(.here)) {
    background: none;
    box-shadow: none;
  }

  .pane.lifted > :global(:not(.head)) {
    opacity: 0;
  }

  :global(html[data-overview]) .pane:has(> :global(.here)) {
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
