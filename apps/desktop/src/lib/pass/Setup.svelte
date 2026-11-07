<script lang="ts">
  import ShieldCheck from 'lucide/dist/esm/icons/shield-check.mjs'
  import { message, t } from '../i18n.svelte'
  import Gate from './Gate.svelte'
  import { pass } from './store.svelte'
  import StrengthMeter from './StrengthMeter.svelte'

  const { onmade }: { onmade: (recovery: string) => void } = $props()

  const LEAST = 8

  let password = $state('')
  let again = $state('')
  let busy = $state(false)
  let wrong = $state('')

  const short = $derived(password.length > 0 && password.length < LEAST)
  const differ = $derived(again.length > 0 && again !== password)

  async function made(event: SubmitEvent) {
    event.preventDefault()
    if (busy || password.length < LEAST || again !== password) return
    busy = true
    wrong = ''
    try {
      onmade(await pass.setup(password))
    } catch (error) {
      wrong = message(error, 'Pass could not be set up.')
    } finally {
      busy = false
    }
  }
</script>

<Gate
  icon={ShieldCheck}
  title={t('Set up Pass')}
  line={t('Your Pass password encrypts everything in Pass. Nobody can reset it for you.')}
>
  <form onsubmit={made}>
    <input
      class="orden-field"
      type="password"
      autocomplete="new-password"
      placeholder={t('Pass password')}
      aria-label={t('Pass password')}
      aria-invalid={short}
      bind:value={password}
    />
    <StrengthMeter {password} />
    <input
      class="orden-field"
      type="password"
      autocomplete="new-password"
      placeholder={t('Type it again')}
      aria-label={t('Type it again')}
      aria-invalid={differ}
      bind:value={again}
    />
    {#if short}
      <p class="wrong" role="alert">{t('At least {count} characters', { count: LEAST })}</p>
    {:else if differ}
      <p class="wrong" role="alert">{t('The two passwords differ')}</p>
    {:else if wrong}
      <p class="wrong" role="alert">{wrong}</p>
    {/if}
    <button
      class="orden-button"
      type="submit"
      disabled={busy || password.length < LEAST || again !== password}
      aria-busy={busy}
    >
      {busy ? t('Setting up…') : t('Continue')}
    </button>
  </form>
</Gate>
