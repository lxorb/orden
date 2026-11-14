<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { account } from './accounts/src/api'
  import { joining } from './joining.svelte'
  import { dur, fade, LAYER, scale } from './motion'
  import { overlays } from './overlays'
  import { trap } from './trap'

  const invitation = $derived(joining.invitation)
  const who = $derived(invitation?.from ?? 'Somebody')

  const shared = $derived(
    invitation ? `${who} shared ${invitation.note ?? invitation.space} with you` : null,
  )

  function close() {
    if (joining.step === 'waiting' || joining.step === 'asking') joining.close()
    else joining.dismiss()
  }

  $effect(() => (joining.shown ? overlays.show(close) : undefined))
</script>

{#if joining.shown}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="orden-scrim scrim" transition:fade={{ duration: LAYER.fade }} onclick={close}></div>

  <div
    class="orden-screen panel"
    use:trap
    role="dialog"
    aria-modal="true"
    aria-label={shared ?? 'Shared with you'}
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    {#if shared}
      <p class="shared">{shared}</p>
    {/if}

    {#if joining.step === 'asking'}
      <form
        onsubmit={(event) => {
          event.preventDefault()
          void joining.tell()
        }}
      >
        <!-- svelte-ignore a11y_autofocus -->
        <input
          bind:value={joining.told}
          type="text"
          autocomplete="name"
          placeholder="Your name"
          aria-label="Your name"
          spellcheck="false"
          autofocus
          required
        />
        <button class="orden-button" type="submit" disabled={joining.busy || !joining.told.trim()}>
          {joining.busy ? 'Asking' : 'Ask to join'}
        </button>
      </form>
    {:else if joining.step === 'waiting'}
      <p class="quiet">
        <span class="pulse"></span>
        Waiting for {who}
      </p>
      <div class="actions">
        <button type="button" class="orden-button is-quiet" onclick={() => void joining.cancel()}
          >Cancel</button
        >
        <button type="button" class="orden-button is-quiet" onclick={() => joining.close()}
          >Close</button
        >
      </div>
    {:else if joining.step === 'declined'}
      <p class="quiet">{who} did not let you in</p>
      <button type="button" class="orden-button is-quiet" onclick={() => joining.dismiss()}
        >Done</button
      >
    {:else if joining.step === 'unreached'}
      <div class="actions">
        <button
          type="button"
          class="orden-button"
          disabled={joining.busy}
          onclick={() => void joining.retry()}>Try again</button
        >
        <button type="button" class="orden-button is-quiet" onclick={() => joining.dismiss()}
          >Close</button
        >
      </div>
    {:else}
      <p class="quiet">That link does not open anything</p>
      <button
        class="orden-button"
        type="button"
        onclick={() => {
          joining.dismiss()
          account.open = true
        }}
      >
        Sign in
      </button>
    {/if}

    {#if joining.error}
      <p class="wrong" transition:fade={{ duration: dur(140) }}>{joining.error}</p>
    {/if}
  </div>
{/if}

<style>
  .scrim {
    --scrim-z: var(--z-screen);
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    z-index: var(--z-screen);
    padding: var(--space-5);
  }

  .shared {
    margin: 0;
    font-size: var(--text-sm);
    line-height: 1.5;
    color: var(--muted-strong);
  }

  .quiet {
    display: flex;
    align-items: center;
    gap: 9px;
    margin: 0;
    font-size: var(--text-base);
    color: var(--text);
  }

  .pulse {
    width: 7px;
    height: 7px;
    flex: none;
    border-radius: 50%;
    background: var(--accent);
    animation: breathe 1.8s var(--ease-out) infinite;
  }

  @keyframes breathe {
    0%,
    100% {
      opacity: 0.3;
      transform: scale(0.85);
    }
    50% {
      opacity: 1;
      transform: scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pulse {
      animation: none;
    }
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  input {
    width: 100%;
    min-height: var(--row-height);
    padding: var(--space-3);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    transition:
      border-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  input::placeholder {
    color: var(--muted);
  }

  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }

  .wrong {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--danger);
  }

  :global([data-touch]) .panel {
    top: auto;
    bottom: var(--keyboard);
    left: 0;
    translate: none;
    width: 100%;
    max-height: min(88dvh, calc(100dvh - var(--keyboard) - var(--inset-top)));
    overflow-y: auto;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    padding-bottom: max(
      var(--space-5),
      calc(var(--space-5) + var(--inset-bottom) - var(--keyboard))
    );
  }
</style>
