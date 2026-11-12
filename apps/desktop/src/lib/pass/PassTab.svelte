<script lang="ts">
  import { blank } from '@orden/pass/envelope'
  import ArrowLeft from 'lucide/dist/esm/icons/arrow-left.mjs'
  import KeyRound from 'lucide/dist/esm/icons/key-round.mjs'
  import { onMount, type Snippet, untrack } from 'svelte'
  import { closeOnBack } from '../backstack.svelte'
  import { dur, fade } from '../motion'
  import { reloading } from '../reloading.svelte'
  import { shortcuts } from '../shortcuts.svelte'
  import type { Tab } from '../workspace/documents.svelte'
  import AdoptSheet from './AdoptSheet.svelte'
  import { asked } from './asked.svelte'
  import ChangePassword from './ChangePassword.svelte'
  import Gate from './Gate.svelte'
  import Generator from './Generator.svelte'
  import Glyph from './Glyph.svelte'
  import HistorySheet from './HistorySheet.svelte'
  import ItemEdit from './ItemEdit.svelte'
  import ItemView from './ItemView.svelte'
  import LinkSheet from './LinkSheet.svelte'
  import LinksPage from './LinksPage.svelte'
  import Monitor from './Monitor.svelte'
  import MoveSheet from './MoveSheet.svelte'
  import PassList from './PassList.svelte'
  import PassLock from './PassLock.svelte'
  import PassSettings from './PassSettings.svelte'
  import PassSide from './PassSide.svelte'
  import RecoveryKit from './RecoveryKit.svelte'
  import Setup from './Setup.svelte'
  import ShareSheet from './ShareSheet.svelte'
  import { pass } from './store.svelte'
  import { PassUi } from './ui.svelte'
  import VaultSheet from './VaultSheet.svelte'
  import { flagName } from './flag-words'

  const {
    tab,
    focused = false,
    corner,
  }: { tab: Tab | null; focused?: boolean; corner?: Snippet<[PassUi]> } = $props()

  const ui = new PassUi(untrack(() => tab))

  let width = $state(1200)
  let recovery = $state<string | null>(null)

  const columns = $derived(width >= 900 ? 3 : width >= 600 ? 2 : 1)
  const page = $derived(ui.view.page)
  const flagged = $derived(page === 'monitor' && ui.flag !== null)
  const wide = $derived((page === 'monitor' && !flagged) || page === 'settings' || page === 'links')
  const item = $derived(ui.shownItem)

  onMount(() => {
    void pass.start()
    return reloading.holds(() => ui.editing !== null && ui.dirty)
  })

  $effect(() => {
    if (pass.state === 'locked') recovery = null
  })

  $effect(() => {
    if (pass.state !== 'open') return
    const intent = asked.intent
    if (intent === null) return
    untrack(() => {
      asked.take()
      if (intent === 'new-login') void ui.newItem(blank('login'))
      else ui.sheet = { kind: 'generator', use: null }
    })
  })

  $effect(() => {
    if (pass.state !== 'open' || !pass.conflict) return
    untrack(() => {
      ui.sheet ??= { kind: 'adopt' }
    })
  })

  $effect(() => {
    if (pass.state !== 'open') {
      untrack(() => {
        ui.editing = null
        ui.dirty = false
        ui.sheet = null
        ui.picked = null
      })
    }
  })

  function onkey(event: KeyboardEvent) {
    if (event.defaultPrevented || pass.state !== 'open' || recovery !== null) return
    if (shortcuts.pressed('pass.search', event)) {
      event.preventDefault()
      if (wide) void ui.goTo('items').then(() => ui.searchField?.focus())
      else ui.searchField?.focus()
      if (columns === 1) ui.column = 'list'
    } else if (shortcuts.pressed('pass.new-login', event)) {
      event.preventDefault()
      void ui.newItem(blank('login'))
    }
  }

  const step = $derived(wide && ui.column === 'item' ? 'list' : ui.column)
  const home = $derived(page === 'items' && ui.view.scope.kind === 'all')

  let kept = $state(0)
  $effect(() =>
    closeOnBack(kept >= 0 && columns === 1 && (step !== 'list' || !home), () => {
      if (ui.column === 'item' && !wide)
        void ui.leave().then((left) => {
          if (left) ui.column = 'list'
          else kept++
        })
      else if (flagged && ui.column !== 'side') ui.flag = null
      else if (page !== 'items') void ui.goTo('items')
      else if (step !== 'list') ui.column = 'list'
      else void ui.choose({ kind: 'all' })
    }),
  )

  const shows = $derived.by(() => {
    if (columns === 3) return { side: true, list: !wide, item: true }
    if (columns === 2)
      return { side: true, list: step !== 'item' && !wide, item: step === 'item' || wide }
    return {
      side: step === 'side',
      list: step === 'list' && !wide,
      item: step === 'item' || (wide && step === 'list'),
    }
  })
