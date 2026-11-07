<script lang="ts" module>
  const PIN = 'M5 1.8h3l-.4 3.1 1.9 1.8v.9H3.5v-.9l1.9-1.8zM6.5 7.6v3.6'
</script>

<script lang="ts">
  import { agoShort } from '../../ago'
  import Icon from '../../Icon.svelte'
  import { brandIcon, readIcon } from '../../icons'
  import { i18n, t } from '../../i18n.svelte'
  import type { Place } from '../../row-window'
  import type { ThreadHead } from '../chat/types'
  import { providerBrand } from '../provider-brand'
  import type { SessionState } from '../session-state'
  import { ai } from '../store.svelte'
  import UnreadDot from '../UnreadDot.svelte'
  import { rowName } from './marks'
  import StateMark from './StateMark.svelte'

  const {
    head,
    state,
    unread,
    open = false,
    lit = false,
    role,
    onopen,
    onpin,
    onarchive,
    onmenu,
    onpoint,
    place,
  }: {
    head: ThreadHead
    state: SessionState
    unread: boolean
    open?: boolean
    lit?: boolean
    role?: 'option'
    onopen: () => void
    onpin: () => void
    onarchive: () => void
    onmenu?: (event: MouseEvent) => void
    onpoint?: () => void
    place?: Place
  } = $props()

  const brand = $derived(providerBrand(ai.provider(head.provider)?.kind, head.model))
  const logo = $derived(brand === null ? null : readIcon(brandIcon(brand)))
  const archived = $derived(state === 'archived')
</script>

<li
  class="item"
  class:has-menu={!!onmenu}
  class:away={place?.away !== undefined}
  style:top={place?.away === undefined ? undefined : `${place.away}px`}
  data-at={place?.at}
  role="presentation"
>
  <button
    class="row"
    class:lit
    class:open
    class:archived
    class:is-unread={unread}
    aria-label={rowName(head.title, { unread, state })}
    {role}
    aria-selected={role === 'option' ? lit : undefined}
    onpointermove={onpoint}
    onclick={onopen}
    oncontextmenu={onmenu}
  >
    <span class="main">
      <span class="logo" aria-hidden="true"
        >{#if logo}<Icon icon={logo} />{/if}</span
      >
      {#if unread}<UnreadDot />{/if}
      <span class="title" dir="auto">{head.title || t('Untitled')}</span>
      {#if head.pinned}
        <svg class="pinned" viewBox="0 0 13 13" aria-hidden="true"><path d={PIN} /></svg>
      {/if}
    </span>
  </button>
  <span class="tail">
    <StateMark {state} />
    <span class="slot">
      <span class="when">{agoShort(head.updated, i18n.language)}</span>
      <span class="acts">
        {#if !archived}
          <button
            class="orden-glyph act"
            class:on={!!head.pinned}
            title={head.pinned ? t('Unpin') : t('Pin')}
            aria-label={head.pinned ? t('Unpin') : t('Pin')}
            aria-pressed={!!head.pinned}
            onclick={onpin}
          >
            <svg viewBox="0 0 13 13" aria-hidden="true"><path d={PIN} /></svg>
          </button>
        {/if}
        <button
          class="orden-glyph act"
          title={archived ? t('Unarchive') : t('Archive')}
          aria-label={archived ? t('Unarchive') : t('Archive')}
          onclick={onarchive}
        >
          <svg viewBox="0 0 13 13" aria-hidden="true"
            ><path d="M2 3h9v2.2H2zM2.8 5.2v4.8h7.4V5.2M5.3 7h2.4" /></svg
          >
        </button>
        {#if onmenu}
          <button
            class="orden-glyph act"
            title={t('More')}
            aria-label={t('More')}
            aria-haspopup="menu"
            onclick={onmenu}
          >
            <svg viewBox="0 0 13 13" aria-hidden="true"
              ><path class="dots" d="M3 6.5h.01M6.5 6.5h.01M10 6.5h.01" /></svg
            >
          </button>
        {/if}
      </span>
    </span>
  </span>
</li>

<style>
  .item {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }

  .item.away {
    position: absolute;
    left: 0;
    right: 0;
  }

  .row {
    grid-column: 1 / -1;
    grid-row: 1;
    display: grid;
    grid-template-columns: subgrid;
    align-items: center;
    width: 100%;
    min-height: var(--row-height);
    padding: 0;
    border: 0;
    border-radius: var(--radius-row);
    background: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    text-align: start;
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .main {
    grid-column: 1;
    display: flex;
    align-items: center;
    gap: var(--row-gap);
    min-width: 0;
    padding-inline-start: var(--row-pad);
  }

  .row.lit {
    background: var(--surface-hover);
  }

  .row.open {
    background: var(--surface-press);
    color: var(--text-strong);
  }

  .row.archived {
    color: var(--muted);
  }

  .row.is-unread .title {
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }

  .logo {
    flex: none;
    display: block;
    width: var(--icon-md);
    height: var(--icon-md);
    color: var(--muted-strong);
  }

  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pinned,
  .act svg {
    flex: none;
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .pinned {
    color: var(--muted);
  }

  .tail {
    grid-column: 2;
    grid-row: 1;
    display: flex;
    align-items: center;
    gap: var(--row-gap);
    padding-inline: var(--row-gap) var(--row-pad);
    pointer-events: none;
  }

  .slot {
    display: grid;
    align-items: center;
    justify-items: start;
  }

  .slot > * {
    grid-area: 1 / 1;
  }

  .when {
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .acts {
    display: flex;
    gap: 1px;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .act {
    width: var(--row-height-sm);
    height: var(--row-height-sm);
  }

  .act.on {
    color: var(--accent);
  }

  .dots {
    stroke-width: 2.2;
  }

  .item:hover .acts,
  .item:focus-within .acts,
  :global([data-touch]) .acts {
    opacity: 1;
    pointer-events: auto;
  }

  .item:hover .when,
  .item:focus-within .when,
  :global([data-touch]) .when {
    visibility: hidden;
  }
</style>
