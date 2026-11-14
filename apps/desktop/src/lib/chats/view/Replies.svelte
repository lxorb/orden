<script lang="ts">
  import type { Message } from '@orden/chats'
  import { may } from '@orden/chats'
  import { onMount } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { localNumber } from '../../platform/src/api'
  import { dur, fly } from '../../platform/src/api'
  import { menu } from '../../menu.svelte'
  import type { ChatPage } from './chat.svelte'
  import Composer from './Composer.svelte'
  import { Glyph } from '../../chat-kit/src/api'
  import { messageMenu } from './message-menu'
  import MessageRow from './MessageRow.svelte'
  import { rowsOf } from './rows'
  import { dayOf } from './when'

  const {
    page,
    parent,
    space,
    path,
    width,
    onclose,
    onpicker,
    onfiles,
  }: {
    page: ChatPage
    parent: string
    space: string | null
    path: string | null
    width: number
    onclose: () => void
    onpicker: (from: HTMLElement, insert: (emoji: string) => void) => void
    onfiles: (message: Message, index: number) => void
  } = $props()

  let scroller = $state<HTMLElement>()
  let composer = $state<{ focus: () => void }>()

  const replies = page.view.replies(parent)

  onMount(() => {
    composer?.focus()
    return () => replies.close()
  })

  $effect(() => {
    if (!items.length) return
    queueMicrotask(() => scroller?.scrollTo({ top: scroller.scrollHeight }))
  })

  const items = $derived(
    rowsOf({
      messages: replies.messages,
      outbox: replies.pending,
      me: page.me,
      readAtOpen: null,
      dayOf,
      reads: new Map(),
    }).filter((item) => item.kind === 'message'),
  )
  const canPost = $derived(may(page.view.role, 'post', page.view.meta.posting))

  function showMenu(event: MouseEvent, message: Message) {
    menu.show(
      event,
      messageMenu(page, message, page.view.role, {
        reply: () => composer?.focus(),
        quote: () => composer?.focus(),
        edit: () => {
          page.aside = { kind: 'edit', message }
          onclose()
        },
      }),
    )
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside
  class="replies"
  aria-label="Replies"
  transition:fly={{ x: 24, duration: dur(190), easing: cubicOut }}
  onkeydown={(event) => {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault()
      onclose()
    }
  }}
>
  <header class="top">
    <Glyph name="replies" />
    <span class="title">Replies</span>
    <span class="count">{localNumber(replies.messages.length)}</span>
    <button type="button" class="orden-glyph" aria-label="Close" onclick={onclose}
      ><Glyph name="close" /></button
    >
  </header>
  <div class="list orden-scrolls" bind:this={scroller}>
    {#if replies.parent}
      <MessageRow
        message={replies.parent}
        head
        pending={false}
        seen={[]}
        {page}
        {space}
        column={width - 72}
        lit={false}
        flashed={false}
        arrivedAfter={Number.MAX_SAFE_INTEGER}
        {canPost}
        inReplies
        onreply={() => composer?.focus()}
        onreact={(message: Message, from: HTMLElement) =>
          onpicker(from, (emoji) => page.react(message, emoji))}
        onmenu={showMenu}
        {onfiles}
      />
      <div class="rule" role="separator"><span>{localNumber(replies.messages.length)}</span></div>
    {/if}
    {#each items as item (item.key)}
      <MessageRow
        message={item.message}
        head={item.head}
        pending={item.pending}
        seen={[]}
        {page}
        {space}
        column={width - 72}
        lit={false}
        flashed={false}
        arrivedAfter={0}
        {canPost}
        inReplies
        onreply={() => composer?.focus()}
        onreact={(message: Message, from: HTMLElement) =>
          onpicker(from, (emoji) => page.react(message, emoji))}
        onmenu={showMenu}
        {onfiles}
      />
    {/each}
  </div>
  {#if canPost}
    <Composer bind:this={composer} {page} {space} {path} {parent} onescape={onclose} {onpicker} />
  {/if}
</aside>

<style>
  .replies {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    border-inline-start: 1px solid var(--line);
    background: var(--surface);
  }

  .top {
    --glyph-size: 15px;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: var(--header-height, 40px);
    padding: 0 var(--space-2) 0 var(--space-4);
    border-bottom: 1px solid var(--line);
    color: var(--muted);
  }

  .title {
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }

  .count {
    flex: 1;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: var(--space-2);
  }

  .rule {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .rule::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--line);
  }
</style>
