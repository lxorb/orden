<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import FileMark from '../FileMark.svelte'
  import { rank } from '../fuzzy'
  import { t } from '../i18n.svelte'
  import { LAYER, scale } from '../motion'
  import { overlays } from '../overlays'
  import { selectAll } from '../select-all'
  import { canWriteAt } from '../sharing.svelte'
  import SpaceMark from '../SpaceMark.svelte'
  import { trap } from '../trap'
  import { pages } from '../web-tab/pages.svelte'
  import { type Tab, workspace } from '../workspace.svelte'
  import { offeredName } from '../workspace/drafts'
  import { isAgentsName } from '../note-name'
  import { joinPath } from '../tauri'
  import { fileFor, placesFor, startingPlace } from './places'

  const {
    tab,
    anchor,
    onclose,
    onsaved,
  }: { tab: Tab; anchor: DOMRect | null; onclose: () => void; onsaved?: (() => void) | undefined } =
    $props()

  const MOST_SHOWN = 8
  const WIDTH = 288
  const GAP = 6
  const EDGE = 8

  // svelte-ignore state_referenced_locally
  const title = tab.kind === 'web' ? pages.of(tab.id).title : undefined
  // svelte-ignore state_referenced_locally
  let name = $state(offeredName(tab.note, title))

  const places = placesFor(
    workspace.tree,
    workspace.shownSpaces,
    workspace.activeSpace?.root ?? null,
    canWriteAt,
  )
  const home = workspace.spaces.find((one) => one.id === workspace.spaceOf(tab.note))?.root
  let place = $state(startingPlace(places, home ?? null))

  let named = $state<HTMLInputElement>()

  let choosing = $state(false)
  let query = $state('')
  let cursor = $state(0)
  const matches = $derived(
    choosing ? rank(query.trim(), places, (one) => one.label).slice(0, MOST_SHOWN) : [],
  )

  const at = $derived.by(() => {
    const left = anchor ? anchor.left : (innerWidth - WIDTH) / 2
    return {
      top: anchor ? anchor.bottom + GAP : 64,
      left: Math.max(EDGE, Math.min(left, innerWidth - WIDTH - EDGE)),
    }
  })

  let bubble = $state<HTMLElement>()
  onMount(() => overlays.show(onclose, () => [bubble]))

  function pick(index = cursor) {
    const chosen = matches[index]
    if (!chosen) return

    place = chosen
    choosing = false
    query = ''
    void tick().then(() => named?.focus())
  }

  function onListKey(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      cursor = (cursor + step + matches.length) % Math.max(matches.length, 1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      pick()
    }
  }

  function save(event: SubmitEvent) {
    event.preventDefault()
    const folder = place?.id
    const file = fileFor(name, tab.note, title)
    if (folder && isAgentsName(file)) {
      const root = workspace.rootHolding(joinPath(folder, file))
      if (root !== null)
        void import('../reserved-name.svelte').then((one) => one.reservedName.tell(root))
      return
    }
    onclose()
    void workspace.save(tab, folder, file).then((path) => {
      if (path !== null) onsaved?.()
    })
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="orden-scrim is-clear scrim" onclick={onclose}></div>

<div
  bind:this={bubble}
  class="orden-layer bubble"
  role="dialog"
  aria-label={t('Save')}
  style:top="{at.top}px"
  style:left="{at.left}px"
  style:width="{WIDTH}px"
  use:trap
  transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
>
  <form onsubmit={save}>
    <input
      class="orden-field"
      bind:this={named}
      bind:value={name}
      aria-label={t('Name')}
      spellcheck="false"
      use:selectAll
    />

    {#if choosing}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="orden-field"
        bind:value={query}
        aria-label={t('Save to')}
        spellcheck="false"
        onkeydown={onListKey}
        oninput={() => (cursor = 0)}
        autofocus
      />
      <ul class="found">
        {#each matches as option, index (option.id)}
          <li>
            <button
              type="button"
              class="orden-row is-short"
              class:is-on={index === cursor}
              onmouseenter={() => (cursor = index)}
              onclick={() => pick(index)}
            >
              {#if option.space}
                <span class="space"><SpaceMark {...option.space} /></span>
              {:else if option.mark}
                <FileMark mark={option.mark} path={option.id} />
              {/if}
              <span class="orden-row-label">{option.label}</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else if place}
      <button
        type="button"
        class="orden-field where"
        aria-label={t('Save to')}
        onclick={() => (choosing = true)}
      >
        {#if place.space}
          <span class="space"><SpaceMark {...place.space} /></span>
        {:else if place.mark}
          <FileMark mark={place.mark} path={place.id} />
        {/if}
        <span class="orden-row-label">{place.label}</span>
        <svg class="chevron" viewBox="0 0 12 12" aria-hidden="true"
          ><path d="M3 4.5 6 7.5 9 4.5" /></svg
        >
      </button>
    {/if}

    <div class="row">
      <button type="submit" class="orden-button">{t('Save')}</button>
    </div>
  </form>
</div>

<style>
  .scrim {
    --scrim-z: var(--z-menu);
  }

  .bubble {
    position: fixed;
    z-index: var(--z-menu);
    padding: var(--space-3);
    transform-origin: top left;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .where {
    gap: var(--row-gap);
  }

  .chevron {
    width: 12px;
    height: 12px;
    flex: none;
    margin-inline-start: auto;
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .found {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .space {
    display: grid;
    place-items: center;
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    color: var(--muted);
  }

  .row {
    display: flex;
    justify-content: flex-end;
  }
</style>
