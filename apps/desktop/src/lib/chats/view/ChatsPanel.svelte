<script lang="ts">
  import { onMount } from 'svelte'
  import { localNumber } from '../../region'
  import { workspace } from '../../workspace.svelte'
  import { hiddenKinds } from '../../settings.svelte'
  import { canWriteAt } from '../../sharing.svelte'
  import type { ChatEntry, Hit } from '../api'
  import ChatMark from './ChatMark.svelte'
  import Glyph from './Glyph.svelte'
  import { makeChat, openChat } from './open'
  import type { Who } from '@orden/chats'
  import { Avatar } from '../../accounts-ui/src/api'
  import { firstLine } from './body'
  import { faceOf, nameOf } from './people'
  import { saved } from './saved.svelte'
  import { store } from './source.svelte'
  import { byPriority, isLevel, LEVELS, type Level, type Suggestion } from '@orden/chats/priority'
  import { priorities } from '../priorities.svelte'
  import { startPriorities } from '../prioritise'
  import { levelWord } from '../level-words'
  import type { Priority } from '@orden/markdown/task-line'
  import { showQuickAdd } from '../../surfaces.svelte'

  let query = $state('')
  let showing = $state<'chats' | 'activity' | 'saved'>('chats')
  let activity = $state.raw<Hit[]>([])
  let arranged = $state<'all' | 'priority'>('all')

  const chats = $derived.by(() => {
    const asked = query.trim().toLowerCase()
    return [...store().list]
      .sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))
      .filter((one) => (one.name ?? '').toLowerCase().includes(asked))
  })

  startPriorities()

  const byLevel = $derived.by(() => {
    if (!priorities.on || arranged !== 'priority') return { pending: [], rest: [] }
    const ranked = chats.map((entry) => ({
      entry,
      level: priorities.levelOf(entry.id),
      since: entry.lastAt,
    }))
    return {
      pending: ranked.filter((one) => one.entry.unread > 0).sort(byPriority),
      rest: ranked.filter((one) => one.entry.unread === 0),
    }
  })

  function moved(entry: ChatEntry, value: string) {
    if (!isLevel(value)) return
    priorities.reassign(entry.id, value, { title: entry.name ?? '', from: '', words: '' })
  }

  function useDraft(entry: ChatEntry, reply: string) {
    priorities.settle(entry.id, 'reply')
    store().offer(entry.id, reply)
    open(entry)
  }

  function priorityOf(value: number | undefined): Priority | undefined {
    return value === 1 || value === 2 || value === 3 || value === 4 ? value : undefined
  }

  function addTodo(entry: ChatEntry, todo: NonNullable<Suggestion['todo']>) {
    priorities.settle(entry.id, 'todo')
    const priority = priorityOf(todo.priority)
    showQuickAdd({
      text: todo.title,
      ...(todo.tags ? { tags: todo.tags } : {}),
      ...(todo.due ? { due: todo.due } : {}),
      ...(priority ? { fields: { priority } } : {}),
    })
  }

  const mentions = $derived(store().list.reduce((sum, one) => sum + one.mentions, 0))
  const now = Date.now()

  async function lookActive() {
    activity = await store().search('mentions:me')
  }

  onMount(() => void lookActive())

  function open(chat: ChatEntry | undefined, message?: string) {
    if (chat?.path) openChat(chat.path, {}, message)
  }

  const chatOf = (id: string) => store().list.find((one) => one.id === id)
</script>

