<script lang="ts">
  import type { ProviderMessage } from '@orden/chats/provider'
  import { onDestroy } from 'svelte'
  import { downloadStarted } from '../../downloads/started'
  import { i18n, t } from '../../i18n.svelte'
  import type { Tab } from '../../workspace.svelte'
  import { connected } from '../connected.svelte'
  import { conversationKeyOf } from '../conversation-key'
  import { accounts } from '../linked'
  import { drafts } from '../drafts'
  import { rowKey } from '../priorities.svelte'
  import Glyph from './Glyph.svelte'

  const { tab }: { tab: Tab } = $props()

  const key = $derived(conversationKeyOf(tab.note.text))
  const linked = $derived(key ? connected.find(key.provider, key.account) : undefined)
  const failure = $derived(
    key
      ? accounts.failed.find((one) => one.provider === key.provider && one.account === key.account)
      : undefined,
  )
  const conversation = $derived(
    linked?.conversations.find((one) => one.id === key?.conversation) ?? null,
  )

  let messages = $state.raw<ProviderMessage[]>([])
  let older = $state<string | null>(null)
  let words = $state('')
  let sending = $state(false)
  let problem = $state<string | null>(null)
  let loaded: string | null = null

  accounts.start()

  $effect(() => {
    if (!key) return
    const waiting = drafts.get(rowKey(key.provider, key.account, key.conversation))
    if (waiting === undefined) return
    drafts.delete(rowKey(key.provider, key.account, key.conversation))
    if (!words.trim()) words = waiting
  })

  $effect(() => {
    const connection = linked?.connection
    const asked = key
    if (!connection || !asked) return
    const marker = `${asked.provider}\n${asked.account}\n${asked.conversation}`
    if (loaded === marker) return
    loaded = marker
    void connection.history(asked.conversation, { limit: 50 }).then((page) => {
      messages = page.messages
      older = page.before
      const last = page.messages.at(-1)
      if (last) void connection.markRead?.(asked.conversation, last.id).catch(() => undefined)
      connected.seen(asked.provider, asked.account, asked.conversation)
    })
  })

  const stop = connected.hear((provider, account, event) => {
    if (provider !== key?.provider || account !== key.account) return
    if (event.t !== 'message' || event.message.conversation !== key.conversation) return
    if (messages.some((one) => one.id === event.message.id)) return
    messages = [...messages, event.message]
    if (!event.message.mine) connected.seen(provider, account, key.conversation)
  })
  onDestroy(stop)

  async function earlier() {
    const connection = linked?.connection
    if (!connection || !key || older === null) return
    const page = await connection.history(key.conversation, { limit: 50, before: older })
    messages = [...page.messages, ...messages]
    older = page.before
  }

  async function send() {
    const connection = linked?.connection
    const text = words.trim()
    if (!connection || !key || !text || sending) return
    sending = true
    problem = null
    try {
      await connection.send(key.conversation, { text })
      words = ''
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error)
    } finally {
      sending = false
    }
  }

  async function download(
    message: ProviderMessage,
    ref: string,
    name: string,
    type: string,
    element: HTMLElement,
  ) {
    const connection = linked?.connection
    if (!connection || !key) return
    const bytes = await connection.attachment(key.conversation, message.id, ref)
    const url = URL.createObjectURL(new Blob([bytes.slice()], { type }))
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    downloadStarted(name, { element })
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  function keyed(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      void send()
    }
  }
</script>

<section class="conversation" aria-label={conversation?.title ?? tab.note.name}>
  <header class="head">
    {#if linked}<svg viewBox="0 0 24 24" aria-hidden="true" class="mark"
        ><path d={linked.provider.icon} /></svg
      >{/if}
    <h1>{conversation?.title ?? tab.note.name}</h1>
    {#if conversation?.people.length}
      <span class="people">{conversation.people.map((one) => one.name).join(', ')}</span>
    {/if}
  </header>

  <div class="rows" role="log" aria-live="polite">
    {#if failure}
      <p class="state">
        {t('Signed out')}: {failure.reason}
        <button
          class="nib-button is-quiet"
          type="button"
          onclick={() => {
            const saved = accounts.saved.find(
              (one) => one.provider === failure.provider && one.account === failure.account,
            )
            if (saved) void accounts.relink(saved)
          }}>{t('Retry')}</button
        >
      </p>
    {:else if !linked}
      <p class="state">{t('Connecting…')}</p>
    {:else if linked.status === 'offline' || linked.status === 'signed-out'}
      <p class="state">
        {linked.status === 'offline' ? t('Offline') : t('Signed out')}{linked.reason
          ? `: ${linked.reason}`
          : ''}
      </p>
    {/if}
    {#if older !== null}
      <button class="nib-button is-quiet more" type="button" onclick={() => void earlier()}
        >{t('More')}</button
      >
    {/if}
    {#each messages as message (message.id)}
      <article class="message" class:mine={message.mine}>
        <p class="who">
          <span class="name">{message.author.name}</span>
          <time datetime={new Date(message.at).toISOString()}
            >{i18n.when(message.at, { dateStyle: 'medium', timeStyle: 'short' })}</time
          >
        </p>
        <p class="words">{message.text}</p>
        {#each message.attachments as file (file.ref)}
          <button
            class="nib-chip file"
            type="button"
            onclick={(event) =>
              void download(message, file.ref, file.name, file.type, event.currentTarget)}
            ><Glyph name="attach" />{file.name}</button
          >
        {/each}
      </article>
    {/each}
  </div>

  {#if linked?.provider.can.send}
    <form
      class="reply"
      onsubmit={(event) => {
        event.preventDefault()
        void send()
      }}
    >
      <textarea
        class="nib-field"
        bind:value={words}
        dir="auto"
        rows="3"
        aria-label={t('Reply')}
        placeholder={t('Reply')}
        onkeydown={keyed}></textarea>
      {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
      <button class="nib-button" type="submit" disabled={sending || !words.trim()}
        >{t('Send')}</button
      >
    </form>
  {/if}
</section>

<style>
  .conversation {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border);
  }

  .head h1 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: var(--weight-strong);
  }

  .mark {
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
    align-self: center;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    color: var(--muted);
  }

  .people {
    overflow: hidden;
    color: var(--muted);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rows {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-3) var(--space-4);
  }

  .state,
  .problem {
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .more {
    display: block;
    margin: 0 auto var(--space-3);
  }

  .message {
    margin: 0 0 var(--space-4);
  }

  .who {
    display: flex;
    gap: var(--space-2);
    margin: 0 0 var(--space-1);
    font-size: var(--text-sm);
  }

  .name {
    font-weight: var(--weight-strong);
  }

  .mine .name {
    color: var(--accent);
  }

  time {
    color: var(--muted);
  }

  .words {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .file {
    --glyph-size: 14px;
    margin: var(--space-1) var(--space-1) 0 0;
  }

  .reply {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: end;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--border);
  }

  .reply textarea {
    resize: vertical;
  }

  .problem {
    grid-column: 1 / -1;
    margin: 0;
  }
</style>
