<script lang="ts">
  /** Send feedback (#548): what went wrong, in somebody's own words, and a line saying
   *  what goes with it. Send is off while there is nothing written, says it is sending
   *  while it is, and the sheet goes once the service has the report; what the service
   *  said, when it said no, stays above the buttons. See feedback.svelte.ts. */
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { closeOnBack } from './backstack.svelte'
  import { feedback } from './feedback.svelte'
  import { t } from './i18n.svelte'
  import { LAYER } from './motion'
  import { overlays } from './overlays'
  import { trap } from './trap'

  /** How long the sheet says it sent before it goes: long enough to read the word. */
  const SAID_FOR = 900

  let text = $state('')
  let sending = $state(false)
  let sent = $state(false)
  let error = $state<string | null>(null)

  // Escape and Back close it, like everything else the app puts over a note.
  $effect(() => (feedback.open ? overlays.show(() => feedback.close()) : undefined))
  $effect(() => closeOnBack(feedback.open, () => feedback.close()))

  // A fresh sheet each time it opens: nothing left from the last report.
  $effect(() => {
    if (!feedback.open) return
    text = ''
    sending = false
    sent = false
    error = null
  })

  async function send() {
    if (!text.trim() || sending) return
    sending = true
    error = null
    try {
      await feedback.send(text)
      sent = true
      setTimeout(() => feedback.close(), SAID_FOR)
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message : String(thrown)
    } finally {
      sending = false
    }
  }
</script>

{#if feedback.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="nib-scrim scrim"
    transition:fade={{ duration: LAYER.fade }}
    onclick={() => feedback.close()}
  ></div>

  <div
    class="nib-screen sheet"
    use:trap
    role="dialog"
    aria-modal="true"
    aria-label={t('Send feedback')}
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    <form
      onsubmit={(event) => {
        event.preventDefault()
        void send()
      }}
    >
      <p class="title">{t('Send feedback')}</p>

      <!-- svelte-ignore a11y_autofocus -->
      <textarea
        bind:value={text}
        placeholder={t('Describe the issue')}
        aria-label={t('Describe the issue')}
        rows="6"
        autofocus
        disabled={sending || sent}
        onkeydown={(event) => {
          // Ctrl or Cmd with Enter sends, as a message box does; Enter alone is a line.
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            void send()
          }
        }}></textarea>

      <p class="detail">
        {t(
          'This report includes your description, Orden’s version, your platform and the recent app log. It never includes your notes.',
        )}
      </p>

      {#if error}
        <p class="error" role="alert">{error}</p>
      {/if}

      <div class="row">
        <button type="button" class="nib-button is-quiet" onclick={() => feedback.close()}
          >{t('Cancel')}</button
        >
        <button type="submit" class="nib-button" disabled={!text.trim() || sending || sent}>
          {sent ? t('Sent') : t('Send')}
        </button>
      </div>
    </form>
  </div>
{/if}

<style>
  /* `.nib-screen` in the themes package, at the width a question takes; see
     PromptSheet.svelte. */
  .sheet {
    --screen-width: var(--screen-ask);

    z-index: var(--z-sheet);
    padding: var(--space-5);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  /* The field a question's sheet types into (PromptSheet.svelte), a few lines tall. */
  textarea {
    width: 100%;
    min-height: 7.5rem;
    resize: vertical;
    padding: 10px 12px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    line-height: 1.45;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  textarea::placeholder {
    color: var(--muted);
  }

  .detail,
  .error {
    margin: 0;
    font-size: var(--text-sm);
    line-height: 1.5;
    color: var(--muted-strong);
  }

  .error {
    color: var(--danger);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  /* Standing on the keyboard while it is up, as a question's sheet does; see
     PromptSheet.svelte. */
  :global([data-touch]) .sheet {
    top: auto;
    bottom: var(--keyboard);
    left: 0;
    translate: none;
    width: 100%;
    max-height: min(88dvh, calc(100dvh - var(--keyboard) - var(--inset-top)));
    overflow-y: auto;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    padding-bottom: var(--touch-bottom);
  }

  :global([data-touch]) textarea,
  :global([data-touch]) .title {
    font-size: var(--touch-text);
  }

  :global([data-touch]) textarea {
    padding: var(--touch-pad);
  }
</style>
