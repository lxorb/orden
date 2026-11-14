<script lang="ts">
  import { untrack } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { agentMarks } from '../../agent-marks.svelte'
  import { menu } from '../../menu.svelte'
  import { dur, fly } from '../../platform/src/api'
  import type { Place } from '../../row-window'
  import { scrollbar } from '../../ui-kit/src/api'
  import { shortcuts } from '../../shortcuts.svelte'
  import { agentRows } from '../../surfaces.svelte'
  import type { ThreadHead } from '../../ai-providers/src/api'
  import { ordered, stateOf } from '../../ai-providers/src/api'
  import { chat } from './chat.svelte'
  import ChatRow from './ChatRow.svelte'
  import ChatWindow from './ChatWindow.svelte'

  const { rail = false }: { rail?: boolean } = $props()

  let field = $state<HTMLInputElement>()
  let lit = $state(0)

  function matches(one: ThreadHead, words: string[]): boolean {
    const text = `${one.title} ${one.words} ${one.model}`.toLowerCase()
    return words.every((word) => text.includes(word))
  }

  let archivedShown = $state(false)

  const stateIn = (one: ThreadHead) => chat.states.get(one.id) ?? stateOf(one)

  const found = $derived.by(() => {
    const words = chat.listQuery.toLowerCase().split(/\s+/).filter(Boolean)
    return chat.heads.filter((one) => matches(one, words))
  })
  const archived = $derived(
    found.filter((one) => stateIn(one) === 'archived').sort((a, b) => b.updated - a.updated),
  )
  const active = $derived(ordered(found, chat.states, chat.unread))
  const shownArchived = $derived(archivedShown ? archived : [])
  const rows = $derived([...active, ...shownArchived])

  let upper = $state<{ reach: (index: number) => void }>()
  let lower = $state<{ reach: (index: number) => void }>()

  function reach(index: number) {
    if (index < active.length) upper?.reach(index)
    else lower?.reach(index - active.length)
  }

  $effect(() => {
    const last = Math.max(0, rows.length - 1)
    if (untrack(() => lit) > last) lit = last
  })

  $effect(() => {
    if (!rail) requestAnimationFrame(() => field?.focus())
  })

  function rowMenu(event: MouseEvent, one: ThreadHead) {
    menu.show(event, [
      { label: 'Rename', asks: true, run: () => void chat.rename(undefined, one.id) },
      one.pinned
        ? { label: 'Unpin', run: () => void chat.pin(one.id, false) }
        : { label: 'Pin', run: () => void chat.pin(one.id) },
      one.archived
        ? { label: 'Unarchive', run: () => chat.unarchive(one.id) }
        : { label: 'Archive', run: () => chat.archive(one.id) },
      { label: 'Delete', danger: true, run: () => void chat.remove(one.id) },
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
      reach(lit)
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

{#snippet chatRow(one: ThreadHead, index: number, place: Place)}
  <ChatRow
    {place}
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
{/snippet}

{#snippet archivedRow(one: ThreadHead, index: number, place: Place)}
  {@render chatRow(one, active.length + index, place)}
{/snippet}

<div class="threads" in:fly={{ y: rail ? 0 : -6, duration: dur(150), easing: cubicOut }}>
  <div class="top">
    {#if rail}
      <button
        class="new"
        title={shortcuts.tooltip('New chat', 'ai.new')}
        onclick={() => chat.newThread()}
      >
        <svg viewBox="0 0 13 13" aria-hidden="true"
          ><path
            d="M10.9 6.9v3.1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.1a1 1 0 0 1 1-1h3.1M9.3 1.8l1.9 1.9-4.6 4.6-2.5.6.6-2.5z"
          /></svg
        >
        <span>New chat</span>
      </button>
    {/if}
    <div class="find orden-field">
      <svg class="orden-field-mark" viewBox="0 0 13 13" aria-hidden="true"
        ><path d="M5.8 2.2a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 1 0 0-7.2zM8.4 8.4l2.6 2.6" /></svg
      >
      <input
        bind:this={field}
        bind:value={chat.listQuery}
        placeholder="Search chats"
        aria-label="Search chats"
        onkeydown={onKey}
        oninput={() => (lit = 0)}
      />
    </div>
  </div>

  <ul class="list" role="listbox" use:scrollbar>
    {#if agentMarks.heard && !chat.listQuery}
      {#await agentRows() then AgentRows}
        <AgentRows
          open={agentMarks.open}
          onopen={(agent: string) => {
            agentMarks.open = agent
            chat.listing = false
          }}
        />
      {/await}
    {/if}
    {#if rows.length}
      {#if active.length}
        <ChatWindow bind:this={upper} heads={active} role="group" row={chatRow} />
      {/if}
      {#if shownArchived.length}
        <li class="group archived" role="presentation">Archived</li>
        <ChatWindow bind:this={lower} heads={shownArchived} role="group" row={archivedRow} />
      {/if}
    {:else}
      <li class="empty" role="presentation">
        {chat.listQuery ? 'No matches' : 'No chats yet'}
      </li>
    {/if}
    {#if archived.length && !archivedShown}
      <li role="presentation">
        <button class="orden-row is-short shown-archived" onclick={() => (archivedShown = true)}>
          <span class="orden-row-label">Archived</span>
          <span class="orden-row-meta">{archived.length}</span>
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

  .shown-archived .orden-row-label {
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
