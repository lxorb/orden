<script lang="ts">
  import ShieldCheck from 'lucide/dist/esm/icons/shield-check.mjs'
  import { message } from '../ui-kit/src/api'
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
  title="Set up Pass"
  line="Your Pass password encrypts everything in Pass. Nobody can reset it for you."
>
  <form onsubmit={made}>
    <input
      class="orden-field"
      type="password"
      autocomplete="new-password"
      placeholder="Pass password"
      aria-label="Pass password"
      aria-invalid={short}
      bind:value={password}
    />
    <StrengthMeter {password} />
    <input
      class="orden-field"
      type="password"
      autocomplete="new-password"
      placeholder="Type it again"
      aria-label="Type it again"
      aria-invalid={differ}
      bind:value={again}
    />
    {#if short}
      <p class="wrong" role="alert">At least {LEAST} characters</p>
    {:else if differ}
      <p class="wrong" role="alert">The two passwords differ</p>
    {:else if wrong}
      <p class="wrong" role="alert">{wrong}</p>
    {/if}
    <button
      class="orden-button"
      type="submit"
      disabled={busy || password.length < LEAST || again !== password}
      aria-busy={busy}
    >
      {busy ? 'Setting up…' : 'Continue'}
    </button>
  </form>
</Gate>
