<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { menu, dropOver, isTreeDrag } from '../../ui-kit/src/api'
  import { dur, fly } from '../../platform/src/api'
  import { hearAgain, shortcuts } from '../../shortcuts/src/api'
  import { ai } from '../../ai-providers/src/api'
  import { agentMarks, type Tab, workspace } from '../../workspace/src/api'
  import { agentSession } from '../../surfaces/src/api'
  import { following, toggleFollow, chat, side, railOpen } from './chat-parts'
  import { rememberRail, chatToTab } from './chat-parts'
  import Composer from './Composer.svelte'
  import Conversation from './Conversation.svelte'
  import QuickQuestion from './QuickQuestion.svelte'
  import { dropRows } from './drop'
  import { setHost } from './host'
  import Threads from './Threads.svelte'

  const {
    ongoto,
    wide = false,
    tab,
  }: { ongoto?: ((line: number) => void) | undefined; wide?: boolean; tab?: Tab } = $props()

  const host = untrack(() => tab?.id ?? (wide ? 'tab' : 'side'))
  setHost(host)

  let turning = $state(false)
  const bound = $derived(!tab || (tab.address ?? null) === (chat.head?.kept ? chat.head.id : null))
  const shown = $derived(bound || turning || chat.host === host)
  const front = $derived(
    !!tab && workspace.panes.focusedId === tab.paneId && workspace.panes.at(tab.paneId)?.activeTabId === tab.id,
  )

  $effect(() => {
    if (front) untrack(claim)
  })

  $effect(() => {
    const head = chat.head
    if (!tab || turning || chat.host !== host) return
    const id = head?.kept ? head.id : undefined
    const name = head?.kept ? head.title || 'Untitled' : 'New chat'
    if (tab.address === id && tab.name === name) return
    untrack(() => {
      tab.address = id
      tab.name = name
      workspace.persist()
    })
  })

  let root = $state<HTMLElement>()
  let railed = $state(railOpen())
  const ready = $derived(ai.providerFor('ask') !== null)
  const head = $derived(chat.head)
  const listing = $derived(chat.listing && !wide)
  const empty = $derived(!chat.turns.length && !chat.busy && !chat.pending[head?.id ?? ''])
  const session = $derived(listing ? null : agentMarks.open)
  $effect(() => {
    if (agentMarks.open !== null) untrack(() => (chat.listing = false))
  })

  const BACK = 'M8 3.2L4.7 6.5 8 9.8'
  const RAIL = 'M2.6 2.2h7.8a1 1 0 0 1 1 1v6.6a1 1 0 0 1-1 1H2.6a1 1 0 0 1-1-1V3.2a1 1 0 0 1 1-1zM5 2.2v8.6'
  const NEW = 'M10.9 6.9v3.1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.1a1 1 0 0 1 1-1h3.1M9.3 1.8l1.9 1.9-4.6 4.6-2.5.6.6-2.5z'

  function toggleRail() {
    railed = !railed
    rememberRail(railed)
  }

  function titleMenu(event: MouseEvent) {
    const thread = chat.thread
    menu.show(event, [
      { label: 'Rename', asks: true, run: () => void chat.rename() },
      ...(thread ? [{ label: 'Follow', checked: following(thread), run: () => toggleFollow(thread) }] : []),
      { label: 'Branch', run: () => chat.branch() },
      { label: 'Save as a note', run: () => void chat.exportThread() },
      ...(wide ? [] : [{ label: 'Open in new tab', run: chatToTab }]),
      { label: 'Archive', run: () => chat.archive() },
      { label: 'Delete', danger: true, run: () => void chat.remove() },
    ])
  }

  function claim() {
    if (chat.host !== host) {
      chat.popover = null
      chat.host = host
    }
    if (!tab || turning) return
    const want = tab.address
    if (!bound && !want) chat.newThread()
    if (bound || !want) {
      chat.listing = true
      return
    }
    turning = true
    void chat.openThread(want, false).finally(() => {
      turning = false
      if (chat.head?.id !== want) {
        tab.address = undefined
        chat.newThread()
      }
      chat.listing = true
    })
  }

  onMount(() => {
    if (!tab) chat.host = host
    hearAgain(() => {
      const at = document.activeElement
      const box = root
      if (!box?.contains(at) || listing || at?.tagName !== 'TEXTAREA') return false
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
      if (chat.host === host && !front) chat.host = 'side'
    }
  })
</script>

{#snippet glyph(title: string, label: string, run: () => void, path: string, pressed?: boolean)}
  <button class="orden-glyph" {title} aria-label={label} aria-pressed={pressed} onclick={run}>
    <svg viewBox="0 0 13 13" aria-hidden="true"><path d={path} /></svg>
  </button>
{/snippet}

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
    {#if shown && (wide || (head?.kept && !listing && session === null))}
      <header class="top">
        {#if wide}
          {@render glyph('Chats', 'Chats', toggleRail, RAIL, railed)}
        {/if}
        {#if !wide && head?.kept && !listing}
          {@render glyph('Back', 'Back', () => chat.newThread(), BACK)}
        {/if}
        {#if head?.kept && !listing && session === null}
          <button class="title" onclick={titleMenu} aria-haspopup="menu">
            <span>{head.title || 'Untitled'}</span>
            <svg viewBox="0 0 13 13"><path d="M3.8 5.2l2.7 2.7 2.7-2.7" /></svg>
          </button>
        {/if}
        <span class="gap"></span>
        {#if wide && !railed}
          {@render glyph(shortcuts.tooltip('New chat', 'ai.new'), 'New chat', () => chat.newThread(), NEW)}
        {/if}
      </header>
    {/if}
    {#if !shown}
      <button class="elsewhere" onclick={claim}>
        <span>{tab?.name ?? 'Untitled'}</span>
        <span class="hint">Click to continue this chat here</span>
      </button>
    {:else if listing}
      <Threads quiet={chat.host !== host} />
    {:else if session !== null}
      {#if !wide}
        <header class="top">
          {@render glyph('Back', 'Back', () => chat.showThreads(), BACK)}
        </header>
      {/if}
      {#await agentSession() then AgentSession}
        {#key session}
          <AgentSession agent={session} />
        {/key}
      {/await}
    {:else}
      <Conversation {ongoto} {ready} />
      {#if ready && side.of !== null && side.of === head?.id && chat.host === host}
        <QuickQuestion quick={side} docked />
      {/if}
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

  .elsewhere {
    margin: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    color: var(--text);
  }

  .elsewhere .hint {
    color: var(--muted);
    font-size: var(--text-sm);
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
