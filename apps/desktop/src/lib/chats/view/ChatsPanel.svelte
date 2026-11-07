<script lang="ts">
  import { onMount } from 'svelte'
  import { amount, t } from '../../i18n.svelte'
  import { workspace } from '../../workspace.svelte'
  import { hiddenKinds } from '../../settings.svelte'
  import { canWriteAt } from '../../sharing.svelte'
  import type { ChatEntry, Hit } from '../api'
  import ChatMark from './ChatMark.svelte'
  import Glyph from './Glyph.svelte'
  import { makeChat, openChat } from './open'
  import type { Who } from '@orden/chats'
  import Avatar from '../../people/Avatar.svelte'
  import { firstLine } from './body'
  import { faceOf, nameOf } from './people'
  import { saved } from './saved.svelte'
  import { store } from './source.svelte'
  import { connected, type Linked } from '../connected.svelte'
  import { ORDEN } from '../providers/orden'
  import { newestFirst } from '@orden/chats/provider'
  import { host } from '../providers/host'
  import { accounts, openConversation } from '../linked'
  import ConnectForm from './ConnectForm.svelte'
  import SignIn from './SignIn.svelte'
  import { byPriority, LEVELS, isLevel } from '@orden/chats/priority'
  import { priorities, rowKey } from '../priorities.svelte'
  import { startPriorities } from '../prioritise'
  import { levelWord } from '../level-words'
  import type { Row } from '../connected.svelte'
  import type { Suggestion } from '@orden/chats/priority'
  import type { Priority } from '@orden/markdown/task-line'
  import { showQuickAdd } from '../../surfaces.svelte'
  import { drafts } from '../drafts'

  let query = $state('')
  let showing = $state<'chats' | 'activity' | 'saved'>('chats')
  let activity = $state.raw<Hit[]>([])

  const chats = $derived.by(() => {
    const byId = new Map(store().list.map((one) => [one.id, one]))
    const asked = query.trim().toLowerCase()
    return connected
      .rows()
      .filter((row) => row.provider === ORDEN)
      .flatMap((row) => byId.get(row.conversation.id) ?? [])
      .filter((one) => (one.name ?? '').toLowerCase().includes(asked))
  })
  const offered = $derived(accounts.offered.filter((one) => one.available(host)))
  let connecting = $state(false)

  let arranged = $state<'service' | 'priority'>('service')

  accounts.start()
  startPriorities()

  const byLevel = $derived.by(() => {
    if (!priorities.on || arranged !== 'priority') return { pending: [], rest: [] }
    const asked = query.trim().toLowerCase()
    const rows = connected
      .rows()
      .filter(
        (row) =>
          !asked ||
          titleOf(row).toLowerCase().includes(asked) ||
          row.conversation.people.some(
            (person) =>
              person.name.toLowerCase().includes(asked) ||
              (person.handle ?? '').toLowerCase().includes(asked),
          ),
      )
      .map((row) => ({ row, level: levelFor(row), since: row.conversation.lastAt }))
    return {
      pending: rows.filter((one) => one.row.conversation.unread > 0).sort(byPriority),
      rest: rows.filter((one) => one.row.conversation.unread === 0),
    }
  })

  function keyOf(row: Row) {
    return rowKey(row.provider, row.account, row.conversation.id)
  }

  function levelFor(row: Row) {
    return priorities.assigned[keyOf(row)]?.level ?? null
  }

  function titleOf(row: Row) {
    return (
      row.conversation.title ??
      (row.conversation.people.map((person) => person.name).join(', ') || t('Chat'))
    )
  }

  function iconOf(row: Row) {
    return connected.find(row.provider, row.account)?.provider.icon ?? ORDEN_ICON
  }

  function openRow(row: Row) {
    if (row.provider === ORDEN) {
      open(store().entry(row.conversation.id) ?? undefined)
      return
    }
    openConversation(
      { provider: row.provider, account: row.account, conversation: row.conversation.id },
      titleOf(row),
    )
  }

  function moved(row: Row, value: string) {
    if (!isLevel(value)) return
    priorities.reassign(keyOf(row), value, {
      title: titleOf(row),
      from: row.conversation.people.map((person) => person.name).join(', '),
      words: row.conversation.snippet ?? '',
    })
  }

  function useDraft(row: Row, reply: string) {
    priorities.settle(keyOf(row), 'reply')
    if (row.provider === ORDEN) {
      store().offer(row.conversation.id, reply)
      open(store().entry(row.conversation.id) ?? undefined)
      return
    }
    drafts.set(keyOf(row), reply)
    openRow(row)
  }

  function priorityOf(value: number | undefined): Priority | undefined {
    return value === 1 || value === 2 || value === 3 || value === 4 ? value : undefined
  }

  function addTodo(row: Row, todo: NonNullable<Suggestion['todo']>) {
    priorities.settle(keyOf(row), 'todo')
    const priority = priorityOf(todo.priority)
    showQuickAdd({
      text: todo.title,
      ...(todo.tags ? { tags: todo.tags } : {}),
      ...(todo.due ? { due: todo.due } : {}),
      ...(priority ? { fields: { priority } } : {}),
    })
  }

  const ORDEN_ICON = 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18'

  function conversationsOf(one: Linked) {
    const asked = query.trim().toLowerCase()
    return one.conversations
      .filter(
        (it) =>
          !asked ||
          (it.title ?? '').toLowerCase().includes(asked) ||
          it.people.some(
            (person) =>
              person.name.toLowerCase().includes(asked) ||
              (person.handle ?? '').toLowerCase().includes(asked),
          ),
      )
      .sort(newestFirst)
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
    <input bind:value={query} type="search" aria-label={t('Search')} placeholder={t('Search')} />
  </label>

  {#if showing === 'chats' && priorities.on}
    <div class="orden-segmented arranged" role="radiogroup" aria-label={t('Chats')}>
      <button
        type="button"
        role="radio"
        aria-checked={arranged === 'service'}
        class:on={arranged === 'service'}
        onclick={() => (arranged = 'service')}>{t('By service')}</button
      >
      <button
        type="button"
        role="radio"
        aria-checked={arranged === 'priority'}
        class:on={arranged === 'priority'}
        onclick={() => (arranged = 'priority')}>{t('By priority')}</button
      >
    </div>
  {/if}

  {#snippet ranked(one: { row: Row; level: (typeof LEVELS)[number] | null })}
    <div class="ranked" class:unread={one.row.conversation.unread > 0}>
      <button type="button" class="orden-row entry" onclick={() => openRow(one.row)}>
        <span class="orden-row-mark"
          ><svg viewBox="0 0 24 24" aria-hidden="true" class="mark"
            ><path d={iconOf(one.row)} /></svg
          ></span
        >
        <span class="orden-row-label">{titleOf(one.row)}</span>
        {#if one.row.conversation.unread}<span class="orden-row-meta count"
            >{amount(one.row.conversation.unread)}</span
          >{/if}
      </button>
      <select
        class="level"
        aria-label={t('Priority')}
        value={one.level ?? ''}
        onchange={(event) => moved(one.row, event.currentTarget.value)}
      >
        <option value="" disabled>-</option>
        {#each LEVELS as level (level)}<option value={level}>{levelWord(level)}</option>{/each}
      </select>
    </div>
    {@const suggested = priorities.suggestions[keyOf(one.row)]}
    {#if suggested}
      <div class="suggested">
        {#if suggested.reply}
          <p class="draft">{suggested.reply}</p>
          <button
            type="button"
            class="orden-chip"
            onclick={() => suggested.reply && useDraft(one.row, suggested.reply)}
            >{t('Use draft')}</button
          >
        {/if}
        {#if suggested.todo}
          <p class="draft">{suggested.todo.title}</p>
          <button
            type="button"
            class="orden-chip"
            onclick={() => suggested.todo && addTodo(one.row, suggested.todo)}
            >{t('Add as task')}</button
          >
        {/if}
        <button
          type="button"
          class="orden-chip"
          onclick={() => priorities.settle(keyOf(one.row), 'all')}>{t('Dismiss')}</button
        >
      </div>
    {/if}
  {/snippet}

  {#if showing === 'chats' && priorities.on && arranged === 'priority'}
    <p class="orden-section">{t('Pending')}</p>
    {#each byLevel.pending as one (keyOf(one.row))}
      {@render ranked(one)}
    {/each}
    <p class="orden-section">{t('Everything else')}</p>
    {#each byLevel.rest as one (keyOf(one.row))}
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
      <span class="orden-row-label">{t('Activity')}</span>
      {#if mentions}<span class="badge">{amount(mentions)}</span>{/if}
    </button>
    <button type="button" class="orden-row" onclick={() => (showing = 'saved')}>
      <span class="orden-row-mark"><Glyph name="saved" /></span>
      <span class="orden-row-label">{t('Saved')}</span>
      {#if saved.list.length}<span class="orden-row-meta">{amount(saved.list.length)}</span>{/if}
    </button>

    <div class="section">
      <p class="orden-section">{t('Chats')}</p>
      {#if workspace.activeSpace && hiddenKinds.offers('chat') && canWriteAt(workspace.activeSpace.root)}
        <button
          type="button"
          class="orden-glyph add"
          aria-label={t('New chat')}
          title={t('New chat')}
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
        <span class="orden-row-label">{chat.name ?? t('Chat')}</span>
        {#if chat.mentions && !muted}
          <span class="badge">{amount(chat.mentions)}</span>
        {:else if unread}
          <span class="orden-row-meta count">{amount(chat.unread)}</span>
        {/if}
      </button>
    {/each}

    {#if offered.length}
      <div class="section">
        <p class="orden-section">{t('Accounts')}</p>
        <button
          type="button"
          class="orden-glyph add"
          aria-label={t('Connect')}
          title={t('Connect')}
          onclick={() => (connecting = !connecting)}><Glyph name="attach" /></button
        >
      </div>
      {#if connecting}
        <ConnectForm providers={offered} done={() => (connecting = false)} />
      {:else}
        <SignIn />
      {/if}
      {#each accounts.failed as one (`${one.provider}:${one.account}`)}
        <p class="orden-row failed" title={one.reason}>
          <span class="orden-row-label">{one.account}</span>
          <span class="orden-row-meta">{t('Signed out')}</span>
        </p>
      {/each}
      {#each connected.linked as one (`${one.provider.id}:${one.account.id}`)}
        <div class="account">
          <svg viewBox="0 0 24 24" aria-hidden="true" class="mark"
            ><path d={one.provider.icon} /></svg
          >
          <span class="orden-row-label">{one.account.label}</span>
          {#if one.status === 'offline'}<span class="orden-row-meta">{t('Offline')}</span>
          {:else if one.status === 'signed-out'}<span class="orden-row-meta">{t('Signed out')}</span
            >
          {/if}
          <button
            type="button"
            class="orden-glyph add"
            aria-label={t('Disconnect')}
            title={t('Disconnect')}
            onclick={() => void accounts.disconnect(one.provider.id, one.account.id)}
            ><Glyph name="close" /></button
          >
        </div>
        {#each conversationsOf(one) as conversation (conversation.id)}
          {@const unread = conversation.unread > 0}
          <button
            type="button"
            class="orden-row entry"
            class:unread
            onclick={() =>
              openConversation(
                {
                  provider: one.provider.id,
                  account: one.account.id,
                  conversation: conversation.id,
                },
                conversation.title ?? conversation.people[0]?.name ?? one.provider.name,
              )}
          >
            <span class="orden-row-label"
              >{conversation.title ??
                conversation.people.map((person) => person.name).join(', ')}</span
            >
            {#if unread}<span class="orden-row-meta count">{amount(conversation.unread)}</span>{/if}
          </button>
        {/each}
      {/each}
    {/if}
  {:else}
    <button type="button" class="orden-row back" onclick={() => (showing = 'chats')}>
      <span class="orden-row-mark"><Glyph name="left" /></span>
      <span class="orden-row-label">{showing === 'activity' ? t('Activity') : t('Saved')}</span>
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

  .account {
    --glyph-size: 14px;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-2) 0 0;
    color: var(--muted-strong);
    font-size: var(--text-sm);
  }

  .mark {
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .failed {
    color: var(--muted);
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
