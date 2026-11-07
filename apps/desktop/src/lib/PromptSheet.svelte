<script lang="ts">
  import { untrack } from 'svelte'
  import { closeOnBack } from './backstack.svelte'
  import { overlays } from './overlays'
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import FileMark from './FileMark.svelte'
  import { rank } from './fuzzy'
  import { offsetOf, type Rows, windowFor } from './row-window'
  import { ListView, measuredRow } from './row-window.svelte'
  import { t } from './i18n.svelte'
  import { prompt } from './prompt.svelte'
  import { selectAll } from './select-all'
  import SpaceMark from './SpaceMark.svelte'
  import TickBox from './TickBox.svelte'
  import { LAYER } from './motion'
  import { trap } from './trap'
  import { isDesktop, platform } from './tauri'

  $effect(() => closeOnBack(prompt.open, () => prompt.dismiss()))

  const MOST_SHOWN = 8
  const OVERSCAN = 6
  const LEAST = 32

  let cursor = $state(0)

  const matches = $derived(
    prompt.mode === 'find'
      ? rank(prompt.value.trim(), prompt.options, (option) => option.label)
      : [],
  )

  let list = $state<HTMLUListElement>()
  const where = new ListView()
  const rows = $derived<Rows>({
    count: matches.length,
    height: where.row || LEAST,
    top: where.top,
    room: where.room,
    overscan: OVERSCAN,
    pinned: [cursor],
  })
  const view = $derived(windowFor(rows))
  const drawn = $derived.by(() => {
    const out: { at: number; option: (typeof matches)[number]; away: boolean }[] = []
    const add = (at: number, away: boolean) => {
      const option = matches[at]
      if (option) out.push({ at, option, away })
    }
    for (const at of view.pinned) if (at < view.first) add(at, true)
    for (let at = view.first; at <= view.last; at++) add(at, false)
    for (const at of view.pinned) if (at > view.last) add(at, true)
    return out
  })

  $effect(() => {
    const ul = list
    if (!ul) return
    return where.follow(ul, (one) => measuredRow(one, LEAST))
  })

  function reach(index: number) {
    const box = where.box
    if (!box) return
    const height = where.row || LEAST
    const top = offsetOf(index, rows) + (box.scrollTop - where.top)
    if (top < box.scrollTop) box.scrollTop = top
    else if (top + height > box.scrollTop + box.clientHeight)
      box.scrollTop = top + height - box.clientHeight
    where.refresh()
  }

  const follows = (_value: unknown) => undefined

  $effect(() => {
    follows(matches)
    cursor = 0
    untrack(() => {
      if (where.box) where.box.scrollTop = 0
    })
  })

  $effect(() => (prompt.open ? overlays.show(() => prompt.dismiss()) : undefined))

  function onFindKey(event: KeyboardEvent) {
    const count = Math.max(matches.length, 1)
    const page = Math.max(1, MOST_SHOWN - 1)
    const moves: Record<string, number> = {
      ArrowDown: (cursor + 1) % count,
      ArrowUp: (cursor - 1 + count) % count,
      PageDown: Math.min(cursor + page, count - 1),
      PageUp: Math.max(cursor - page, 0),
    }
    const to = moves[event.key]
    if (to === undefined) return
    event.preventDefault()
    cursor = to
    reach(to)
  }

  const mac = isDesktop && platform() === 'macos'
  const answers = $derived(
    mac
      ? [
          ...prompt.options.filter((one) => !one.primary),
          ...prompt.options.filter((one) => one.primary),
        ]
      : prompt.options,
  )

  function submitFind() {
    const chosen = matches[cursor]
    if (chosen) prompt.pick(chosen.id)
  }
</script>

