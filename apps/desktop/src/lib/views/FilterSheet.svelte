<script lang="ts">
  /** Todoist's Add filter, in nib's sheet: a name and a query in Todoist's own language,
   *  how many open tasks it finds as it is typed, and the field marked where the grammar
   *  cannot read it. Saving writes the filter's base (filters.ts) and opens it. */
  import Sheet from '../Sheet.svelte'
  import { amount, i18n, t } from '../i18n.svelte'
  import { rows } from '../rows/rows.svelte'
  import { folderOf } from '../space-paths'
  import { joinPath } from '../tauri'
  import { workspace } from '../workspace.svelte'
  import { todayHere } from './days'
  import { filterAsk } from './filter-sheet.svelte'
  import { counted, saveFilter } from './filters'
  import { focusSoon } from './focus-soon'
  import { openBaseFile } from './open'

  let name = $state('')
  let query = $state('')
  $effect(() => {
    const asked = filterAsk.shown
    if (!asked) return
    name = asked.name
    query = asked.query
  })

  /** The query as it stood when the typing paused: counting runs over every task of the
   *  space, which is not a thing to do on every key. */
  let settled = $state('')
  $effect(() => {
    const words = query
    const timer = setTimeout(() => (settled = words), 250)
    return () => clearTimeout(timer)
  })

  const reading = $derived({ lang: i18n.language, today: todayHere() })
  const space = $derived(workspace.activeSpace?.name)
  const found = $derived(
    filterAsk.shown && space !== undefined ? counted(settled, rows.of(space), reading) : null,
  )
  const wrong = $derived(found !== null && 'error' in found ? found.error : null)

  function close() {
    filterAsk.shown = null
  }

  async function save() {
    const asked = filterAsk.shown
    if (!asked || !name.trim() || !query.trim()) return
    // Read again as it stands: Enter may come before the count has caught up.
    if ('error' in counted(query, [], reading)) return
    close()
    let path = asked.path
    // A filter named again is its file named again, so links and favourites follow.
    if (path !== null && name.trim() !== asked.name) {
      await workspace.rename(path, `${name.trim()}.base`)
      path = joinPath(folderOf(path), `${name.trim()}.base`)
    }
    const written = await saveFilter(name, query, reading, path)
    if (written) openBaseFile(written)
  }
</script>

<Sheet
  open={filterAsk.shown !== null}
  title={filterAsk.shown?.path ? t('Edit filter') : t('Add filter')}
  onclose={close}
>
  <form
    class="card"
    onsubmit={(event) => {
      event.preventDefault()
      void save()
    }}
  >
    <label class="row">
      <span class="name">{t('Name')}</span>
      <input class="nib-field" bind:value={name} use:focusSoon />
    </label>
    <label class="row">
      <span class="name">{t('Filter')}</span>
      <input
        class="nib-field query"
        class:is-wrong={wrong !== null}
        bind:value={query}
        title={wrong ?? ''}
        aria-invalid={wrong !== null}
        spellcheck="false"
      />
      {#if found && 'count' in found}
        <span class="count" title={t('Tasks')}>{amount(found.count)}</span>
      {/if}
    </label>
    <div class="answers">
      <button class="nib-button is-quiet" type="button" onclick={close}>{t('Cancel')}</button>
      <button
        class="nib-button"
        type="submit"
        disabled={wrong !== null || !name.trim() || !query.trim()}>{t('Save')}</button
      >
    </div>
  </form>
</Sheet>

<style>
  .row input {
    flex: 1;
    min-width: 0;
  }

  .query {
    font-family: var(--font-mono);
  }

  .is-wrong {
    box-shadow: inset 0 0 0 1px var(--danger);
  }

  .count {
    flex: none;
    min-width: 2ch;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    text-align: end;
  }

  .answers {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-3) 0 var(--space-1);
  }
</style>
