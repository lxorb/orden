<script lang="ts">
  import { t } from '../../i18n.svelte'
  import { openHref } from '../../open-link'
  import { screens } from '../providers/screens.svelte'

  let value = $state('')
  let square = $state<string | null>(null)

  const asking = $derived(screens.asking)
  const screen = $derived(screens.screen)

  $effect(() => {
    const data = screen?.kind === 'qr' ? screen.data : null
    square = null
    if (!data) return
    let current = true
    void import('uqr')
      .then(({ renderSVG }) => {
        if (current) square = renderSVG(data, { border: 2, pixelSize: 6 })
      })
      .catch(() => {
        if (current) square = null
      })
    return () => {
      current = false
    }
  })

  function answer(event: SubmitEvent) {
    event.preventDefault()
    const given = value.trim()
    if (!asking || !given) return
    value = ''
    asking.answer(given)
  }
</script>

{#if screen}
  <div class="screen" role="status">
    <p class="label">{t(screen.label)}</p>
    {#if screen.kind === 'qr'}
      {#if square}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- the square uqr drew from the code the service gave -->
        <div class="square" aria-label={t('QR code')} role="img">{@html square}</div>
      {:else}
        <p class="wait">{t('Waiting…')}</p>
      {/if}
    {:else if screen.kind === 'link'}
      <button type="button" class="orden-button" onclick={() => openHref(screen.url)}
        >{t('Open')}</button
      >
    {:else}
      <p class="wait">{t('Waiting…')}</p>
    {/if}
    {#if screen.note}<p class="note">{t(screen.note)}</p>{/if}
  </div>
{/if}

{#if asking}
  <form class="ask" onsubmit={answer}>
    <label class="field">
      <span>{t(asking.prompt.label)}</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="orden-field"
        type={asking.prompt.kind === 'password'
          ? 'password'
          : asking.prompt.kind === 'phone'
            ? 'tel'
            : 'text'}
        inputmode={asking.prompt.kind === 'code' ? 'numeric' : undefined}
        autocomplete={asking.prompt.kind === 'code'
          ? 'one-time-code'
          : asking.prompt.kind === 'password'
            ? 'current-password'
            : 'off'}
        spellcheck="false"
        autofocus
        bind:value
      />
    </label>
    {#if asking.prompt.note}<p class="note">{t(asking.prompt.note)}</p>{/if}
    <div class="actions">
      <button class="orden-button is-quiet" type="button" onclick={() => asking.cancel()}
        >{t('Cancel')}</button
      >
      <button class="orden-button" type="submit" disabled={!value.trim()}>{t('Continue')}</button>
    </div>
  </form>
{/if}

<style>
  .screen,
  .ask {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
  }

  .label {
    margin: 0;
    color: var(--text-strong);
  }

  .square {
    align-self: center;
    width: min(220px, 100%);
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    background: #fff;
    line-height: 0;
  }

  .square :global(svg) {
    width: 100%;
    height: auto;
  }

  .note,
  .wait {
    margin: 0;
    color: var(--muted);
    overflow-wrap: anywhere;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    color: var(--muted);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
