<script lang="ts">
  import { dropOver } from './drag-paths'
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { closeOnBack } from './backstack.svelte'
  import Cross from './Cross.svelte'
  import { feedback } from './feedback.svelte'
  import { MOST_PICTURES, type Picture, pictureOf, picturesAmong } from './feedback-pictures'
  import { t } from './i18n.svelte'
  import { LAYER } from './motion'
  import { followHref } from './open-link'
  import { overlays } from './overlays'
  import { trap } from './trap'

  let text = $state('')
  let pictures = $state<Picture[]>([])
  let sending = $state(false)
  let error = $state<string | null>(null)
  let pictureError = $state<string | null>(null)
  let picker = $state<HTMLInputElement | null>(null)

  const received = $derived(feedback.received)

  $effect(() => (feedback.open ? overlays.show(() => feedback.close()) : undefined))
  $effect(() => closeOnBack(feedback.open, () => feedback.close()))

  $effect(() => {
    if (!feedback.open) return
    text = ''
    pictures = []
    sending = false
    error = null
    pictureError = null
  })

  async function send() {
    if (!text.trim() || sending) return
    sending = true
    error = null
    try {
      await feedback.send(
        text,
        pictures.map((one) => one.dataUrl),
      )
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message : String(thrown)
    } finally {
      sending = false
    }
  }

  async function add(files: Iterable<File>) {
    const given = picturesAmong(files)
    if (!given.length) return
    pictureError = null
    const room = MOST_PICTURES - pictures.length
    if (given.length > room) pictureError = t('That is more than 4 images.')
    for (const file of given.slice(0, Math.max(0, room))) {
      const picture = await pictureOf(file).catch(() => null)
      if (!picture) {
        pictureError = t('That file could not be used as an image.')
        continue
      }
      if (pictures.length < MOST_PICTURES) pictures = [...pictures, picture]
    }
  }

  function remove(id: string) {
    pictures = pictures.filter((one) => one.id !== id)
    pictureError = null
  }

  function pasted(event: ClipboardEvent) {
    const files = event.clipboardData ? picturesAmong(event.clipboardData.files) : []
    if (!files.length) return
    event.preventDefault()
    void add(files)
  }

  function carriesFiles(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes('Files') ?? false
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
    tabindex="-1"
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
    use:dropOver={(event) => {
      if (!received && carriesFiles(event)) event.preventDefault()
    }}
    ondrop={(event) => {
      if (received || !carriesFiles(event)) return
      event.preventDefault()
      void add(event.dataTransfer?.files ?? [])
    }}
  >
    {#if received}
      <div class="received" role="status">
        <p class="title">{t('Report received')}</p>
        {#if received.url}
          <p class="detail">{t('Your report reached us. You can follow it here:')}</p>
          <a
            class="link"
            href={received.url}
            onclick={(event) => {
              event.preventDefault()
              followHref(received.url ?? '', event)
              feedback.close()
            }}>{t('View your report')}</a
          >
        {/if}
        <div class="row">
          <button type="button" class="nib-button" onclick={() => feedback.close()}
            >{t('Done')}</button
          >
        </div>
      </div>
    {:else}
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
          disabled={sending}
          onpaste={pasted}
          onkeydown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              void send()
            }
          }}></textarea>

        {#if pictures.length}
          <ul class="pictures">
            {#each pictures as picture (picture.id)}
              <li>
                <img src={picture.preview} alt="" draggable="false" />
                <button
                  type="button"
                  class="remove"
                  title={t('Remove image')}
                  aria-label={t('Remove image')}
                  disabled={sending}
                  onclick={() => remove(picture.id)}
                >
                  <Cross small />
                </button>
              </li>
            {/each}
          </ul>
        {/if}

        <div class="add">
          <button
            type="button"
            class="nib-chip is-quiet"
            disabled={sending || pictures.length >= MOST_PICTURES}
            onclick={() => picker?.click()}>{t('Add images')}</button
          >
          <input
            bind:this={picker}
            type="file"
            accept="image/*"
            multiple
            hidden
            onchange={(event) => {
              const input = event.currentTarget
              void add(input.files ?? []).finally(() => (input.value = ''))
            }}
          />
        </div>

        {#if pictureError}
          <p class="error" role="alert">{pictureError}</p>
        {/if}

        <p class="detail">
          {t(
            'This report includes your description, Orden’s version, your platform and the recent app log, with file paths removed.',
          )}
        </p>

        {#if error}
          <p class="error" role="alert">
            {t('Not sent. Your text is kept, so you can try again.')}
            {error}
          </p>
        {/if}

        <div class="row">
          <button type="button" class="nib-button is-quiet" onclick={() => feedback.close()}
            >{t('Cancel')}</button
          >
          <button type="submit" class="nib-button" disabled={!text.trim() || sending}>
            {t('Send')}
          </button>
        </div>
      </form>
    {/if}
  </div>
{/if}

<style>
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

  .received {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .link {
    align-self: flex-start;
    color: var(--accent);
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .pictures {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .pictures li {
    position: relative;
  }

  .pictures img {
    display: block;
    width: 72px;
    height: 72px;
    object-fit: cover;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
  }

  .remove {
    position: absolute;
    top: -6px;
    right: -6px;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 1px solid var(--line-strong);
    border-radius: 50%;
    background: var(--bg);
    color: var(--text-strong);
    cursor: pointer;
  }

  .remove :global(svg) {
    width: 8px;
    height: 8px;
    stroke-width: 1.6;
  }

  .add {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
  }

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
