<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import X from 'lucide/dist/esm/icons/x.mjs'
  import { i18n, t } from '../i18n.svelte'
  import { menu } from '../menu.svelte'
  import { tabAsk, type TabAsk } from '../new-tab'
  import { dayName, historyRows, hostOf, onScreen, type HistoryRow } from './history-list'
  import { siteMark } from './pages.svelte'
  import { visited } from './visited'
  import type { Visit } from './visits'

  const {
    book,
    focused,
    onopen,
    onclear,
  }: {
    book: string
    focused: boolean
    onopen: (url: string, ask: TabAsk) => void
    onclear: () => void
  } = $props()

  let all = $state.raw(visited.all(untrack(() => book)))
  let now = $state(Date.now())
  let typed = $state('')
  let scrolled = $state(0)
  let height = $state(0)
  let rowHeight = $state(28)
  let list = $state<HTMLElement>()
  let field = $state<HTMLInputElement>()

  const rows = $derived(historyRows(all, typed))
  const shown = $derived(onScreen(scrolled, height, rowHeight, rows.length))

  $effect(() => atTop(typed))

  function atTop(_search: string) {
    untrack(() => {
      if (list) list.scrollTop = 0
      scrolled = 0
    })
  }

  const CLOCK: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }

  onMount(() => {
    const stop = visited.watch((which) => {
      if (which !== book) return
      all = visited.all(book)
      now = Date.now()
    })
    if (list) {
      const said = Number.parseFloat(getComputedStyle(list).getPropertyValue('--row-height'))
      if (said > 0) rowHeight = said
    }
    if (focused) field?.focus({ preventScroll: true })
    return stop
  })

  function visitOf(row: HistoryRow): Visit | null {
    return row.kind === 'visit' ? row.visit : null
  }

  function dayAt(row: HistoryRow): number {
    return row.kind === 'day' ? row.day : 0
  }

  function titleOf(visit: Visit): string {
    return visit.title === '' ? hostOf(visit.url) : visit.title
  }

  function remove(visit: Visit) {
    visited.remove(book, visit.url)
  }

  function rowMenu(event: MouseEvent, visit: Visit) {
    event.preventDefault()
    menu.show(event, [
      { label: t('Open in new tab'), run: () => onopen(visit.url, 'behind') },
      { label: t('More from this site'), run: () => (typed = hostOf(visit.url)) },
      { label: t('Remove from history'), run: () => remove(visit) },
    ])
  }

  function rowKey(event: KeyboardEvent, visit: Visit, index: number) {
    if (event.key === 'Delete') {
      event.preventDefault()
      remove(visit)
      focusRow(index)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const step = event.key === 'ArrowDown' ? 1 : -1
    let next = index + step
    while (rows[next]?.kind === 'day') next += step
    if (next < 0) field?.focus()
    else focusRow(next)
  }

  function focusRow(index: number) {
    let at = Math.min(index, rows.length - 1)
    while (at > 0 && rows[at]?.kind === 'day') at--
    const box = list
    if (at < 0 || !box) return
    const top = at * rowHeight
    if (top < box.scrollTop) box.scrollTop = top
    else if (top + rowHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = top + rowHeight - box.clientHeight
    }
    scrolled = box.scrollTop
    requestAnimationFrame(() =>
      box.querySelector<HTMLElement>(`[data-row="${String(at)}"]`)?.focus(),
    )
  }
</script>

<div class="history">
  <div class="top">
    <input
      class="find"
      type="search"
      bind:this={field}
      bind:value={typed}
      placeholder={t('Search history')}
      aria-label={t('Search history')}
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      onkeydown={(event) => {
        if (event.key === 'Escape' && typed) {
          event.preventDefault()
          event.stopPropagation()
          typed = ''
        } else if (event.key === 'ArrowDown') {
          event.preventDefault()
          focusRow(1)
        }
      }}
    />
    <button class="orden-button is-quiet" onclick={onclear}>{t('Delete browsing data')}</button>
  </div>

  <div
    class="list"
    role="list"
    bind:this={list}
    bind:clientHeight={height}
    onscroll={() => {
      if (list) scrolled = list.scrollTop
    }}
  >
    {#if rows.length}
      <div class="room" style:height={`${String(rows.length * rowHeight)}px`}>
        {#each rows.slice(shown.from, shown.to) as row, offset (row.key)}
          {@const index = shown.from + offset}
          {@const visit = visitOf(row)}
          {#if visit === null}
            <p class="day" style:top={`${String(index * rowHeight)}px`}>
              {dayName(dayAt(row), now, i18n.language, {
                today: t('Today'),
                yesterday: t('Yesterday'),
              })}
            </p>
          {:else}
            {@const mark = siteMark(null, visit.url)}
            <div class="line" role="listitem" style:top={`${String(index * rowHeight)}px`}>
              <button
                class="orden-row page"
                data-row={index}
                title={visit.url}
                onclick={(event) => onopen(visit.url, tabAsk(event))}
                onauxclick={(event) => {
                  if (event.button === 1) onopen(visit.url, tabAsk(event))
                }}
                oncontextmenu={(event) => rowMenu(event, visit)}
                onkeydown={(event) => rowKey(event, visit, index)}
              >
                <span class="orden-row-meta when">{i18n.when(visit.last, CLOCK)}</span>
                <span class="orden-row-mark">
                  {#if mark}<img src={mark} alt="" draggable="false" />{/if}
                </span>
                <span class="orden-row-label" dir="auto">{titleOf(visit)}</span>
                <span class="orden-row-meta host">{hostOf(visit.url)}</span>
              </button>
              <button
                class="orden-glyph gone"
                title={t('Remove from history')}
                aria-label={t('Remove from history')}
                onclick={() => remove(visit)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {#each X as [tag, attrs], at (at)}
                    <svelte:element this={tag} {...attrs} />
                  {/each}
                </svg>
              </button>
            </div>
          {/if}
        {/each}
      </div>
    {:else if typed}
      <p class="none">{t('Nothing found')}</p>
    {/if}
  </div>
</div>

<style>
  .history {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    font-family: var(--font-ui);
  }

  .top,
  .room,
  .none {
    width: min(48rem, calc(100% - var(--space-4) * 2));
    margin-inline: auto;
  }

  .top {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-block: var(--space-4) var(--space-2);
  }

  .find {
    flex: 1;
    min-width: 0;
    padding: 7px 11px;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    outline: none;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  .find:focus {
    border-color: var(--accent);
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: var(--space-4);
  }

  .room {
    position: relative;
  }

  .day,
  .line {
    position: absolute;
    inset-inline: 0;
    height: var(--row-height);
    margin: 0;
  }

  .day {
    display: flex;
    align-items: flex-end;
    padding: 0 var(--row-pad) 2px;
    color: var(--muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    user-select: none;
    -webkit-user-select: none;
  }

  .line {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .page {
    flex: 1;
    min-width: 0;
    color: var(--text);
  }

  .when {
    width: 4.5em;
    text-align: start;
  }

  .orden-row-mark img {
    width: var(--icon-md);
    height: var(--icon-md);
    border-radius: 3px;
  }

  .host {
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .gone {
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .line:hover .gone,
  .line:focus-within .gone,
  :global([data-touch]) .gone {
    opacity: 1;
  }

  .none {
    padding: var(--space-4) var(--row-pad);
    color: var(--muted);
    font-size: var(--text-sm);
  }
</style>
