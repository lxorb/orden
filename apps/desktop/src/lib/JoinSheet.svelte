<script lang="ts">
  /** The join page, which is a page only when it has something to say.
   *
   *  Most links say nothing: they establish the session, land in the space, and
   *  this draws nothing at all. What is left is the three moments where somebody
   *  is owed a word - a link that asks one thing, the wait on the owner, and a
   *  link that has stopped opening anything - and each of them is one line.
   *
   *  The panel is the sign-in's panel, because it is the same moment in the same
   *  place and a second shape for it would only be a second shape. */
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { account } from './account.svelte'
  import { joining } from './joining.svelte'
  import { t } from './i18n.svelte'

  const invitation = $derived(joining.invitation)
  const who = $derived(invitation?.from ?? t('Somebody'))

  /** What the link was about, when the link said. The one sentence every state
   *  here sits under. */
  const shared = $derived(
    invitation ? t('{who} shared {space} with you', { who, space: invitation.space }) : null,
  )
</script>

{#if joining.step}
  <div class="scrim" transition:fade={{ duration: 140 }}></div>

  <div
    class="panel"
    role="dialog"
    aria-modal="true"
    aria-label={shared ?? t('Shared with you')}
    transition:scale={{ duration: 200, start: 0.96, easing: cubicOut }}
  >
    {#if shared}
      <p class="shared">{shared}</p>
    {/if}

    {#if joining.step === 'asking'}
      <!-- One field, and either half of it will do: the owner has to have
           something to accept. -->
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
          placeholder={t('Your name')}
          aria-label={t('Your name')}
          spellcheck="false"
          autofocus
          required
        />
        <button type="submit" disabled={joining.busy || !joining.told.trim()}>
          {joining.busy ? t('Asking') : t('Ask to join')}
        </button>
      </form>
    {:else if joining.step === 'waiting'}
      <p class="quiet">
        <span class="pulse"></span>
        {t('Waiting for {who}', { who })}
      </p>
    {:else if joining.step === 'declined'}
      <p class="quiet">{t('{who} did not let you in', { who })}</p>
      <button type="button" class="plain" onclick={() => joining.dismiss()}>{t('Done')}</button>
    {:else}
      <p class="quiet">{t('That link does not open anything')}</p>
      <button
        type="button"
        onclick={() => {
          joining.dismiss()
          account.open = true
        }}
      >
        {t('Sign in')}
      </button>
    {/if}

    {#if joining.error}
      <p class="wrong" transition:fade={{ duration: 140 }}>{joining.error}</p>
    {/if}
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    backdrop-filter: blur(3px);
    z-index: 30;
  }

  .panel {
    position: fixed;
    top: 22vh;
    left: 50%;
    translate: -50% 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: min(23rem, calc(100vw - 3rem));
    z-index: 31;
    padding: var(--space-5);
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
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

  /* Something is happening and nobody has to watch it. */
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

  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  input {
    width: 100%;
    padding: 11px 13px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    outline: none;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  input::placeholder {
    color: var(--muted);
  }

  button {
    padding: 10px 14px;
    border: none;
    border-radius: var(--radius-md);
    background: var(--accent);
    color: #fff;
    font-family: var(--font-ui);
    font-size: var(--text-base);
    font-weight: 550;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-spring);
  }

  button:hover:not(:disabled) {
    background: var(--accent-hover);
    transform: translateY(-1px);
  }

  button:active:not(:disabled) {
    background: var(--accent-press);
    transform: translateY(0);
  }

  button:disabled {
    opacity: 0.55;
  }

  .plain {
    background: var(--surface-2);
    color: var(--text);
  }

  .plain:hover:not(:disabled) {
    background: var(--surface-3);
  }

  .wrong {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--danger);
  }

  :global([data-touch]) .panel {
    top: auto;
    bottom: 0;
    left: 0;
    translate: none;
    width: 100%;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    padding-bottom: calc(var(--space-5) + var(--inset-bottom));
  }
</style>
