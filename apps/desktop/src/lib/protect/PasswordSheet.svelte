<script lang="ts">
  import Sheet from '../Sheet.svelte'
  import { t } from '../i18n.svelte'

  const {
    choosing,
    title,
    check,
    onanswer,
  }: {
    choosing: boolean
    title: string
    check: (typed: string) => Promise<boolean>
    onanswer: (typed: string | null) => void
  } = $props()

  let open = $state(true)
  let typed = $state('')
  let again = $state('')
  let wrong = $state(false)
  let busy = $state(false)

  const MIN = 4
  const ready = $derived(choosing ? typed.length >= MIN && typed === again : typed.length > 0)

  function close(answer: string | null) {
    if (!open) return
    open = false
    onanswer(answer)
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    if (!ready || busy) return
    if (choosing) {
      close(typed)
      return
    }
    busy = true
    const opened = await check(typed)
    busy = false
    if (opened) close(typed)
    else {
      wrong = true
      typed = ''
    }
  }
</script>

<Sheet {open} {title} onclose={() => close(null)}>
  <form class="stack" onsubmit={submit}>
    <div class="card stack">
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="field"
        type="password"
        autofocus
        autocomplete={choosing ? 'new-password' : 'current-password'}
        placeholder={choosing ? t('New password') : t('Password')}
        aria-label={choosing ? t('New password') : t('Password')}
        bind:value={typed}
        oninput={() => (wrong = false)}
      />
      {#if choosing}
        <input
          class="field"
          type="password"
          autocomplete="new-password"
          placeholder={t('Repeat it')}
          aria-label={t('Repeat it')}
          bind:value={again}
        />
      {/if}
      {#if wrong}
        <p class="hint bad" role="alert">{t('Wrong password')}</p>
      {:else if choosing && again && typed !== again}
        <p class="hint bad">{t('The two don’t match')}</p>
      {/if}
    </div>
    <p class="note">
      {t('Protected, not encrypted: this only keeps it from being opened by accident.')}
    </p>
    <div class="actions">
      <button class="nib-button" type="submit" disabled={!ready || busy}>
        {choosing ? t('Protect') : t('Unlock')}
      </button>
    </div>
  </form>
</Sheet>

<style>
  .actions {
    display: flex;
    justify-content: flex-end;
    padding: 0 var(--space-2);
  }
</style>
