<script lang="ts">
  import ArrowLeft from 'lucide/dist/esm/icons/arrow-left.mjs'
  import ArrowRight from 'lucide/dist/esm/icons/arrow-right.mjs'
  import ArrowUp from 'lucide/dist/esm/icons/arrow-up.mjs'
  import Eye from 'lucide/dist/esm/icons/eye.mjs'
  import PanelLeft from 'lucide/dist/esm/icons/panel-left.mjs'
  import PanelRight from 'lucide/dist/esm/icons/panel-right.mjs'
  import Search from 'lucide/dist/esm/icons/search.mjs'
  import List from 'lucide/dist/esm/icons/list.mjs'
  import LayoutGrid from 'lucide/dist/esm/icons/layout-grid.mjs'
  import Columns from 'lucide/dist/esm/icons/columns-3.mjs'
  import type { IconNode } from 'lucide'
  import { tick } from 'svelte'
  import { t } from '../i18n.svelte'
  import { shortcuts } from '../shortcuts.svelte'
  import { crumbsOf, typedFolder } from './crumbs'
  import { dropInto, over } from './drag'
  import { places } from './places.svelte'
  import { explorerPrefs } from './prefs.svelte'
  import type { ExplorerView } from './view.svelte'

  /* eslint-disable prefer-const -- `typing` is bound, so the three are one `let` */
  let {
    view,
    typing = $bindable(false),
    filtering = $bindable(false),
    onleave,
  }: {
    view: ExplorerView
    typing?: boolean
    filtering?: boolean
    onleave: () => void
  } = $props()
  /* eslint-enable prefer-const */

  const crumbs = $derived(view.folder ? crumbsOf(view.folder) : [])
  let field = $state<HTMLInputElement>()
  let typed = $state('')

  $effect(() => {
    if (!typing) return
    typed = view.folder ?? ''
    void tick().then(() => {
      field?.focus()
      field?.select()
    })
  })

  async function go() {
    const home = places.list.find((one) => one.kind === 'home')?.path ?? null
    const folder = typedFolder(typed, view.folder ?? '', home)
    typing = false
    onleave()
    if (folder) await view.go(folder)
  }

  let filterField = $state<HTMLInputElement>()

  $effect(() => {
    if (filtering) void tick().then(() => filterField?.focus())
  })

  function filterKey(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault()
      view.searchBelow(view.filter)
      onleave()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      view.filter = ''
      view.endSearch()
      filtering = false
      onleave()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      onleave()
    }
  }

  function onkey(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault()
      void go()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      typing = false
      onleave()
    }
  }
</script>

