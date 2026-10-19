<script lang="ts">
  /** The head every view wears (docs/tasks.md 5.5): its name, which is a menu of the
   *  base's views and what can be done to them; the layout switch, as marks; the
   *  filter, the sort and the group, each a small layer; the view's own search; and
   *  the plus. A mark lights when what it stands for is set. Names and counts and
   *  nothing else.
   *
   *  The name's menu also holds what lane 7 added (docs/tasks.md 4): the conditional
   *  colour, a table's row height, the base's automations, the default template, the
   *  view as CSV, and the locks. A builder a menu row asks for hangs under the name
   *  (`live.builder`), whichever layout asked. A locked view shows its padlock, which
   *  shakes when a change is turned away and opens the lock when pressed. The plus's
   *  own menu makes a note from a template. */
  import { type Base, writeBase } from '@nib/bases'
  import { t } from '../i18n.svelte'
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
  import { addView, freeViewName, removeView, renameView, setBaseNib, setViewNib } from './edit'
  import FilterBuilder from './FilterBuilder.svelte'
  import type { Kit } from './kit'
  import { switched } from './layout'
  import type { Builder } from './live.svelte'
  import { ADD_MARK, DISPLAY_MARK, FILTER_MARK, GROUP_MARK, LAYOUT_MARKS, LOCK_MARK } from './marks'
  import DisplayBuilder from './DisplayBuilder.svelte'
  import { onlyOf } from './display'
  import { builtinBase } from './source'
  import { asShipped } from './spec'
  import FormulaBuilder from './FormulaBuilder.svelte'
  import NameBuilder from './NameBuilder.svelte'
  import OptionsBuilder from './OptionsBuilder.svelte'
  import RollupBuilder from './RollupBuilder.svelte'
  import { templates } from './templates'
  import Popover from './Popover.svelte'
  import { copyToBase } from './save'
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
    /** What the view is called where it has no name of its own: the tab's name. */
    title: string
    onadd: () => void
  } = $props()

  const live = $derived(kit.live)
  const view = $derived(live.view)
  const base = $derived(live.base)
  const layout = $derived(layoutOf(view?.type ?? 'table'))
  /** What the head calls the view: its own name, else the tab's. */
  const named = $derived(view?.name.trim() ? view.name : title)
  /** The layouts this place has room for: a fence and a phone leave the timeline out. */
  const offered = $derived(
    LAYOUTS.filter(
      (one) =>
        (one !== 'timeline' || (!kit.compact && viewport.device !== 'phone')) &&
        (one !== 'form' || (view?.nib.rows ?? 'notes') === 'notes'),
    ),
  )

  type Tool = 'filter' | 'sort' | 'group'
  const TOOLS = [
    { id: 'filter', mark: FILTER_MARK, label: t('Filter') },
    { id: 'sort', mark: ORDER_MARK, label: t('Sort') },
    { id: 'group', mark: GROUP_MARK, label: t('Group') },
  ] as const

  let open = $state<Tool | 'display' | 'settings' | 'chip-filter' | 'chip-sort' | null>(null)
  /** The project the view is of, whose name is its note's. */
  const project = $derived(projectOf(kit))
  /** A view of tasks has Todoist's Display: in a built-in view's head, its name, the
   *  search, Display and the plus; in a base's, beside Filter and Sort. */
  const tasky = $derived(kit.spec.builtin !== undefined || view?.nib.rows === 'tasks')
  /** A base of its own (a `.base` file, a fence, a database) wears Notion's head: its
   *  title over the view tabs, Filter, Sort, the search, ⋯ for the view's settings and
   *  New, whichever rows it is of, so Rows in its settings never takes the head away;
   *  a built-in view keeps its own. */
  const tabbed = $derived(kit.spec.builtin === undefined)
  const narrowed = $derived(view ? Object.keys(onlyOf(view)).length > 0 : false)
  const notes = $derived((view?.nib.rows ?? 'notes') === 'notes')

  /** What each builder is called, for the layer that holds it. */
  const BUILDERS: Record<Builder['kind'], string> = {
    colour: t('Colour'),
    automations: t('Automations'),
    rollup: t('Rollup'),
    button: t('Button'),
    options: t('Options'),
    formula: t('Formula'),
    name: t('Rename'),
  }

  /** A table's three heights, in lines. */
  const HEIGHTS = [
    { lines: 1, label: t('Short') },
    { lines: 2, label: t('Medium') },
    { lines: 4, label: t('Tall') },
  ]

  /** A template as a base names it: a link to its path in the space, without `.md`. */
  function linkTo(path: string): string {
    const root = workspace.activeSpace?.root ?? ''
    return `[[${relativeTo(root, path).replace(/\.md$/i, '')}]]`
  }

  /** The templates a new row can start from, as menu rows; `pick` gets a link or null. */
  async function templateRows(
    chosen: string | undefined,
    pick: (link: string | null) => void,
  ): Promise<MenuEntry[]> {
    const found = await templates()
    return [
      { label: t('Blank'), checked: chosen === undefined, run: () => pick(null) },
      ...found.map((one) => ({
        label: one.name.replace(/\.md$/i, ''),
        checked: chosen === linkTo(one.path),
        run: () => pick(linkTo(one.path)),
      })),
    ]
  }

  /** The plus's own menu: a new note, blank or from a template. */
  function plusMenu(event: MouseEvent) {
    if (!notes || !base) return
    event.preventDefault()
    void templateRows(undefined, (link) => kit.add(undefined, link)).then((items) =>
      menu.show(event, items, { title: t('New note') }),
    )
  }
  let renaming = $state(false)

  const toggle = (which: NonNullable<typeof open>) => (open = open === which ? null : which)

  /** A view nib ships, the way it came. */
  function reset() {
    open = null
    kit.change(() => builtinBase(asShipped(kit.spec)))
  }

  function pick(next: Layout) {
    kit.change((one, at) => switched(one, at, next, live.rows))
  }

  /** The base's views and what can be done to them: the name's menu's first half. */
  function viewRows(base: Base): MenuEntry[] {
    const views = base.views
    return [
      // A project's own: its note named again, a section added, the note itself.
      ...(project
        ? [
            { label: t('Rename'), run: () => (renaming = true) },
            {
              label: t('Add section'),
              asks: true,
              run: () =>
                void prompt
                  .ask({ title: t('Add section'), confirmLabel: t('Add section') })
                  .then((words) => (words?.trim() ? addSection(kit, words) : undefined)),
            },
            { label: t('Open in note'), run: () => void workspace.open(project.path) },
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
      ...(!project && (kit.spec.builtin === undefined || views.length > 1)
        ? [{ label: t('Rename'), run: () => (renaming = true) }]
        : []),
      { label: t('New view'), run: () => kit.change((one, at) => addView(one, at, 'table')) },
      { label: t('Duplicate view'), run: () => kit.change((one, at) => addView(one, at)) },
      ...(views.length > 1
        ? [
            {
              label: t('Delete view'),
              danger: true,
              run: () => kit.change((one, at) => removeView(one, at)),
            },
          ]
        : []),
      ...(kit.file === null
        ? [
            DIVIDER,
            {
              label: t('Copy to a base'),
              run: () => void copyToBase(writeBase(base), named),
            },
          ]
        : []),
    ]
  }

  /** The rest of what can be done to a view: its colour, its rows' height, the base's
   *  automations, its template, the view as CSV, the locks. In the name's menu of a
   *  built-in view and in the settings of a base's. */
  function moreRows(event?: MouseEvent): MenuEntry[] {
    if (!base) return []
    return [
      {
        label: t('Colour'),
        checked: view?.nib.colour !== undefined,
        run: () => (live.builder = { kind: 'colour' }),
      },
      ...(layout === 'table'
        ? [
            grouped(event, t('Row height'), () =>
              Promise.resolve(
                HEIGHTS.map((one) => ({
                  label: one.label,
                  checked: (view?.nib.lines ?? 1) === one.lines,
                  run: () =>
                    kit.change((b, at) =>
                      setViewNib(b, at, 'lines', one.lines === 1 ? undefined : one.lines),
                    ),
                })),
              ),
            ),
          ]
        : []),
      ...(kit.file !== null
        ? [
            {
              label: t('Automations'),
              checked: Array.isArray(base.nib.kept.automations),
              run: () => (live.builder = { kind: 'automations' }),
            },
          ]
        : []),
      ...(notes
        ? [
            grouped(event, t('Default template'), () =>
              templateRows(view?.nib.template ?? base.nib.template, (link) =>
                kit.change((b, at) => setViewNib(b, at, 'template', link ?? undefined)),
              ),
            ),
          ]
        : []),
      DIVIDER,
      { label: t('Copy as CSV'), run: () => void copyCsv(live) },
      { label: t('Save as CSV'), run: () => void saveCsv(live, named) },
      DIVIDER,
      {
        label: view?.nib.locked ? t('Unlock view') : t('Lock view'),
        run: () =>
          kit.change(
            (b, at) => setViewNib(b, at, 'locked', view?.nib.locked ? undefined : true),
            true,
          ),
      },
      ...(kit.file !== null
        ? [
            {
              label: base.nib.locked ? t('Unlock base') : t('Lock base'),
              run: () =>
                kit.change(
                  (b) => setBaseNib(b, 'locked', base.nib.locked ? undefined : true),
                  true,
                ),
            },
          ]
        : []),
    ]
  }

  function nameMenu(event: MouseEvent) {
    if (!base) return
    menu.show(event, [...viewRows(base), DIVIDER, ...moreRows(event)], { title: named })
  }

  /** The tab being named again, by its index. */
  let naming = $state<number | null>(null)

  /** A view picked from the '+': one more, of that layout, after the last, shown. */
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
                    nib: { kept: {} },
                    options: {},
                  },
                ],
              }
              return switched(fresh, last + 1, one, live.rows)
            }, last + 1)
            .catch(() => undefined),
      })),
      { title: t('New view') },
    )
  }

  /** A tab's own menu: name it, duplicate it, link to it, delete it. */
  function tabMenu(event: MouseEvent, at: number) {
    if (!base) return
    event.preventDefault()
    const one = base.views[at]
    const file = kit.file
    menu.show(
      event,
      [
        { label: t('Rename'), run: () => (naming = at) },
        {
          label: t('Duplicate view'),
          run: () => void kit.changed((b) => addView(b, at), at + 1).catch(() => undefined),
        },
        ...(file !== null && one?.name
          ? [
              {
                label: t('Copy link'),
                run: () => {
                  const root = workspace.activeSpace?.root ?? ''
                  void copyText(`![[${relativeTo(root, file)}#${one.name}]]`)
                },
              },
            ]
          : []),
        ...(base.views.length > 1
          ? [
              DIVIDER,
              {
                label: t('Delete view'),
                danger: true,
                run: () => {
                  // The view showing stays the one showing, unless it is the one going.
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

  /** The sorts set, as the chip under the tabs reads them. */
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
        class="nib-glyph lock"
        class:shake={live.refused > 0}
        title={t('Unlock view')}
        aria-label={t('Unlock view')}
        onclick={() =>
          kit.change(
            (b, at) => setBaseNib(setViewNib(b, at, 'locked', undefined), 'locked', undefined),
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
    <label class="nib-field search">
      <svg class="nib-field-mark" viewBox="0 0 13 13" aria-hidden="true"
        ><path d="M5.5 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM8.6 8.6l3 3" /></svg
      >
      <input
        type="search"
        value={live.typed}
        aria-label={t('Search')}
        placeholder={t('Search')}
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
        class="nib-glyph"
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
      class="nib-glyph"
      class:set={narrowed}
      class:open={open === 'display'}
      data-opens-popover
      title={t('Display')}
      aria-label={t('Display')}
      aria-expanded={open === 'display'}
      onclick={() => toggle('display')}
    >
      <svg viewBox="0 0 13 13"><path d={DISPLAY_MARK} /></svg>
    </button>
    <Popover open={open === 'display'} label={t('Display')} onclose={() => (open = null)}>
      <DisplayBuilder {kit} onreset={kit.spec.builtin !== undefined ? reset : undefined} />
    </Popover>
  </div>
{/snippet}
{#snippet plusButton()}
  <button
    type="button"
    class="nib-glyph"
    title={notes ? t('New note') : t('Add task')}
    aria-label={notes ? t('New note') : t('Add task')}
    onclick={onadd}
    oncontextmenu={plusMenu}
  >
    <svg viewBox="0 0 13 13"><path d={ADD_MARK} /></svg>
  </button>
{/snippet}

{#snippet chip(which: 'chip-filter' | 'chip-sort', label: string, tool: Tool)}
  <div class="tool">
    <button
      type="button"
      class="nib-chip is-on"
      data-opens-popover
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
      <div class="tabs" role="tablist" aria-label={t('Views')}>
        {#each base?.views ?? [] as one, at (at)}
          {#if naming === at}
            <input
              class="nib-field rename"
              value={one.name}
              aria-label={t('Rename')}
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
              ondblclick={() => (naming = at)}
              oncontextmenu={(event) => tabMenu(event, at)}
            >
              <svg viewBox="0 0 13 13" aria-hidden="true"
                ><path d={LAYOUT_MARKS[layoutOf(one.type)]} /></svg
              >
              <span class="words">{one.name || title}</span>
            </button>
          {/if}
        {/each}
        <button
          type="button"
          class="nib-glyph"
          title={t('New view')}
          aria-label={t('New view')}
          onclick={addTab}
        >
          <svg viewBox="0 0 13 13" aria-hidden="true"><path d={ADD_MARK} /></svg>
        </button>
      </div>
      {@render lock()}
      <span class="spring"></span>
      {@render tools(['filter', 'sort'])}
      <!-- A base of tasks keeps what Todoist's Display narrows a view of tasks by. -->
      {#if tasky}{@render display()}{/if}
      {@render searchField()}
      <div class="tool">
        <button
          type="button"
          class="nib-glyph"
          class:open={open === 'settings'}
          data-opens-popover
          title={t('Settings')}
          aria-label={t('Settings')}
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
        <Popover open={open === 'settings'} label={t('Settings')} onclose={() => (open = null)}>
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
      </div>
      <div class="tool">{@render layer(false)}</div>
      {#if !kit.compact || notes}{@render plusButton()}{/if}
    </div>
    {#if active.filter || active.sort}
      <div class="chips">
        {#if active.sort}{@render chip('chip-sort', sortWords, 'sort')}{/if}
        {#if active.filter}{@render chip('chip-filter', t('Filter'), 'filter')}{/if}
      </div>
    {/if}
  </div>
{:else}
  <div class="head" class:compact={kit.compact}>
    {#if renaming}
      <input
        class="nib-field rename"
        value={project ? named : (view?.name ?? '')}
        aria-label={t('Rename')}
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

    {#if !tasky}
      <div class="nib-segmented layouts" role="tablist" aria-label={t('Layout')} use:segmented>
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

    {#if !tasky}{@render tools(['filter', 'sort', 'group'])}{/if}

    {@render searchField()}

    {#if tasky}{@render display()}{/if}

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

  .chips .nib-chip {
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

  .nib-glyph.set {
    color: var(--accent);
  }

  .nib-glyph.open {
    background: var(--surface-press);
  }

  .search {
    width: 168px;
    min-height: var(--row-height-sm);
  }

  :global([data-touch]) .search {
    display: none;
  }

  /* A phone has no width for one row of it: the name and the tools on the first line,
     the layout switch under them, the whole width. */
  :global([data-touch]) .head {
    flex-wrap: wrap;
    row-gap: var(--space-1);
  }

  /* Notion's head stays a column: a wrapped column sizes to its content and would push
     the tools past the edge. The tabs scroll instead. */
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