{#snippet found(chatId: string, message: string, author: Who, line: string)}
  {@const chat = chatOf(chatId)}
  <button
    type="button"
    class="orden-row"
    aria-label={`${nameOf(author, [], chat?.space ?? null)}: ${line}`}
    onclick={() => open(chat, message)}
  >
    <span class="orden-row-mark"
      ><Avatar face={faceOf(author, [], chat?.space ?? null)} size={20} /></span
    >
    <span class="orden-row-label">{line}</span>
    <span class="orden-row-meta">{chat?.name ?? ''}</span>
  </button>
{/snippet}

<div class="chats">
  <label class="orden-field find">
    <Glyph name="hash" />
    <input bind:value={query} type="search" aria-label="Search" placeholder="Search" />
  </label>

  {#if showing === 'chats' && priorities.on}
    <div class="orden-segmented arranged" role="radiogroup" aria-label="Chats">
      <button
        type="button"
        role="radio"
        aria-checked={arranged === 'all'}
        class:on={arranged === 'all'}
        onclick={() => (arranged = 'all')}>All</button
      >
      <button
        type="button"
        role="radio"
        aria-checked={arranged === 'priority'}
        class:on={arranged === 'priority'}
        onclick={() => (arranged = 'priority')}>By priority</button
      >
    </div>
  {/if}

  {#snippet ranked(one: { entry: ChatEntry; level: Level | null })}
    <div class="ranked" class:unread={one.entry.unread > 0}>
      <button type="button" class="orden-row entry" onclick={() => open(one.entry)}>
        <span class="orden-row-mark"><ChatMark path={one.entry.path} /></span>
        <span class="orden-row-label">{one.entry.name ?? 'Chat'}</span>
        {#if one.entry.unread}<span class="orden-row-meta count"
            >{localNumber(one.entry.unread)}</span
          >{/if}
      </button>
      <select
        class="level"
        aria-label="Priority"
        value={one.level ?? ''}
        onchange={(event) => moved(one.entry, event.currentTarget.value)}
      >
        <option value="" disabled>-</option>
        {#each LEVELS as level (level)}<option value={level}>{levelWord(level)}</option>{/each}
      </select>
    </div>
    {@const suggested = priorities.suggestions[one.entry.id]}
    {#if suggested}
      <div class="suggested">
        {#if suggested.reply}
          <p class="draft">{suggested.reply}</p>
          <button
            type="button"
            class="orden-chip"
            onclick={() => suggested.reply && useDraft(one.entry, suggested.reply)}
            >Use draft</button
          >
        {/if}
        {#if suggested.todo}
          <p class="draft">{suggested.todo.title}</p>
          <button
            type="button"
            class="orden-chip"
            onclick={() => suggested.todo && addTodo(one.entry, suggested.todo)}>Add as task</button
          >
        {/if}
        <button
          type="button"
          class="orden-chip"
          onclick={() => priorities.settle(one.entry.id, 'all')}>Dismiss</button
        >
      </div>
    {/if}
  {/snippet}

  {#if showing === 'chats' && priorities.on && arranged === 'priority'}
    <p class="orden-section">Pending</p>
    {#each byLevel.pending as one (one.entry.id)}
      {@render ranked(one)}
    {/each}
    <p class="orden-section">Everything else</p>
    {#each byLevel.rest as one (one.entry.id)}
      {@render ranked(one)}
    {/each}
  {:else if showing === 'chats'}
    <button
      type="button"
      class="orden-row"
      onclick={() => {
        showing = 'activity'
        void lookActive()
      }}
    >
      <span class="orden-row-mark"><Glyph name="mention" /></span>
      <span class="orden-row-label">Activity</span>
      {#if mentions}<span class="badge">{localNumber(mentions)}</span>{/if}
    </button>
    <button type="button" class="orden-row" onclick={() => (showing = 'saved')}>
      <span class="orden-row-mark"><Glyph name="saved" /></span>
      <span class="orden-row-label">Saved</span>
      {#if saved.list.length}<span class="orden-row-meta">{localNumber(saved.list.length)}</span
        >{/if}
    </button>

    <div class="section">
      <p class="orden-section">Chats</p>
      {#if workspace.activeSpace && hiddenKinds.offers('chat') && canWriteAt(workspace.activeSpace.root)}
        <button
          type="button"
          class="orden-glyph add"
          aria-label="New chat"
          title="New chat"
          onclick={() => void makeChat()}><Glyph name="attach" /></button
        >
      {/if}
    </div>
    {#each chats as chat (chat.id)}
      {@const muted = chat.mutedUntil !== null && chat.mutedUntil > now}
      {@const unread = chat.unread > 0 && !muted}
      <button
        type="button"
        class="orden-row entry"
        class:unread
        class:muted
        class:is-on={workspace.active?.path === chat.path && chat.path !== null}
        disabled={!chat.path}
        onclick={() => open(chat)}
      >
        <span class="orden-row-mark"><ChatMark path={chat.path} /></span>
        <span class="orden-row-label">{chat.name ?? 'Chat'}</span>
        {#if chat.mentions && !muted}
          <span class="badge">{localNumber(chat.mentions)}</span>
        {:else if unread}
          <span class="orden-row-meta count">{localNumber(chat.unread)}</span>
        {/if}
      </button>
    {/each}
  {:else}
    <button type="button" class="orden-row back" onclick={() => (showing = 'chats')}>
      <span class="orden-row-mark orden-mirror"><Glyph name="left" /></span>
      <span class="orden-row-label">{showing === 'activity' ? 'Activity' : 'Saved'}</span>
    </button>
    {#if showing === 'activity'}
      {#each activity as one (`${one.chat}:${one.message.id}`)}
        {@render found(one.chat, one.message.id, one.message.author, firstLine(one.message.body))}
      {:else}
        <p class="empty"><Glyph name="mention" /></p>
      {/each}
    {:else}
      {#each saved.list as one (`${one.chat}:${one.message}`)}
        {@render found(one.chat, one.message, one.author, one.line)}
      {:else}
        <p class="empty"><Glyph name="saved" /></p>
      {/each}
    {/if}
  {/if}
</div>

<style>
  .chats {
    --glyph-size: var(--icon-md);
    display: flex;
    flex-direction: column;
  }

  .find {
    --glyph-size: 14px;
    margin: 0 0 var(--space-2);
    color: var(--muted);
  }

  .section {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .add {
    --glyph-size: 15px;
    width: 24px;
    height: 24px;
  }

  .entry {
    color: var(--muted);
  }

  .entry.unread {
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }

  .entry.muted {
    opacity: 0.55;
  }

  .count {
    font-variant-numeric: tabular-nums;
  }

  .arranged {
    margin: 0 0 var(--space-2);
  }

  .ranked {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .ranked .entry {
    flex: 1;
    min-width: 0;
  }

  .ranked.unread .entry {
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }

  .suggested {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    margin: 0 0 var(--space-2) var(--space-5);
    font-size: var(--text-sm);
  }

  .draft {
    flex-basis: 100%;
    margin: 0;
    overflow: hidden;
    color: var(--muted-strong);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .level {
    flex: none;
    max-width: 7.5em;
    border: 0;
    background: transparent;
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .badge {
    flex: none;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 99px;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    line-height: 18px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .back {
    color: var(--muted-strong);
  }

  .empty {
    --glyph-size: 20px;
    display: grid;
    place-items: center;
    margin: var(--space-5) 0;
    color: var(--muted);
    opacity: 0.5;
  }
</style>
