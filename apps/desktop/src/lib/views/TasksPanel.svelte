<script lang="ts">
  import { answer, readBase, type Row } from '@orden/bases'
  import { untrack } from 'svelte'
  import { t } from '../i18n.svelte'
  import { links } from '../link-index.svelte'
  import { DIVIDER, menu } from '../menu.svelte'
  import { rows } from '../rows/rows.svelte'
  import { insideSpace } from '../space-paths'
  import { invoke } from '../tauri'
  import { workspace } from '../workspace.svelte'
  import { addTyped, openQuickAdd } from './add'
  import { contextFor } from './context'
  import { day } from './day.svelte'
  import { kitFor } from './kit'
  import ListLayout from './ListLayout.svelte'
  import { LiveView } from './live.svelte'
  import { ADD_MARK, LABEL_MARK, PROJECT_MARK, TODAY_MARK, VIEW_MARK } from './marks'
  import { openByPath, panelCounts } from './panel'
  import { choose, chosenIn, openInTab, type PanelRow, sameRow, specOf } from './panel-press'
  import { fileSource, panelSource } from './source'
  import { refusedAsTag } from '../tag-actions'
  import { guardedAt } from './guard'
  import { prompt } from '../prompt.svelte'
  import { canWriteAt } from '../sharing.svelte'
  import { homeRoot } from '../rows/home.svelte'
  import { builtinName } from './words'

  const { side = 'left' }: { side?: 'left' | 'right' } = $props()

  let all = $state.raw<readonly Row[]>(untrack(() => rows.shown()))
  const today = $derived(day.today)
  $effect(() =>
    untrack(() =>
      rows.settled(() => {
        all = rows.shown()
        day.again()
      }),
    ),
  )
  $effect(() => {
    const next = rows.shown()
    untrack(() => (all = next))
  })
  const counts = $derived(panelCounts(all, today, workspace.activeSpace?.name))

  const space = $derived(workspace.activeSpace)
  const root = $derived(space?.root ?? null)
  const writes = $derived(homeRoot() !== null)
  const openIn = $derived(openByPath(counts.notes, space?.name))

  const favourites = $derived.by(() => {
    if (root === null || !space) return []
    return workspace.bookmarks.list.flatMap((mark) => {
      if (mark.kind !== 'note') return []
      const path = insideSpace(root, mark.path)
      const isBase = /\.base$/i.test(mark.path)
      const holds = openIn.has(mark.path)
      if (!isBase && !holds) return []
      return [
        {
          path,
          relative: mark.path,
          base: isBase,
          name: mark.path.replace(/^.*\//, '').replace(/\.(md|base)$/i, ''),
          count: isBase ? baseCount(path) : (openIn.get(mark.path) ?? 0),
        },
      ]
    })
  })

  let read = $state<Record<string, ReturnType<typeof readBase> | null>>({})
  $effect(() => {
    const paths = favourites.filter((one) => one.base).map((one) => one.path)
    untrack(() => {
      for (const path of paths) {
        if (path in read) continue
        void invoke<string>('read_note', { path })
          .then((text) => (read = { ...read, [path]: readBase(text) }))
          .catch(() => (read = { ...read, [path]: null }))
      }
    })
  })
  $effect(() =>
    untrack(() =>
      links.hearSaves((path, text) => {
        if (path in read) read = { ...read, [path]: readBaseOrNull(text) }
      }),
    ),
  )
  const readBaseOrNull = (text: string) => {
    try {
      return readBase(text)
    } catch {
      return null
    }
  }
  function baseCount(path: string): number | null {
    const written = read[path]
    const name = workspace.activeSpace?.name
    const base = written && guardedAt(written, path)
    if (!base || name === undefined) return null
    try {
      const mine = all.filter((one) => one.space === name)
      const said = answer(
        base,
        0,
        mine,
        contextFor({ rows: mine, today, now: `${today}T00:00:00` }),
      )
      return said.partial ? null : said.total
    } catch {
      return null
    }
  }

  const here = $derived(space ? { id: space.id, name: space.name, root: space.root } : null)
  let pressed = $state.raw<Parameters<typeof chosenIn>[0]>({ row: { kind: 'todos' }, in: null })
  const chosen = $derived(chosenIn(pressed, here))

  const labelRow = (tag: string): PanelRow =>
    space ? { kind: 'label', tag, space: space.name } : { kind: 'label', tag }

  function press(event: MouseEvent, row: PanelRow) {
    if (choose(event) === 'tab') {
      event.preventDefault()
      openInTab(row)
    } else pressed = { row, in: here }
  }

  function auxPress(event: MouseEvent, row: PanelRow) {
    if (event.button === 1) press(event, row)
  }

  function rowMenu(event: MouseEvent, row: PanelRow) {
    event.preventDefault()
    if (row.kind === 'label') {
      labelMenu(event, row.tag)
      return
    }
    menu.show(event, [{ label: t('Open in new tab'), run: () => openInTab(row) }])
  }

  let typing = $state(false)
  let words = $state('')

  function add() {
    if (!openQuickAdd()) typing = true
  }

  async function write() {
    const said = words
    if (!said.trim()) return
    words = ''
    if (!(await addTyped(said, {})) && !words) words = said
  }

  function labelMenu(event: MouseEvent, tag: string) {
    const open = { label: t('Open in new tab'), run: () => openInTab(labelRow(tag)) }
    if (root !== null && !canWriteAt(root)) {
      menu.show(event, [open])
      return
    }
    menu.show(event, [
      open,
      {
        label: t('Rename'),
        asks: true,
        run: () =>
          void prompt
            .ask({ title: t('Rename'), value: tag, confirmLabel: t('Rename') })
            .then((words) => {
              const next = words?.trim().replace(/^#+/, '')
              if (next && next !== tag && !refusedAsTag(next)) void workspace.retagNotes(tag, next)
            }),
      },
      DIVIDER,
      {
        label: t('Delete'),
        danger: true,
        asks: true,
        run: () =>
          void prompt
            .confirm({
              title: t('Delete {name}?', { name: `#${tag}` }),
              confirmLabel: t('Delete'),
              danger: true,
            })
            .then((sure) => (sure ? void workspace.retagNotes(tag, null) : undefined)),
      },
    ])
  }

  const chosenKey = $derived(JSON.stringify(chosen))
  const shown = $derived.by(() => {
    const here = JSON.parse(chosenKey) as PanelRow
    return untrack(() => {
      const spec = specOf(here)
      const file = here.kind === 'base' ? here.path : null
      const live = new LiveView(file === null ? panelSource(spec ?? {}) : fileSource(file))
      return { live, kit: kitFor(live, spec ?? {}, file, true) }
    })
  })
  $effect(() => {
    const here = shown
    return untrack(() => here.live.start())
  })
</script>

{#snippet row(mark: string, label: string, count: number | null, target: PanelRow, late = false)}
  <button
    type="button"
    class="nib-row"
    class:is-on={sameRow(chosen, target)}
    aria-pressed={sameRow(chosen, target)}
    onclick={(event) => press(event, target)}
    onauxclick={(event) => auxPress(event, target)}
    oncontextmenu={(event) => rowMenu(event, target)}
  >
    <span class="nib-row-mark"
      ><svg viewBox="0 0 13 13" aria-hidden="true"><path d={mark} /></svg></span
    >
    <span class="nib-row-label">{label}</span>
    {#if count}<span class="nib-row-meta" class:late>{count}</span>{/if}
  </button>
{/snippet}

<div class="tasks" data-side={side}>
  {#if typing}
    <div class="nib-row adding">
      <span class="nib-row-mark"
        ><svg viewBox="0 0 13 13" aria-hidden="true"><path d={ADD_MARK} /></svg></span
      >
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="field"
        bind:value={words}
        autofocus
        aria-label={t('Add task')}
        placeholder={t('Add task')}
        onkeydown={(event) => {
          if (event.isComposing) return
          if (event.key === 'Enter') {
            event.preventDefault()
            void write()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            typing = false
            words = ''
          }
        }}
        onblur={() => {
          if (!words.trim()) typing = false
        }}
      />
    </div>
  {:else if writes}
    <button type="button" class="nib-row adder" onclick={add}>
      <span class="nib-row-mark"
        ><svg viewBox="0 0 13 13" aria-hidden="true"><path d={ADD_MARK} /></svg></span
      >
      <span class="nib-row-label">{t('Add task')}</span>
    </button>
  {/if}

  {@render row(TODAY_MARK, builtinName('todos'), counts.todos, { kind: 'todos' }, counts.overdue)}

  {#if favourites.length}
    <p class="nib-section">{t('Favorites')}</p>
    {#each favourites as one (one.path)}
      {#if one.base}
        {@render row(VIEW_MARK, one.name, one.count, { kind: 'base', path: one.path })}
      {:else if space}
        {@render row(PROJECT_MARK, one.name, one.count, {
          kind: 'project',
          space: space.name,
          path: one.relative,
        })}
      {/if}
    {/each}
  {/if}

  {#if counts.labels.length}
    <p class="nib-section">{t('Labels')}</p>
    {#each counts.labels as one (one.tag)}
      {@render row(LABEL_MARK, one.tag, one.count, labelRow(one.tag))}
    {/each}
  {/if}

  <div class="chosen">
    {#key shown}<ListLayout kit={shown.kit} />{/key}
  </div>
</div>

<style>
  .tasks {
    display: flex;
    flex-direction: column;
  }

  .chosen {
    margin-top: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--line);
  }

  .nib-row-mark svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .late {
    color: var(--danger);
  }

  .adder {
    color: var(--muted);
  }

  .adding {
    padding-inline-start: var(--row-pad);
  }

  .field {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    color: var(--text-strong);
    font: inherit;
  }

  .field::placeholder {
    color: var(--muted);
  }
</style>
