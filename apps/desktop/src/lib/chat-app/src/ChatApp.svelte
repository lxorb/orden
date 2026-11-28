<script lang="ts">
  import type { Component } from 'svelte'
  import { account } from '../../accounts/src/api'
  import { Select, SheetMenu, SheetPrompt } from '../../ui-controls/src/api'
  import { closeOnBack } from '../../ui-kit/src/api'
  import { OwnUndo } from '../../undo-toast/src/api'
  import { type ChatNav, WIDE } from './nav.svelte'

  const {
    nav,
    parts,
  }: {
    nav: ChatNav
    parts: {
      ChatsPanel: Component
      ChatTab: Component<{ chat: string; message?: string | null }>
      SignIn: Component<{ name: string; alone: boolean; onsignedin: () => void }>
    }
  } = $props()
  const { ChatsPanel, ChatTab, SignIn } = $derived(parts)
  let wide = $state(0)
  const beside = $derived(wide >= WIDE)
  const signed = $derived(account.token !== null && account.guest === null)
  const spaces = $derived(account.spaces)
  $effect(() => {
    if (signed) nav.settle(spaces.map((one) => one.id))
  })
  $effect(() => closeOnBack(signed && nav.deep && !beside, () => void nav.back()))
</script>

<svelte:window bind:innerWidth={wide} />

{#if !signed}
  <SignIn name="Orden Chat" alone={false} onsignedin={() => account.settled()} />
{:else}
  <div class="chat-app" class:beside data-chat-app={nav.chat === null ? 'list' : 'chat'}>
    {#if beside || nav.chat === null}
      <section class="list" data-chat-pane="list">
        <div class="space">
          <Select
            plain
            label="Space"
            value={nav.space ?? ''}
            options={spaces.map((space) => ({ value: space.id, label: space.name }))}
            onchange={(next: string) => nav.show(next)}
          />
        </div>
        <ChatsPanel />
      </section>
    {/if}
    {#if nav.chat !== null}
      <main class="open" data-chat-pane="chat">
        {#key nav.chat}
          <ChatTab chat={nav.chat} message={nav.message} />
        {/key}
      </main>
    {/if}
    <OwnUndo />
  </div>
  <SheetMenu />
  <SheetPrompt />
{/if}

<style>
  .chat-app {
    position: fixed;
    inset: 0;
    display: flex;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-ui);
  }
  .list,
  .open {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .beside .list {
    flex: 0 0 320px;
    border-inline-end: 1px solid var(--border);
  }
  .space {
    display: flex;
    flex: none;
    align-items: center;
    min-height: 48px;
    padding: 0 12px;
    font-weight: 600;
  }
</style>
