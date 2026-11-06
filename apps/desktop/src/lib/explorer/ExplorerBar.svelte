<script lang="ts">
  import ArrowLeft from 'lucide/dist/esm/icons/arrow-left.mjs'
  import ArrowRight from 'lucide/dist/esm/icons/arrow-right.mjs'
  import ArrowUp from 'lucide/dist/esm/icons/arrow-up.mjs'
  import Eye from 'lucide/dist/esm/icons/eye.mjs'
  import PanelLeft from 'lucide/dist/esm/icons/panel-left.mjs'
  import type { IconNode } from 'lucide'
  import { tick } from 'svelte'
  import { t } from '../i18n.svelte'
  import { shortcuts } from '../shortcuts.svelte'
  import { crumbsOf, typedFolder } from './crumbs'
  import { places } from './places.svelte'
  import { explorerPrefs } from './prefs.svelte'
  import type { ExplorerView } from './view.svelte'

  /* eslint-disable prefer-const -- `typing` is bound, so the three are one `let` */
  let {
    view,
    typing = $bindable(false),
    onleave,
  }: { view: ExplorerView; typing?: boolean; onleave: () => void } = $props()
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