</script>

{#snippet itemColumn()}
  {#if ui.editing}
    {#key ui.editing.id ?? 'new'}
      <ItemEdit {ui} />
    {/key}
  {:else if item && page === 'items'}
    {#key item.id}
      <ItemView {ui} {item} stepped={columns < 3} />
    {/key}
  {:else if item && flagged}
    {#key item.id}
      <ItemView {ui} {item} stepped={columns < 3} />
    {/key}
  {:else}
    <div class="blank" in:fade={{ duration: dur(120) }}>
      <Glyph icon={KeyRound} />
    </div>
  {/if}
{/snippet}

{#snippet wideColumn()}
  {#if page === 'settings'}
    <PassSettings {ui} />
  {:else if page === 'links'}
    <LinksPage />
  {:else}
    <Monitor {ui} />
  {/if}
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="pass"
  bind:clientWidth={width}
  onkeydown={onkey}
  data-region="editor"
  data-columns={columns}
>
  {#if pass.state === 'locked'}
    <PassLock {focused} />
  {:else if recovery !== null}
    <RecoveryKit code={recovery} ondone={() => (recovery = null)} />
  {:else if pass.state === 'loading'}
    <div class="blank"></div>
  {:else if pass.state === 'new'}
    <Setup onmade={(code: string) => (recovery = code)} />
  {:else if pass.mustChangePassword}
    <Gate
      icon={KeyRound}
      title="Choose a new Pass password"
      line="You opened Pass with your recovery key."
    >
      <ChangePassword ondone={() => undefined} />
    </Gate>
  {:else}
    <div class="columns">
      {#if shows.side}
        <aside class="column side">
          <PassSide {ui} {corner} />
        </aside>
      {/if}
      {#if shows.list}
        <div class="column list" class:is-flagged={flagged}>
          {#if flagged && ui.flag}
            <PassList
              {ui}
              heading={{ title: flagName(ui.flag), ids: ui.flagged, back: () => (ui.flag = null) }}
            />
          {:else}
            <PassList {ui} stepped={columns === 1} />
          {/if}
        </div>
      {/if}
      {#if shows.item}
        <main class="column item" class:is-wide={wide}>
          {#if wide && columns === 1}
            <div class="wide-column">
              <button
                class="orden-glyph"
                type="button"
                aria-label="Back"
                title="Back"
                onclick={() => (ui.column = 'side')}
              >
                <Glyph icon={ArrowLeft} />
              </button>
              <div class="wide-body">{@render wideColumn()}</div>
            </div>
          {:else if wide}
            {@render wideColumn()}
          {:else}
            {@render itemColumn()}
          {/if}
        </main>
      {/if}
    </div>
  {/if}
</div>

<Generator {ui} />
<VaultSheet {ui} />
<MoveSheet {ui} />
<HistorySheet {ui} />
<ShareSheet {ui} />
<LinkSheet {ui} />
<AdoptSheet {ui} />

<style>
  .pass {
    position: relative;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background: var(--bg);
  }

  .pass :global([data-scrolls] > *) {
    flex-shrink: 0;
  }

  :global(main:has(.fab)) .pass :global([data-scrolls]),
  :global(main:has(.fab)) .pass :global(.side .foot) {
    padding-bottom: calc(var(--space-4) + var(--touch-bottom) + var(--touch-row));
  }

  .columns {
    display: flex;
    height: 100%;
    min-height: 0;
  }

  .column {
    min-width: 0;
    height: 100%;
    overflow: hidden;
  }

  .side {
    flex: none;
    width: 236px;
    background: var(--surface);
    border-inline-end: 1px solid var(--line);
  }

  .list {
    flex: none;
    width: clamp(280px, 32%, 380px);
    border-inline-end: 1px solid var(--line);
  }

  .item {
    flex: 1;
  }

  [data-columns='2'] .list,
  [data-columns='1'] .list,
  [data-columns='1'] .side {
    flex: 1;
    width: auto;
    border-inline-end: none;
  }

  [data-columns='2'] .side {
    width: 208px;
    border-inline-end: 1px solid var(--line);
    flex: none;
  }

  .blank {
    height: 100%;
    display: grid;
    place-items: center;
    color: var(--surface-3);
  }

  .blank :global(.glyph) {
    width: 64px;
    height: 64px;
    stroke-width: 1.25;
  }

  .wide-column {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .wide-column > .orden-glyph {
    flex: none;
    margin: var(--space-2) var(--space-2) 0;
  }

  .wide-body {
    flex: 1;
    min-height: 0;
  }
</style>
