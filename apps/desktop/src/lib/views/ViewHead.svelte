<script lang="ts">
  import { type Base, writeBase } from '@orden/bases'
  import { DIVIDER, menu, type MenuEntry } from '../menu.svelte'
  import { ORDER_MARK } from '../panel-marks'
  import { segmented } from '../slide'
  import { relativeTo } from '../space-paths'
  import { viewport } from '../viewport.svelte'
  import { workspace } from '../workspace.svelte'
  import ArrangeBuilder from './ArrangeBuilder.svelte'
  import AutomationsBuilder from './AutomationsBuilder.svelte'
  import ButtonBuilder from './ButtonBuilder.svelte'
  import ColourBuilder from './ColourBuilder.svelte'
  import { grouped } from './column-menu'
  import { copyCsv, saveCsv } from './csv'
  import { addView, freeViewName, removeView, renameView, setBaseOrden, setViewOrden } from './edit'
  import FilterBuilder from './FilterBuilder.svelte'
  import type { Kit } from './kit'
  import { switched } from './layout'
  import type { Builder } from './live.svelte'
  import { ADD_MARK, DISPLAY_MARK, FILTER_MARK, GROUP_MARK, LAYOUT_MARKS, LOCK_MARK } from './marks'
  import DisplayBuilder from './DisplayBuilder.svelte'
  import { changedFrom } from './display'
  import Sheet from '../Sheet.svelte'
  import { shippedBase } from './source'
  import FormulaBuilder from './FormulaBuilder.svelte'
  import NameBuilder from './NameBuilder.svelte'
  import OptionsBuilder from './OptionsBuilder.svelte'
  import RollupBuilder from './RollupBuilder.svelte'
  import { templates } from './templates'
  import Popover from './Popover.svelte'
  import { copiesToBase, copyToBase } from './save'
  import { focusSoon } from './focus-soon'
  import { copyText } from '../clipboard'
  import { displayName } from './columns'
  import ViewSettings from './ViewSettings.svelte'
  import { projectAt, renameProject } from './project-actions'
  import { addSection, projectOf } from './section-actions'
  import { prompt } from '../prompt.svelte'
  import { type Layout, LAYOUTS, layoutName, layoutOf, propertyName } from './words'

  const {
    kit,
    title,
    onadd,
  }: {
    kit: Kit
    title: string
    onadd: () => void
  } = $props()

  const live = $derived(kit.live)
  const view = $derived(live.view)
  const base = $derived(live.base)
  const layout = $derived(layoutOf(view?.type ?? 'table'))
  const named = $derived(kit.spec.builtin !== 'todos' && view?.name.trim() ? view.name : title)
  const offered = $derived(
    LAYOUTS.filter(
      (one) =>
        (one !== 'timeline' || (!kit.compact && viewport.device !== 'phone')) &&
        (one !== 'form' || (view?.orden.rows ?? 'notes') === 'notes'),
    ),
  )

  type Tool = 'filter' | 'sort' | 'group'
  const TOOLS = [
    { id: 'filter', mark: FILTER_MARK, label: 'Filter' },
    { id: 'sort', mark: ORDER_MARK, label: 'Sort' },
    { id: 'group', mark: GROUP_MARK, label: 'Group' },
  ] as const

  let open = $state<Tool | 'display' | 'settings' | 'chip-filter' | 'chip-sort' | null>(null)
  const project = $derived(projectOf(kit))
  const tasky = $derived(kit.spec.builtin !== undefined || view?.orden.rows === 'tasks')
  const tabbed = $derived(kit.spec.builtin === undefined)
  const displayChanged = $derived.by(() => {
    if (!view) return 0
    const original =
      kit.spec.builtin === undefined ? null : (shippedBase(kit.spec).views[0] ?? null)
    return changedFrom(view, original).total
  })
  const notes = $derived((view?.orden.rows ?? 'notes') === 'notes')

  const BUILDERS: Record<Builder['kind'], string> = {
    colour: 'Colour',
    automations: 'Automations',
    rollup: 'Rollup',
    button: 'Button',
    options: 'Options',
    formula: 'Formula',
    name: 'Rename',
  }

  const HEIGHTS = [
    { lines: 1, label: 'Short' },
    { lines: 2, label: 'Medium' },
    { lines: 4, label: 'Tall' },
  ]

  function linkTo(path: string): string {
    const root = workspace.activeSpace?.root ?? ''
    return `[[${relativeTo(root, path).replace(/\.md$/i, '')}]]`
  }

  async function templateRows(
    chosen: string | undefined,
    pick: (link: string | null) => void,
  ): Promise<MenuEntry[]> {
    const found = await templates()
    return [
      { label: 'Blank', checked: chosen === undefined, run: () => pick(null) },
      ...found.map((one) => ({
        label: one.name.replace(/\.md$/i, ''),
        checked: chosen === linkTo(one.path),
        run: () => pick(linkTo(one.path)),
      })),
    ]
  }

  function plusMenu(event: MouseEvent) {
    if (!notes || !base) return
    event.preventDefault()
    void templateRows(undefined, (link) => kit.add(undefined, link)).then((items) =>
      menu.show(event, items, { title: 'New note' }),
    )
  }
  let renaming = $state(false)

  const toggle = (which: NonNullable<typeof open>) => (open = open === which ? null : which)

  function reset() {
    open = null
    kit.change(() => shippedBase(kit.spec))
  }

  function pick(next: Layout) {
    kit.change((one, at) => switched(one, at, next, live.rows))
  }

  function viewRows(base: Base): MenuEntry[] {
    const views = base.views
    return [
      ...(project
        ? [
            { label: 'Rename', run: () => (renaming = true) },
            {
              label: 'Add section',
              asks: true,
              run: () =>
                void prompt
                  .ask({ title: 'Add section', confirmLabel: 'Add section' })
                  .then((words) => (words?.trim() ? addSection(kit, words) : undefined)),
            },
            { label: 'Open in note', run: () => void workspace.open(project.path) },
            {
              label: 'Save as CSV',
              run: () =>
                void import('./todoist-csv').then((one) =>
                  one.saveProjectCsv(project.path, project.name),
                ),
            },
            DIVIDER,
          ]
        : []),
      ...(views.length > 1
        ? [
            ...views.map((one, at) => ({
              label: one.name ? one.name : title,
              checked: at === live.at,
              run: () => (live.at = at),
            })),
            DIVIDER,
          ]
        : []),
      ...(kit.writable && !project && (kit.spec.builtin === undefined || views.length > 1)
        ? [{ label: 'Rename', run: () => (renaming = true) }]
        : []),
      ...(kit.writable
        ? [
            { label: 'New view', run: () => kit.change((one, at) => addView(one, at, 'table')) },
            { label: 'Duplicate view', run: () => kit.change((one, at) => addView(one, at)) },
          ]
        : []),
      ...(kit.writable && views.length > 1
        ? [
            {
              label: 'Delete view',
              danger: true,
              run: () => kit.change((one, at) => removeView(one, at)),
            },
          ]
        : []),
      ...(kit.file === null && copiesToBase()
        ? [
            DIVIDER,
            {
              label: 'Copy to a base',
              run: () => void copyToBase(writeBase(base), named),
            },
          ]
        : []),
    ]
  }

  function moreRows(event?: MouseEvent): MenuEntry[] {
    if (!base) return []
    if (!kit.writable) return csvRows()
    return [
      {
        label: 'Colour',
        checked: view?.orden.colour !== undefined,
        run: () => (live.builder = { kind: 'colour' }),
      },
      ...(layout === 'table'
        ? [
            grouped(event, 'Row height', () =>
              Promise.resolve(
                HEIGHTS.map((one) => ({
                  label: one.label,
                  checked: (view?.orden.lines ?? 1) === one.lines,
                  run: () =>
                    kit.change((b, at) =>
                      setViewOrden(b, at, 'lines', one.lines === 1 ? undefined : one.lines),
                    ),
                })),
              ),
            ),
          ]
        : []),
      ...(kit.file !== null
        ? [
            {
              label: 'Automations',
              checked: Array.isArray(base.orden.kept.automations),
              run: () => (live.builder = { kind: 'automations' }),
            },
          ]
        : []),
      ...(notes
        ? [
            grouped(event, 'Default template', () =>
              templateRows(view?.orden.template ?? base.orden.template, (link) =>
                kit.change((b, at) => setViewOrden(b, at, 'template', link ?? undefined)),
              ),
            ),
          ]
        : []),
      DIVIDER,
      ...csvRows(),
      DIVIDER,
      {
        label: view?.orden.locked ? 'Unlock view' : 'Lock view',
        run: () =>
          kit.change(
            (b, at) => setViewOrden(b, at, 'locked', view?.orden.locked ? undefined : true),
            true,
          ),
      },
      ...(kit.file !== null
        ? [
            {
              label: base.orden.locked ? 'Unlock base' : 'Lock base',
              run: () =>
                kit.change(
                  (b) => setBaseOrden(b, 'locked', base.orden.locked ? undefined : true),
                  true,
                ),
            },
          ]
        : []),
    ]
  }

  function csvRows(): MenuEntry[] {
    return [
      { label: 'Copy as CSV', run: () => void copyCsv(live) },
      { label: 'Save as CSV', run: () => void saveCsv(live, named) },
    ]
  }

  function nameMenu(event: MouseEvent) {
    if (!base) return
    menu.show(event, [...viewRows(base), DIVIDER, ...moreRows(event)], { title: named })
  }

  let naming = $state<number | null>(null)

  function addTab(event: MouseEvent) {
    if (!base) return
    const last = base.views.length - 1
    menu.show(
      event,
      offered.map((one) => ({
        label: layoutName(one),
        run: () =>
          void kit
            .changed((b) => {
              const rows = b.views[live.at]?.orden.rows
              const fresh: Base = {
                ...b,
                views: [
                  ...b.views,
                  {
                    type: 'table',
                    name: freeViewName(b, layoutName(one)),
                    order: [],
                    sort: [],
                    summaries: {},
                    orden: {
                      kept: {},
                      ...(rows ? { rows } : {}),
                    },
                    options: {},
                  },
                ],
              }
              return switched(fresh, last + 1, one, live.rows)
            }, last + 1)
            .catch(() => undefined),
      })),
      { title: 'New view' },
    )
  }

  function tabMenu(event: MouseEvent, at: number) {
    if (!base) return
    event.preventDefault()
    const one = base.views[at]
    const file = kit.file
    menu.show(
      event,
      [
        ...(kit.writable
          ? [
              { label: 'Rename', run: () => (naming = at) },
              {
                label: 'Duplicate view',
                run: () => void kit.changed((b) => addView(b, at), at + 1).catch(() => undefined),
              },
            ]
          : csvRows()),
        ...(file !== null && one?.name
          ? [
              {
                label: 'Copy link',
                run: () => {
                  const root = workspace.activeSpace?.root ?? ''
                  void copyText(`![[${relativeTo(root, file)}#${one.name}]]`)
                },
              },
            ]
          : []),
        ...(kit.writable && base.views.length > 1
          ? [
              DIVIDER,
              {
                label: 'Delete view',
                danger: true,
                run: () => {
                  const showing = live.at
                  void kit
                    .changed((b) => removeView(b, at), showing > at ? showing - 1 : undefined)
                    .catch(() => undefined)
                },
              },
            ]
          : []),
      ],
      { title: one?.name.trim() ? one.name : title },
    )
  }

  const sortWords = $derived(
    (view?.sort ?? [])
      .map((one) => propertyName(one.property, base ? displayName(base, one.property) : undefined))
      .join(', '),
  )

  const active = $derived({
    filter: view?.filters !== undefined,
    sort: (view?.sort.length ?? 0) > 0,
    group: view?.groupBy !== undefined,
  })