{#if prompt.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="nib-scrim scrim"
    transition:fade={{ duration: LAYER.fade }}
    onclick={() => prompt.dismiss()}
  ></div>

  <div
    class="nib-screen sheet"
    use:trap
    role="dialog"
    aria-modal="true"
    aria-label={prompt.title}
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    <form
      onsubmit={(event) => {
        event.preventDefault()
        if (prompt.mode === 'find') submitFind()
        else prompt.submit()
      }}
    >
      <p class="title">{prompt.title}</p>

      {#if prompt.mode === 'text'}
        <input
          bind:value={prompt.value}
          placeholder={prompt.placeholder}
          spellcheck="false"
          use:selectAll
        />
      {:else if prompt.mode === 'find'}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          bind:value={prompt.value}
          placeholder={prompt.placeholder}
          spellcheck="false"
          onkeydown={onFindKey}
          autofocus
        />

        {#if matches.length}
          <div class="found-box" style:max-height="{MOST_SHOWN * (where.row || LEAST)}px">
            <ul class="found" bind:this={list}>
              <li class="gap" style:height="{view.above}px" aria-hidden="true"></li>
              {#each drawn as { at: index, option, away } (option.id)}
                <li
                  data-row={index}
                  class:away
                  style:top={away ? `${offsetOf(index, rows)}px` : undefined}
                >
                  <button
                    type="button"
                    class="found-row"
                    class:at={index === cursor}
                    onmouseenter={() => (cursor = index)}
                    onclick={() => prompt.pick(option.id)}
                  >
                    {#if option.space}
                      <span class="space"><SpaceMark {...option.space} /></span>
                    {:else if option.picture}
                      <img
                        class="picture"
                        src={option.picture}
                        alt=""
                        draggable="false"
                        decoding="async"
                      />
                    {:else if option.mark}
                      <FileMark mark={option.mark} path={option.id} />
                    {/if}
                    <span class="found-label">{option.label}</span>
                  </button>
                </li>
              {/each}
              <li class="gap" style:height="{view.below}px" aria-hidden="true"></li>
            </ul>
          </div>
        {:else}
          <p class="detail">{t('Nothing found')}</p>
        {/if}
      {:else if prompt.detail}
        <p class="detail">{prompt.detail}</p>
      {/if}

      <div class="row">
        {#if prompt.mode === 'choose'}
          {#if prompt.tick}
            <TickBox
              label={prompt.tick}
              checked={prompt.ticked}
              onchange={(on: boolean) => (prompt.ticked = on)}
            />
          {/if}
          {#each answers as option (option.id)}
            <button
              type="button"
              class="nib-button"
              class:is-danger={option.danger}
              class:is-quiet={!option.primary && !option.danger}
              data-lands={option.lands || (prompt.tick && option.primary) ? '' : undefined}
              onclick={() => prompt.pick(option.id)}
            >
              {t(option.label)}
            </button>
          {/each}
        {:else if prompt.mode === 'find'}
          <button type="button" class="nib-button is-quiet" onclick={() => prompt.dismiss()}
            >{t('Cancel')}</button
          >
        {:else}
          <button type="button" class="nib-button is-quiet" onclick={() => prompt.dismiss()}
            >{t('Cancel')}</button
          >
          <button
            type="submit"
            class="nib-button"
            class:is-danger={prompt.danger}
            disabled={prompt.mode === 'text' && !prompt.value.trim()}
            data-lands={prompt.mode === 'confirm' && prompt.lands ? '' : undefined}
          >
            {t(prompt.confirmLabel)}
          </button>
        {/if}
      </div>
    </form>
  </div>
{/if}

<style>
  .sheet {
    --screen-width: var(--screen-ask);

    z-index: var(--z-sheet);
    padding: var(--space-5);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .detail {
    margin: 0;
    font-size: var(--text-sm);
    line-height: 1.5;
    color: var(--muted-strong);
  }

  .found-box {
    margin: calc(var(--space-4) * -1 + var(--space-1)) 0 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .found {
    position: relative;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .found .away {
    position: absolute;
    left: 0;
    right: 0;
  }

  .found-row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--row-gap);
    padding: 6px 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: start;
    cursor: default;
    transition:
      background var(--dur-instant) var(--ease-out),
      color var(--dur-instant) var(--ease-out);
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

  .picture {
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
    object-fit: contain;
  }

  .found-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .found-row.at {
    background: var(--accent-soft);
    color: var(--text-strong);
  }

  input:not([type='checkbox']) {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    transition:
      border-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  :global([data-touch]) .sheet {
    top: auto;
    bottom: var(--keyboard);
    left: 0;
    translate: none;
    width: 100%;
    max-height: min(88dvh, calc(100dvh - var(--keyboard) - var(--inset-top)));
    overflow-y: auto;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    padding-bottom: var(--touch-bottom);
  }

  :global([data-touch]) input:not([type='checkbox']),
  :global([data-touch]) .title {
    font-size: var(--touch-text);
  }

  :global([data-touch]) input:not([type='checkbox']) {
    min-height: var(--touch-row);
    padding: 0 var(--touch-pad);
  }

  :global([data-touch]) .found-row {
    min-height: var(--touch-row);
    padding: 0 var(--touch-pad);
  }

  :global([data-touch]) .detail,
  :global([data-touch]) .label {
    font-size: var(--text-base);
  }
</style>
