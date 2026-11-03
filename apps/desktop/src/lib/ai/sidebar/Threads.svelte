<script lang="ts">
  /** The space's threads (docs/ai-sidebar.md 4.11), as Codex's task history: the search
   *  at the top (and New chat over it in a tab's rail), then the chats in the order every
   *  list of them has (#1089, `ordered` in session-state.ts): pinned first, then what
   *  wants the reader, unread before read, the latest first. Each is a ChatRow: whose
   *  model, the title, its state, how long ago; pointed at, Pin, Archive and a "..." for
   *  Rename and Delete. The archived ones are out of the list, behind the row at its foot
   *  that says how many there are.
   *
   *  In the panel it takes the conversation's place (the list glyph, or Ctrl+Shift+A
   *  twice); in a tab of its own it is the rail down the left, always there.
   *
   *  Typing searches titles and words; arrows walk it, Enter opens, Delete archives (and
   *  an archived one comes back with Delete again), Shift+Delete deletes for good,
   *  Escape goes back to the open thread. */
  import { untrack } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import { t } from '../../i18n.svelte'
  import { menu } from '../../menu.svelte'
  import { dur } from '../../motion'
  import { scrollbar } from '../../scrollbar'
  import { shortcuts } from '../../shortcuts.svelte'
  import type { ThreadHead } from '../chat/types'
  import { ordered, stateOf } from '../session-state'
  import { chat } from './chat.svelte'
  import ChatRow from './ChatRow.svelte'

  const { rail = false }: { rail?: boolean } = $props()

  let field = $state<HTMLInputElement>()
  let lit = $state(0)

  function matches(one: ThreadHead, words: string[]): boolean {
    const text = `${one.title} ${one.words} ${one.model}`.toLowerCase()
    return words.every((word) => text.includes(word))
  }

  /** Whether the archived chats are shown, under the rest: asked for at the list's foot. */
  let archivedShown = $state(false)

  const stateIn = (one: ThreadHead) => chat.states.get(one.id) ?? stateOf(one)

  const found = $derived.by(() => {
    const words = chat.listQuery.toLowerCase().split(/\s+/).filter(Boolean)
    return chat.heads.filter((one) => matches(one, words))
  })
  const archived = $derived(
    found.filter((one) => stateIn(one) === 'archived').sort((a, b) => b.updated - a.updated),
  )
  const rows = $derived([
    ...ordered(found, chat.states, chat.unread),
    ...(archivedShown ? archived : []),
  ])

  /** The one heading in the list, over its first archived thread. */
  const archivedFrom = $derived(rows.findIndex((one) => stateIn(one) === 'archived'))

  $effect(() => {
    const last = Math.max(0, rows.length - 1)
    if (untrack(() => lit) > last) lit = last
  })

  // The panel's list takes the keyboard as it comes; the rail of a tab waits to be asked.
  $effect(() => {
    if (!rail) requestAnimationFrame(() => field?.focus())
  })

  function rowMenu(event: MouseEvent, one: ThreadHead) {
    menu.show(event, [
      { label: t('Rename'), asks: true, run: () => void chat.rename(undefined, one.id) },
      one.pinned
        ? { label: t('Unpin'), run: () => void chat.pin(one.id, false) }
        : { label: t('Pin'), run: () => void chat.pin(one.id) },
      one.archived
        ? { label: t('Unarchive'), run: () => chat.unarchive(one.id) }
        : { label: t('Archive'), run: () => chat.archive(one.id) },
      { label: t('Delete'), danger: true, run: () => void chat.remove(one.id) },
    ])
  }

  function toggleArchived(one: ThreadHead) {
    if (one.archived) chat.unarchive(one.id)
    else chat.archive(one.id)
  }

  function onKey(event: KeyboardEvent) {
    const one = rows[lit]
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      lit = (lit + step + rows.length) % Math.max(1, rows.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (one) void chat.openThread(one.id)
    } else if (event.key === 'Delete' && one) {
      event.preventDefault()
      if (event.shiftKey) void chat.remove(one.id)
      else toggleArchived(one)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      chat.listing = false
      chat.focus()
    }
  }
</script>

<div class="threads" in:fly={{ y: rail ? 0 : -6, duration: dur(150), easing: cubicOut }}>
  <div class="top">
    <!-- New chat heads a tab's rail, as New chat heads Codex's header; at a side it is already in
         the side's own row of tabs. -->
    {#if rail}
      <button
        class="new"
        title={shortcuts.tooltip(t('New chat'), 'ai.new')}
        onclick={() => chat.newThread()}
      >
        <svg viewBox="0 0 13 13" aria-hidden="true"
          ><path
            d="M10.9 6.9v3.1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.1a1 1 0 0 1 1-1h3.1M9.3 1.8l1.9 1.9-4.6 4.6-2.5.6.6-2.5z"
          /></svg
        >
        <span>{t('New chat')}</span>
      </button>
    {/if}
    <div class="find nib-field">
      <svg class="nib-field-mark" viewBox="0 0 13 13" aria-hidden="true"
        ><path d="M5.8 2.2a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 1 0 0-7.2zM8.4 8.4l2.6 2.6" /></svg
      >
      <input
        bind:this={field}
        bind:value={chat.listQuery}
        placeholder={t('Search chats')}
        aria-label={t('Search chats')}
        onkeydown={onKey}
        oninput={() => (lit = 0)}
      />
    </div>
  </div>

  <ul class="list" role="listbox" use:scrollbar>
    {#each rows as one, index (one.id)}
      {#if index === archivedFrom}
        <li class="group archived" role="presentation">{t('Archived')}</li>
      {/if}
      <ChatRow
        head={one}
        state={stateIn(one)}
        unread={chat.unread.has(one.id)}
        open={one.id === chat.head?.id}
        lit={index === lit}
        role="option"
        onpoint={() => (lit = index)}
        onopen={() => void chat.openThread(one.id)}
        onpin={() => void chat.pin(one.id, !one.pinned)}
        onarchive={() => toggleArchived(one)}
        onmenu={(event: MouseEvent) => rowMenu(event, one)}
      />
    {:else}
      <li class="empty" role="presentation">
        {chat.listQuery ? t('No matches') : t('No chats yet')}
      </li>
    {/each}
    {#if archived.length && !archivedShown}
      <!-- The archived ones, out of the list and one press away (#1089). -->
      <li role="presentation">
        <button class="nib-row is-short shown-archived" onclick={() => (archivedShown = true)}>
          <span class="nib-row-label">{t('Archived')}</span>
          <span class="nib-row-meta">{archived.length}</span>
        </button>
      </li>
    {/if}
  </ul>
</div>

<style>
  .threads {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .top {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 var(--space-1) var(--space-2);
  }

  /* New chat, a row of the list's own shape, and the search under it: the first things
     in it, as a rail of threads starts. */
  .new {
    display: flex;
    align-items: center;
    gap: var(--space-2);
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

  @media (hover: hover) {
    .new:hover {
      background: var(--surface-hover);
    }
  }

  .new svg {
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .find {
    margin-top: 2px;
  }

  .list {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 0 var(--space-1) var(--space-2);
    overflow-y: auto;
    list-style: none;
  }

  .shown-archived .nib-row-label {
    color: var(--muted);
  }

  .group,
  .empty {
    padding: var(--space-3) var(--row-pad) var(--space-1);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
  }

  .group:first-child {
    padding-top: var(--space-1);
  }
</style>
