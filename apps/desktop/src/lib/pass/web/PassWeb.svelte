<script lang="ts">
  import KeyRound from 'lucide/dist/esm/icons/key-round.mjs'
  import { onDestroy } from 'svelte'
  import { account } from '../../accounts/src/api'
  import { menu } from '../../menu.svelte'
  import { overlays } from '../../overlays'
  import { prompt } from '../../prompt.svelte'
  import { reloading } from '../../reloading.svelte'
  import { said } from '../../said.svelte'
  import SidebarFoot from '../../SidebarFoot.svelte'
  import { contextMenu, feedbackSheet, promptSheet, signInSheet } from '../../surfaces.svelte'
  import Gate from '../Gate.svelte'
  import PassTab from '../PassTab.svelte'
  import type { PassUi } from '../ui.svelte'
  import { showPassAccount } from './account-menu'
  import { startPassWeb } from './start'

  onDestroy(startPassWeb())

  let looked = $state(false)
  void account.looked.then(() => (looked = true))

  const waiting = $derived(!looked || account.restoring)

  $effect(() => {
    if (menu.open) void contextMenu.ask()
    if (prompt.open) void promptSheet.ask()
    if (account.open) void signInSheet.ask()
  })

  $effect(() => {
    if (!waiting && !account.user) account.open = true
  })
</script>

{#snippet corner(ui: PassUi)}
  <SidebarFoot
    theming={false}
    scratch={false}
    onwho={(event: MouseEvent) => showPassAccount(event, ui)}
    onsettings={() => void ui.goTo('settings')}
  />
{/snippet}

<svelte:window
  onkeydown={(event: KeyboardEvent) => {
    if (event.key === 'Escape') overlays.escape(event)
  }}
  onpointerdowncapture={(event: PointerEvent) => overlays.pressed(event)}
  onclickcapture={(event: MouseEvent) => overlays.clicked(event)}
  onblur={() => overlays.away()}
/>

<main class="pass-web" data-region="pass-web">
  {#if waiting}
    <div class="blank"></div>
  {:else if account.user}
    {#key account.user.id}
      <PassTab tab={null} focused {corner} />
    {/key}
  {:else}
    <Gate icon={KeyRound} title="Orden Pass">
      <button class="orden-button" type="button" onclick={() => (account.open = true)}>
        Sign in
      </button>
    </Gate>
  {/if}
</main>

{#if reloading.offered}
  <div class="reload" role="alert">
    <button class="orden-button" type="button" onclick={() => location.reload()}>Reload</button>
  </div>
{/if}

<p class="orden-said" role="status" aria-live="polite">{said.words}</p>

{#if signInSheet.asked}
  {#await signInSheet.asked then SignIn}
    <SignIn />
  {/await}
{/if}
{#if feedbackSheet.asked}
  {#await feedbackSheet.asked then FeedbackSheet}
    <FeedbackSheet />
  {/await}
{/if}
{#if promptSheet.asked}
  {#await promptSheet.asked then PromptSheet}
    <PromptSheet />
  {/await}
{/if}
{#if contextMenu.asked}
  {#await contextMenu.asked then ContextMenu}
    <ContextMenu />
  {/await}
{/if}

<style>
  .pass-web {
    height: 100dvh;
    padding: var(--inset-top, 0px) var(--inset-right, 0px) 0 var(--inset-left, 0px);
    box-sizing: border-box;
    background: var(--bg);
    color: var(--text);
  }

  .blank {
    height: 100%;
  }

  .reload {
    position: fixed;
    inset-block-end: calc(var(--space-4) + var(--inset-bottom, 0px));
    inset-inline: 0;
    z-index: var(--z-notice);
    display: flex;
    justify-content: center;
    pointer-events: none;
  }

  .reload button {
    pointer-events: auto;
  }
</style>
