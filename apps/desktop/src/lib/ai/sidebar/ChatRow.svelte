<script lang="ts" module>
  /** A pin, its head and its point. */
  const PIN = 'M5 1.8h3l-.4 3.1 1.9 1.8v.9H3.5v-.9l1.9-1.8zM6.5 7.6v3.6'
</script>

<script lang="ts">
  /** One chat in a list of them (#1089), the same row in every list: the panel's home
   *  and the list of all of them (Threads.svelte). On the left whose model it talks to,
   *  as that brand's logo; then the title, stronger where something came the reader has
   *  not seen; at the end its state's mark and how long ago it moved. Pointed at, Pin and
   *  Archive at its end, where the time was, and the list's own "..." after them where
   *  the list has a menu. */
  import { agoShort } from '../../ago'
  import Icon from '../../Icon.svelte'
  import { brandIcon, readIcon } from '../../icons'
  import { i18n, t } from '../../i18n.svelte'
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
  }: {
    head: ThreadHead
    state: SessionState
    unread: boolean
    open?: boolean
    lit?: boolean
    /** `option` inside a listbox. */
    role?: 'option'
    onopen: () => void
    onpin: () => void
    onarchive: () => void
    onmenu?: (event: MouseEvent) => void
    onpoint?: () => void
  } = $props()

  const brand = $derived(providerBrand(ai.provider(head.provider)?.kind, head.model))
  const logo = $derived(brand === null ? null : readIcon(brandIcon(brand)))
  const archived = $derived(state === 'archived')
</script>

<li class="item" class:has-menu={!!onmenu} role="presentation">
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
    <span class="logo" aria-hidden="true"
      >{#if logo}<Icon icon={logo} />{/if}</span
    >
    {#if unread}<UnreadDot />{/if}
    <span class="title">{head.title || t('Untitled')}</span>
    {#if head.pinned}
      <svg class="pinned" viewBox="0 0 13 13" aria-hidden="true"><path d={PIN} /></svg>
    {/if}
    <StateMark {state} />
    <span class="when">{agoShort(head.updated, i18n.language)}</span>
  </button>
  <span class="acts">
    {#if !archived}
      <button
        class="nib-glyph act"
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
      class="nib-glyph act"
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
        class="nib-glyph act"
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
</li>

<style>
  .item {
    position: relative;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-height: var(--row-height);
    padding: 0 var(--row-pad);
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

  /* Unread (#1064): quiet but there, a dot in the accent before a stronger title. */
  .row.is-unread .title {
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }

  /* Whose model, in the ink of the row: a brand's mark is drawn in the text's colour,
     so it reads on either theme (#1082). The box is kept where there is no logo, so
     every title starts at the same place. */
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

  .when {
    flex: none;
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  /* Pin, Archive and the list's "...", over the end of the row pointed at where the
     time was: the row's actions without a column of glyphs down a list of titles. */
  .acts {
    position: absolute;
    top: 50%;
    inset-inline-end: 2px;
    display: flex;
    gap: 1px;
    translate: 0 -50%;
    opacity: 0;
    pointer-events: none;
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
  .item:focus-within .when {
    opacity: 0;
  }

  .item:hover .row,
  .item:focus-within .row {
    padding-inline-end: calc(var(--row-height-sm) * 2 + 6px);
  }

  .item.has-menu:hover .row,
  .item.has-menu:focus-within .row {
    padding-inline-end: calc(var(--row-height-sm) * 3 + 8px);
  }
</style>
