<script lang="ts">
  import Lock from 'lucide/dist/esm/icons/lock.mjs'
  import { deviceName } from '../protect/device'
  import Gate from './Gate.svelte'
  import { pass, PIN_TRIES, type Unlock } from './store.svelte'

  const { focused = false }: { focused?: boolean } = $props()

  type Way = 'password' | 'pin' | 'device' | 'recovery'

  let way = $state<Way>(pass.settings.lock)
  let typed = $state('')
  let busy = $state(false)
  let wrong = $state(false)
  let shaking = $state(false)
  let field = $state<HTMLInputElement>()

  $effect(() => {
    if (pass.settings.lock === 'password' && (way === 'pin' || way === 'device')) way = 'password'
  })

  $effect(() => {
    if (focused && way !== 'device') field?.focus({ preventScroll: true })
  })

  function asked(): Unlock {
    switch (way) {
      case 'password':
        return { password: typed }
      case 'pin':
        return { pin: typed }
      case 'recovery':
        return { recovery: typed }
      case 'device':
        return { device: true }
    }
  }

  async function opened(event?: SubmitEvent) {
    event?.preventDefault()
    if (busy || (way !== 'device' && typed === '')) return
    busy = true
    const ok = await pass.unlock(asked())
    busy = false
    wrong = !ok
    if (ok) return
    typed = ''
    shaking = false
    requestAnimationFrame(() => (shaking = true))
    field?.focus()
  }

  function use(next: Way) {
    way = next
    typed = ''
    wrong = false
  }

  const wrongWord = $derived.by(() => {
    switch (way) {
      case 'pin':
        return 'Wrong PIN'
      case 'recovery':
        return 'That recovery key does not open Pass'
      case 'password':
      case 'device':
        return 'Wrong password'
    }
  })
</script>

<Gate icon={Lock} title="Pass is locked">
  {#if way === 'device'}
    <button class="orden-button" type="button" disabled={busy} onclick={() => void opened()}>
      Use {deviceName()}
    </button>
  {:else}
    <form class:shake={shaking} onsubmit={opened} onanimationend={() => (shaking = false)}>
      <input
        bind:this={field}
        bind:value={typed}
        class="orden-field"
        type={way === 'recovery' ? 'text' : 'password'}
        inputmode={way === 'pin' ? 'numeric' : undefined}
        autocomplete={way === 'password' ? 'current-password' : 'off'}
        spellcheck="false"
        placeholder={way === 'pin' ? 'PIN' : way === 'recovery' ? 'Recovery key' : 'Pass password'}
        aria-label={way === 'pin' ? 'PIN' : way === 'recovery' ? 'Recovery key' : 'Pass password'}
        aria-invalid={wrong}
        oninput={() => (wrong = false)}
      />
      <button class="orden-button" type="submit" disabled={busy || typed === ''} aria-busy={busy}>
        {busy ? 'Unlocking…' : 'Unlock'}
      </button>
    </form>
  {/if}
  {#if wrong}
    <p class="wrong" role="alert">{wrongWord}</p>
  {/if}
  {#if pass.error}
    <p class="wrong" role="alert">{pass.error}</p>
  {/if}
  {#if way === 'pin' && pass.pinTries < PIN_TRIES}
    <p class="tries">
      {pass.pinTries === 1 ? '1 try left' : `${pass.pinTries} tries left`}
    </p>
  {/if}
  {#if way !== 'password'}
    <button class="orden-action" type="button" onclick={() => use('password')}>Use password</button>
  {/if}
  {#if way === 'password' && pass.settings.lock !== 'password'}
    <button class="orden-action" type="button" onclick={() => use(pass.settings.lock)}>
      {pass.settings.lock === 'pin' ? 'Use PIN' : `Use ${deviceName()}`}
    </button>
  {/if}
  {#if way !== 'recovery'}
    <button class="orden-action" type="button" onclick={() => use('recovery')}
      >Use recovery key</button
    >
  {/if}
</Gate>

<style>
  .tries {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--callout-warning);
  }
</style>
