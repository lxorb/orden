<script lang="ts">
  /** The Chats panel (docs/chats.md 4.15): navigation, as the Tasks panel is. A field
   *  that narrows the list, Activity (mentions of the reader, newest first) and Saved,
   *  then every chat the account reaches in Discord's three states: read is quiet,
   *  unread is bright with a count, a mention is a badge in the accent; a muted one is
   *  quieter still. The plus makes a chat in the space in front. A press opens the chat
   *  in a tab. */
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
  import { PROVIDERS } from '../accounts.svelte'
  import { host } from '../providers/host'
  import { accounts, openConversation } from '../linked'
  import ConnectForm from './ConnectForm.svelte'

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
  const offered = PROVIDERS.filter((one) => one.available(host))
  let connecting = $state(false)

  accounts.start()

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

  /** Mentions of the reader, newest first: what Activity lists (4.11). */
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
    class="nib-row"
    aria-label={`${nameOf(author, [], chat?.space ?? null)}: ${line}`}
    onclick={() => open(chat, message)}
  >
    <span class="nib-row-mark"
      ><Avatar face={faceOf(author, [], chat?.space ?? null)} size={20} /></span
    >
    <span class="nib-row-label">{line}</span>
    <span class="nib-row-meta">{chat?.name ?? ''}</span>
  </button>
{/snippet}

<div class="chats">
  <label class="nib-field find">
    <Glyph name="hash" />
    <input bind:value={query} type="search" aria-label={t('Search')} placeholder={t('Search')} />
  </label>

  {#if showing === 'chats'}
    <button
      type="button"
      class="nib-row"
      onclick={() => {
        showing = 'activity'
        void lookActive()
      }}
    >
      <span class="nib-row-mark"><Glyph name="mention" /></span>
      <span class="nib-row-label">{t('Activity')}</span>
      {#if mentions}<span class="badge">{amount(mentions)}</span>{/if}
    </button>
    <button type="button" class="nib-row" onclick={() => (showing = 'saved')}>
      <span class="nib-row-mark"><Glyph name="saved" /></span>
      <span class="nib-row-label">{t('Saved')}</span>
      {#if saved.list.length}<span class="nib-row-meta">{amount(saved.list.length)}</span>{/if}
    </button>

    <div class="section">
      <p class="nib-section">{t('Chats')}</p>
      {#if workspace.activeSpace && hiddenKinds.offers('chat') && canWriteAt(workspace.activeSpace.root)}
        <button
          type="button"
          class="nib-glyph add"
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
        class="nib-row entry"
        class:unread
        class:muted
        class:is-on={workspace.active?.path === chat.path && chat.path !== null}
        disabled={!chat.path}
        onclick={() => open(chat)}
      >
        <span class="nib-row-mark"><ChatMark path={chat.path} /></span>
        <!-- A chat whose pointer is still on its way here has no name yet: the kind's
             word stands in rather than a blank row (#375). -->
        <span class="nib-row-label">{chat.name ?? t('Chat')}</span>
        {#if chat.mentions && !muted}
          <span class="badge">{amount(chat.mentions)}</span>
        {:else if unread}
          <span class="nib-row-meta count">{amount(chat.unread)}</span>
        {/if}
      </button>
    {/each}

    {#if offered.length}
      <div class="section">
        <p class="nib-section">{t('Accounts')}</p>
        <button
          type="button"
          class="nib-glyph add"
          aria-label={t('Connect')}
          title={t('Connect')}
          onclick={() => (connecting = !connecting)}><Glyph name="attach" /></button
        >
      </div>
      {#if connecting && offered[0]}
        <ConnectForm provider={offered[0]} done={() => (connecting = false)} />
      {/if}
      {#each accounts.failed as one (`${one.provider}:${one.account}`)}
        <p class="nib-row failed" title={one.reason}>
          <span class="nib-row-label">{one.account}</span>
          <span class="nib-row-meta">{t('Signed out')}</span>
        </p>
      {/each}
      {#each connected.linked as one (`${one.provider.id}:${one.account.id}`)}
        <div class="account">
          <svg viewBox="0 0 24 24" aria-hidden="true" class="mark"
            ><path d={one.provider.icon} /></svg
          >
          <span class="nib-row-label">{one.account.label}</span>
          {#if one.status === 'offline'}<span class="nib-row-meta">{t('Offline')}</span>
          {:else if one.status === 'signed-out'}<span class="nib-row-meta">{t('Signed out')}</span>
          {/if}
          <button
            type="button"
            class="nib-glyph add"
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
            class="nib-row entry"
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
            <span class="nib-row-label"
              >{conversation.title ??
                conversation.people.map((person) => person.name).join(', ')}</span
            >
            {#if unread}<span class="nib-row-meta count">{amount(conversation.unread)}</span>{/if}
          </button>
        {/each}
      {/each}
    {/if}
  {:else}
    <button type="button" class="nib-row back" onclick={() => (showing = 'chats')}>
      <span class="nib-row-mark"><Glyph name="left" /></span>
      <span class="nib-row-label">{showing === 'activity' ? t('Activity') : t('Saved')}</span>
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