{#snippet glyph(mark: IconNode, mirrored = false)}
  <svg class:nib-mirror={mirrored} viewBox="0 0 24 24" aria-hidden="true">
    {#each mark as [tag, attrs], index (index)}
      <svelte:element this={tag} {...attrs} />
    {/each}
  </svg>
{/snippet}

<div class="bar">
  <button
    class="nib-glyph"
    title={shortcuts.tooltip(t('Back'), 'app.back')}
    aria-label={t('Back')}
    disabled={!view.canGoBack}
    onclick={() => view.back()}>{@render glyph(ArrowLeft, true)}</button
  >
  <button
    class="nib-glyph"
    title={shortcuts.tooltip(t('Forward'), 'app.forward')}
    aria-label={t('Forward')}
    disabled={!view.canGoForward}
    onclick={() => view.forward()}>{@render glyph(ArrowRight, true)}</button
  >
  <button
    class="nib-glyph"
    title={shortcuts.tooltip(t('Folder above'), 'explorer.parent')}
    aria-label={t('Folder above')}
    disabled={!view.canGoUp}
    onclick={() => view.up()}>{@render glyph(ArrowUp)}</button
  >

  {#if typing}
    <input
      bind:this={field}
      bind:value={typed}
      class="nib-field path"
      aria-label={t('Path')}
      spellcheck="false"
      autocomplete="off"
      onkeydown={onkey}
      onblur={() => (typing = false)}
    />
  {:else}
    <nav class="crumbs" aria-label={t('Path')}>
      {#each crumbs as crumb, index (crumb.path)}
        {#if index > 0}<span class="step" aria-hidden="true">›</span>{/if}
        <button
          class="crumb"
          class:is-here={index === crumbs.length - 1}
          ondragover={(event) => over(event)}
          ondrop={(event) => dropInto(view, event, crumb.path)}
          aria-current={index === crumbs.length - 1 ? 'location' : undefined}
          onclick={() => view.go(crumb.path)}>{crumb.name}</button
        >
      {/each}
      <button
        class="past"
        tabindex="-1"
        title={shortcuts.tooltip(t('Type a location'), 'explorer.location')}
        aria-label={t('Type a location')}
        onclick={() => (typing = true)}
      ></button>
    </nav>
  {/if}

  {#if filtering || view.filter || view.search}
    <input
      bind:this={filterField}
      bind:value={view.filter}
      class="nib-field filter"
      aria-label={t('Filter')}
      placeholder={t('Filter')}
      spellcheck="false"
      autocomplete="off"
      onkeydown={filterKey}
    />
  {/if}
  <button
    class="nib-glyph"
    class:is-on={filtering || !!view.filter || !!view.search}
    title={shortcuts.tooltip(t('Filter'), 'explorer.filter')}
    aria-label={t('Filter')}
    onclick={() => (filtering = !filtering)}>{@render glyph(Search)}</button
  >
  <button
    class="nib-glyph"
    class:is-on={explorerPrefs.view === 'list'}
    title={shortcuts.tooltip(t('List'), 'explorer.list')}
    aria-label={t('List')}
    aria-pressed={explorerPrefs.view === 'list'}
    onclick={() => explorerPrefs.show('list')}>{@render glyph(List)}</button
  >
  <button
    class="nib-glyph"
    class:is-on={explorerPrefs.view === 'grid'}
    title={shortcuts.tooltip(t('Grid'), 'explorer.grid')}
    aria-label={t('Grid')}
    aria-pressed={explorerPrefs.view === 'grid'}
    onclick={() => explorerPrefs.show('grid')}>{@render glyph(LayoutGrid)}</button
  >
  <button
    class="nib-glyph"
    class:is-on={explorerPrefs.view === 'columns'}
    title={shortcuts.tooltip(t('Columns'), 'explorer.columns')}
    aria-label={t('Columns')}
    aria-pressed={explorerPrefs.view === 'columns'}
    onclick={() => explorerPrefs.show('columns')}>{@render glyph(Columns)}</button
  >
  <button
    class="nib-glyph"
    class:is-on={explorerPrefs.hidden}
    title={shortcuts.tooltip(t('Hidden files'), 'explorer.hidden')}
    aria-label={t('Hidden files')}
    aria-pressed={explorerPrefs.hidden}
    onclick={() => explorerPrefs.toggleHidden()}>{@render glyph(Eye)}</button
  >
  <button
    class="nib-glyph"
    class:is-on={explorerPrefs.places}
    title={t('Places')}
    aria-label={t('Places')}
    aria-pressed={explorerPrefs.places}
    onclick={() => explorerPrefs.togglePlaces()}>{@render glyph(PanelLeft)}</button
  >
  <button
    class="nib-glyph"
    class:is-on={explorerPrefs.preview}
    title={shortcuts.tooltip(t('Preview'), 'explorer.preview')}
    aria-label={t('Preview')}
    aria-pressed={explorerPrefs.preview}
    onclick={() => explorerPrefs.togglePreview()}>{@render glyph(PanelRight)}</button
  >
</div>

<style>
  .bar {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--line);
  }

  .crumbs,
  .path {
    flex: 1;
    min-width: 0;
  }

  .filter {
    flex: 0 1 12rem;
    min-width: 6rem;
  }

  .crumbs {
    display: flex;
    align-items: center;
    height: var(--row-height);
    overflow: hidden;
    direction: ltr;
  }

  .crumb {
    flex: none;
    max-width: 16rem;
    padding: 0 var(--space-2);
    height: 100%;
    overflow: hidden;
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted-strong);
    font: inherit;
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
    unicode-bidi: isolate;
  }

  @media (hover: hover) {
    .crumb:hover {
      background: var(--surface-hover);
      color: var(--text-strong);
    }
  }

  .crumb:active {
    background: var(--surface-press);
  }

  .crumb.is-here {
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }

  .step {
    flex: none;
    color: var(--faint);
  }

  .past {
    flex: 1;
    align-self: stretch;
    min-width: var(--space-6);
    border: none;
    background: none;
    cursor: text;
  }
</style>
