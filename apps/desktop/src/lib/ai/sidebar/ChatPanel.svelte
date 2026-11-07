<script lang="ts">
  import { door } from '@orden/markdown/door'
  import { onMount, untrack } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import { t } from '../../i18n.svelte'
  import { menu } from '../../menu.svelte'
  import { dur } from '../../motion'
  import { hearAgain } from '../../shortcuts/registry'
  import { shortcuts } from '../../shortcuts.svelte'
  import { dropOver, isTreeDrag } from '../../drag-paths'
  import { ai } from '../store.svelte'
  import { following, toggleFollow } from '../review'
  import { agentOpen } from './agent-open.svelte'
  import { chat } from './chat.svelte'
  import Composer from './Composer.svelte'
  import Conversation from './Conversation.svelte'
  import { dropRows } from './drop'
  import { setHost } from './host'
  import { railOpen, rememberRail } from './prefs'
  import { chatToTab } from './reveal'
  import Threads from './Threads.svelte'

  const {
    ongoto,
    wide = false,
  }: { ongoto?: ((line: number) => void) | undefined; wide?: boolean } = $props()

  const host = untrack(() => (wide ? 'tab' : 'side'))
  setHost(host)

  let root = $state<HTMLElement>()
  let railed = $state(railOpen())

  const ready = $derived(ai.providerFor('ask') !== null)
  const head = $derived(chat.head)
  const listing = $derived(chat.listing && !wide)
  const empty = $derived(!chat.turns.length && !chat.busy && !chat.pending[head?.id ?? ''])
  const session = $derived(listing ? null : agentOpen.id)
  const agentSession = door(() => import('../../agents/ui/AgentSession.svelte'))
  $effect(() => {
    if (agentOpen.id !== null) untrack(() => (chat.listing = false))
  })

  function toggleRail() {
    railed = !railed
    rememberRail(railed)
  }

  function titleMenu(event: MouseEvent) {
    const thread = chat.thread
    menu.show(event, [
      { label: t('Rename'), asks: true, run: () => void chat.rename() },
      ...(thread
        ? [{ label: t('Follow'), checked: following(thread), run: () => toggleFollow(thread) }]
        : []),
      { label: t('Branch'), run: () => chat.branch() },
      { label: t('Save as a note'), run: () => void chat.exportThread() },
      ...(wide ? [] : [{ label: t('Open in new tab'), run: chatToTab }]),
      { label: t('Archive'), run: () => chat.archive() },
      { label: t('Delete'), danger: true, run: () => void chat.remove() },
    ])
  }

  function claim() {
    if (chat.host !== host) {
      chat.popover = null
      chat.host = host
    }
  }

  onMount(() => {
    chat.host = host
    hearAgain(() => {
      const at = document.activeElement
      const box = root
      if (!box?.contains(at) || chat.listing || at?.tagName !== 'TEXTAREA') return false
      if (!wide) chat.showThreads()
      else {
        railed = true
        requestAnimationFrame(() => box.querySelector<HTMLElement>('.shelf input')?.focus())
      }
      return true
    })
    const body = root?.closest('[data-panel]')
    if (body && body === document.activeElement) {
      root?.querySelector<HTMLElement>(ready ? 'textarea' : '.empty-text .link')?.focus()
    }
    return () => {
      hearAgain(null)
      if (chat.host === host) chat.host = host === 'tab' ? 'side' : 'tab'
    }
  })
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="ask"
  class:wide
  class:is-empty={empty && !listing && session === null}
  bind:this={root}
  onfocusin={claim}
  onpointerdown={claim}
  data-chat-drop=""
  use:dropOver={(event) => {
    if (isTreeDrag(event.dataTransfer)) event.preventDefault()
  }}
  ondrop={dropRows}
>
  {#if wide && railed}
    <aside class="shelf" transition:fly={{ x: -12, duration: dur(150), easing: cubicOut }}>
      <Threads rail />
    </aside>
  {/if}

  <div class="main">
    {#if wide || (head?.kept && !listing && session === null)}
      <header class="top">
        {#if wide}
          <button
            class="orden-glyph"
            title={t('Chats')}
            aria-label={t('Chats')}
            aria-pressed={railed}
            onclick={toggleRail}
          >
            <svg viewBox="0 0 13 13" aria-hidden="true"
              ><path
                d="M2.6 2.2h7.8a1 1 0 0 1 1 1v6.6a1 1 0 0 1-1 1H2.6a1 1 0 0 1-1-1V3.2a1 1 0 0 1 1-1zM5 2.2v8.6"
              /></svg
            >
          </button>
        {/if}
        {#if !wide && head?.kept && !listing}
          <button
            class="orden-glyph"
            title={t('Back')}
            aria-label={t('Back')}
            onclick={() => chat.newThread()}
          >
            <svg class="orden-mirror" viewBox="0 0 13 13" aria-hidden="true"
              ><path d="M8 3.2L4.7 6.5 8 9.8" /></svg
            >
          </button>
        {/if}
        {#if head?.kept && !listing && session === null}
          <button class="title" onclick={titleMenu} aria-haspopup="menu">
            <span>{head.title || t('Untitled')}</span>
            <svg viewBox="0 0 13 13"><path d="M3.8 5.2l2.7 2.7 2.7-2.7" /></svg>
          </button>
        {/if}
        <span class="gap"></span>
        {#if wide && !railed}
          <button
            class="orden-glyph"
            title={shortcuts.tooltip(t('New chat'), 'ai.new')}
            aria-label={t('New chat')}
            onclick={() => chat.newThread()}
          >
            <svg viewBox="0 0 13 13" aria-hidden="true"
              ><path
                d="M10.9 6.9v3.1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.1a1 1 0 0 1 1-1h3.1M9.3 1.8l1.9 1.9-4.6 4.6-2.5.6.6-2.5z"
              /></svg
            >
          </button>
        {/if}
      </header>
    {/if}

    {#if listing}
      <Threads />
    {:else if session !== null}
      {#if !wide}
        <header class="top">
          <button
            class="orden-glyph"
            title={t('Back')}
            aria-label={t('Back')}
            onclick={() => chat.showThreads()}
          >
            <svg class="orden-mirror" viewBox="0 0 13 13" aria-hidden="true"
              ><path d="M8 3.2L4.7 6.5 8 9.8" /></svg
            >
          </button>
        </header>
      {/if}
      {#await agentSession() then { default: AgentSession }}
        {#key session}
          <AgentSession agent={session} />
        {/key}
      {/await}
    {:else}
      <Conversation {ongoto} {ready} />
      {#if ready}
        <Composer />
      {/if}
    {/if}
  </div>
</div>

<style>
  .ask {
    --ground: var(--side-bar-bg-color);

    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
  }

  .ask.wide {
    --column: 48rem;
    --ground: var(--bg);

    height: 100%;
    background: var(--bg);
  }

  .main {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .shelf {
    flex: none;
    display: flex;
    width: 16rem;
    padding-top: var(--space-2);
    border-inline-end: 1px solid var(--line);
    background: var(--surface);
  }

  .top {
    flex: none;
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    padding: 0 var(--space-1) var(--space-1);
  }

  .ask.wide .top {
    padding: var(--space-2) var(--space-2) var(--space-1);
  }

  .top svg {
    stroke-width: 1.3;
  }

  .gap {
    flex: 1;
  }

  .title {
    flex: 0 1 auto;
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    padding: 2px var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    text-align: start;
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .title span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title svg {
    flex: none;
    width: 11px;
    height: 11px;
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  @media (hover: hover) {
    .title:hover {
      background: var(--surface-hover);
    }
  }
</style>