</script>

{#snippet layer(start: boolean)}
  <Popover
    {start}
    open={live.builder !== null}
    label={live.builder ? BUILDERS[live.builder.kind] : ''}
    onclose={() => (live.builder = null)}
  >
    {#if live.builder?.kind === 'colour'}
      <ColourBuilder {kit} />
    {:else if live.builder?.kind === 'automations'}
      <AutomationsBuilder {kit} />
    {:else if live.builder?.kind === 'rollup'}
      <RollupBuilder {kit} column={live.builder.column} />
    {:else if live.builder?.kind === 'button'}
      <ButtonBuilder {kit} column={live.builder.column} />
    {:else if live.builder?.kind === 'options'}
      <OptionsBuilder {kit} column={live.builder.column} />
    {:else if live.builder?.kind === 'formula'}
      <FormulaBuilder {kit} column={live.builder.column} />
    {:else if live.builder?.kind === 'name'}
      <NameBuilder {kit} column={live.builder.column} />
    {/if}
  </Popover>
{/snippet}
{#snippet lock()}
  {#if live.locked}
    {#key live.refused}
      <button
        type="button"
        class="orden-glyph lock"
        class:shake={live.refused > 0}
        disabled={!kit.writable}
        title="Unlock view"
        aria-label="Unlock view"
        onclick={() =>
          kit.change(
            (b, at) => setBaseOrden(setViewOrden(b, at, 'locked', undefined), 'locked', undefined),
            true,
          )}
      >
        <svg viewBox="0 0 13 13"><path d={LOCK_MARK} /></svg>
      </button>
    {/key}
  {/if}
{/snippet}
{#snippet searchField()}
  {#if !kit.compact}
    <label class="orden-field search">
      <svg class="orden-field-mark" viewBox="0 0 13 13" aria-hidden="true"
        ><path d="M5.5 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM8.6 8.6l3 3" /></svg
      >
      <input
        type="search"
        value={live.typed}
        aria-label="Search"
        placeholder="Search"
        oninput={(event) => live.search(event.currentTarget.value)}
        onkeydown={(event) => {
          if (event.key === 'Escape' && live.typed) {
            event.preventDefault()
            event.stopPropagation()
            live.search('')
          }
        }}
      />
    </label>
  {/if}
{/snippet}
{#snippet tools(which: readonly Tool[])}
  {#each TOOLS.filter((one) => which.includes(one.id)) as tool (tool.id)}
    <div class="tool">
      <button
        type="button"
        class="orden-glyph"
        class:set={active[tool.id]}
        class:open={open === tool.id}
        data-opens-popover
        title={tool.label}
        aria-label={tool.label}
        aria-expanded={open === tool.id}
        onclick={() => toggle(tool.id)}
      >
        <svg viewBox="0 0 13 13"><path d={tool.mark} /></svg>
      </button>
      <Popover open={open === tool.id} label={tool.label} onclose={() => (open = null)}>
        {#if tool.id === 'filter'}
          <FilterBuilder {kit} />
        {:else}
          <ArrangeBuilder {kit} part={tool.id} />
        {/if}
      </Popover>
    </div>
  {/each}
{/snippet}
{#snippet display()}
  <div class="tool">
    <button
      type="button"
      class="orden-glyph display-button"
      class:set={displayChanged > 0}
      class:open={open === 'display'}
      data-opens-popover
      title="Display"
      aria-label={displayChanged ? `Display: ${displayChanged}` : 'Display'}
      aria-expanded={open === 'display'}
      onclick={() => toggle('display')}
    >
      <svg viewBox="0 0 13 13"><path d={DISPLAY_MARK} /></svg>
      {#if !kit.compact}<span class="display-word">Display</span>{/if}
      {#if displayChanged}<span class="display-count">{displayChanged}</span>{/if}
    </button>
    {#if viewport.device === 'phone'}
      <Sheet open={open === 'display'} title="Display" onclose={() => (open = null)}>
        <DisplayBuilder {kit} onreset={kit.spec.builtin !== undefined ? reset : undefined} />
      </Sheet>
    {:else}
      <Popover open={open === 'display'} label="Display" onclose={() => (open = null)}>
        <DisplayBuilder {kit} onreset={kit.spec.builtin !== undefined ? reset : undefined} />
      </Popover>
    {/if}
  </div>
{/snippet}
{#snippet plusButton()}
  {#if kit.adds}
    <button
      type="button"
      class="orden-glyph"
      title={notes ? 'New note' : 'Add task'}
      aria-label={notes ? 'New note' : 'Add task'}
      onclick={onadd}
      oncontextmenu={plusMenu}
    >
      <svg viewBox="0 0 13 13"><path d={ADD_MARK} /></svg>
    </button>
  {/if}
{/snippet}

{#snippet chip(which: 'chip-filter' | 'chip-sort', label: string, tool: Tool)}
  <div class="tool">
    <button
      type="button"
      class="orden-chip is-on"
      data-opens-popover
      disabled={!kit.writable}
      aria-expanded={open === which}
      onclick={() => toggle(which)}>{label}</button
    >
    <Popover start open={open === which} {label} onclose={() => (open = null)}>
      {#if tool === 'filter'}
        <FilterBuilder {kit} />
      {:else}
        <ArrangeBuilder {kit} part="sort" />
      {/if}
    </Popover>
  </div>
{/snippet}

{#if tabbed}
  <div class="head tabbed" class:compact={kit.compact}>
    {#if kit.file !== null && !kit.compact}
      <h1 class="title">{title}</h1>
    {/if}
    <div class="bar">
      <div class="tabs" role="tablist" aria-label="Views">
        {#each base?.views ?? [] as one, at (at)}
          {#if naming === at}
            <input
              class="orden-field rename"
              value={one.name}
              aria-label="Rename"
              use:focusSoon
              onkeydown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  naming = null
                }
              }}
              onblur={(event) => {
                if (naming !== at) return
                const name = event.currentTarget.value
                naming = null
                kit.change((b) => renameView(b, at, name))
              }}
            />
          {:else}
            <button
              type="button"
              role="tab"
              class="tab"
              class:on={at === live.at}
              aria-selected={at === live.at}
              onclick={() => {
                open = null
                live.builder = null
                live.at = at
              }}
              ondblclick={() => {
                if (kit.writable) naming = at
              }}
              oncontextmenu={(event) => tabMenu(event, at)}
            >
              <svg viewBox="0 0 13 13" aria-hidden="true"
                ><path d={LAYOUT_MARKS[layoutOf(one.type)]} /></svg
              >
              <span class="words">{one.name || title}</span>
            </button>
          {/if}
        {/each}
        {#if kit.writable}
          <button
            type="button"
            class="orden-glyph"
            title="New view"
            aria-label="New view"
            onclick={addTab}
          >
            <svg viewBox="0 0 13 13" aria-hidden="true"><path d={ADD_MARK} /></svg>
          </button>
        {/if}
      </div>
      {@render lock()}
      <span class="spring"></span>
      {#if kit.writable}{@render tools(['filter', 'sort'])}{/if}
      {#if tasky && kit.writable}{@render display()}{/if}
      {@render searchField()}
      {#if kit.writable}<div class="tool">
          <button
            type="button"
            class="orden-glyph"
            class:open={open === 'settings'}
            data-opens-popover
            title="Settings"
            aria-label="Settings"
            aria-expanded={open === 'settings'}
            onclick={() => toggle('settings')}
          >
            <svg viewBox="0 0 13 13" aria-hidden="true" class="dots"
              ><circle cx="3" cy="6.5" r="0.9" /><circle cx="6.5" cy="6.5" r="0.9" /><circle
                cx="10"
                cy="6.5"
                r="0.9"
              /></svg
            >
          </button>
          <Popover open={open === 'settings'} label="Settings" onclose={() => (open = null)}>
            <ViewSettings
              {kit}
              more={(event?: MouseEvent) => {
                const rows = moreRows(event)
                return rows.map((row) =>
                  row ? { ...row, run: () => ((open = null), row.run()) } : row,
                )
              }}
            />
          </Popover>
        </div>{/if}
      <div class="tool">{@render layer(false)}</div>
      {#if !kit.compact || notes || tasky}{@render plusButton()}{/if}
    </div>
    {#if active.filter || active.sort}
      <div class="chips">
        {#if active.sort}{@render chip('chip-sort', sortWords, 'sort')}{/if}
        {#if active.filter}{@render chip('chip-filter', 'Filter', 'filter')}{/if}
      </div>
    {/if}
  </div>
{:else}
  <div class="head" class:compact={kit.compact}>
    {#if renaming}
      <input
        class="orden-field rename"
        value={project ? named : (view?.name ?? '')}
        aria-label="Rename"
        use:focusSoon
        onkeydown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            renaming = false
          }
        }}
        onblur={(event) => {
          if (!renaming) return
          const name = event.currentTarget.value
          renaming = false
          if (project) {
            if (name.trim() && name.trim() !== project.name)
              void renameProject(projectAt(project.path), name)
          } else kit.change((one, at) => renameView(one, at, name))
        }}
      />
    {:else}
      <div class="tool named">
        <button type="button" class="name" onclick={nameMenu} oncontextmenu={nameMenu}>
          <span class="words">{named}</span>
          <svg viewBox="0 0 13 13" aria-hidden="true"><path d="M3.8 5.2l2.7 2.7 2.7-2.7" /></svg>
        </button>
        {@render layer(true)}
      </div>
    {/if}

    {@render lock()}

    {#if !tasky && kit.writable}
      <div class="orden-segmented layouts" role="tablist" aria-label="Layout" use:segmented>
        {#each offered as one (one)}
          <button
            type="button"
            role="tab"
            class:on={layout === one}
            aria-selected={layout === one}
            title={layoutName(one)}
            aria-label={layoutName(one)}
            onclick={() => pick(one)}
          >
            <svg viewBox="0 0 13 13"><path d={LAYOUT_MARKS[one]} /></svg>
          </button>
        {/each}
      </div>
    {/if}

    <span class="spring"></span>

    {#if !tasky && kit.writable}{@render tools(['filter', 'sort', 'group'])}{/if}

    {@render searchField()}

    {#if tasky && kit.writable}{@render display()}{/if}

    {@render plusButton()}
  </div>
{/if}

<style>
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--header-height);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--line);
    font-family: var(--font-ui);
  }

  .head.compact {
    min-height: 0;
    padding: var(--space-1) var(--space-2);
    border-bottom: none;
  }

  .name {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    max-width: 30%;
    padding: 0 var(--space-2);
    height: var(--row-height);
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--text-strong);
    font: inherit;
    font-size: var(--text-head);
    font-weight: var(--weight-strong);
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .compact .name {
    font-size: var(--text-row);
  }

  @media (hover: hover) {
    .name:hover {
      background: var(--surface-hover);
    }
  }

  .words {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name svg,
  .head svg {
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .rename {
    max-width: 30%;
  }

  .named {
    min-width: 0;
    max-width: 30%;
  }

  .named .name {
    max-width: 100%;
  }

  .lock {
    color: var(--muted-strong);
  }

  .head.tabbed {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-1);
    padding-bottom: 0;
  }

  .head.tabbed.compact {
    padding-bottom: var(--space-1);
  }

  .title {
    margin: var(--space-2) var(--space-2) var(--space-1);
    color: var(--text-strong);
    font-size: var(--text-title, 1.6rem);
    font-weight: var(--weight-strong);
    line-height: 1.2;
    overflow-wrap: anywhere;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }

  .tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .tabs::-webkit-scrollbar {
    display: none;
  }

  .tab {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-1);
    max-width: 14rem;
    height: var(--row-height);
    padding: 0 var(--space-2);
    border: none;
    border-radius: var(--radius-row) var(--radius-row) 0 0;
    background: none;
    box-shadow: inset 0 -2px 0 transparent;
    color: var(--muted-strong);
    font: inherit;
    font-size: var(--text-sm);
    cursor: default;
    transition:
      color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }

  .tab.on {
    box-shadow: inset 0 -2px 0 var(--text-strong);
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }

  @media (hover: hover) {
    .tab:hover {
      background: var(--surface-hover);
    }
  }

  .tabs .rename {
    max-width: 12rem;
  }

  .head svg.dots {
    fill: currentColor;
    stroke: none;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    padding: var(--space-1) 0 var(--space-2);
  }

  .chips .orden-chip {
    max-width: 20rem;
  }

  .lock.shake {
    animation: shake var(--dur-base) var(--ease-out);
    color: var(--accent);
  }

  @keyframes shake {
    20%,
    60% {
      translate: -2px 0;
    }
    40%,
    80% {
      translate: 2px 0;
    }
  }

  .layouts button {
    display: grid;
    place-items: center;
    padding: 0 var(--space-2);
  }

  .spring {
    flex: 1;
  }

  .tool {
    position: relative;
  }

  .orden-glyph.set {
    color: var(--accent);
  }

  .display-button {
    display: inline-flex;
    flex-direction: row;
    align-items: center;
    gap: var(--space-1);
    width: auto;
    padding-inline: var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .display-count {
    min-width: 16px;
    padding: 0 5px;
    border-radius: 8px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    line-height: 16px;
  }

  .orden-glyph.open {
    background: var(--surface-press);
  }

  .search {
    width: 168px;
    min-height: var(--row-height-sm);
  }

  :global([data-touch]) .search {
    display: none;
  }

  :global([data-touch]) .head {
    flex-wrap: wrap;
    row-gap: var(--space-1);
  }

  :global([data-touch]) .head.tabbed {
    flex-wrap: nowrap;
  }

  :global([data-touch]) .name {
    max-width: none;
    flex: 1;
  }

  :global([data-touch]) .spring {
    display: none;
  }

  :global([data-touch]) .layouts {
    order: 1;
    flex-basis: 100%;
  }
</style>
