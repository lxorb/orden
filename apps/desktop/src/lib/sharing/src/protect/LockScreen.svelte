<script lang="ts">
  import Lock from 'lucide/dist/esm/icons/lock.mjs'
  import Icon from '../../../Icon.svelte'
  import { nameOf } from '../../../platform/src/api'
  import { workspace } from '../../../workspace.svelte'
  import { deviceCan, deviceName } from '../../../protect/src/api'
  import { unlockAt, unlockByDevice } from './unlocking'

  const { path, focused = false }: { path: string; focused?: boolean } = $props()

  let typed = $state('')
  let wrong = $state(false)
  let busy = $state(false)
  let field = $state<HTMLInputElement>()
  let device = $state(false)

  const password = $derived(workspace.protection.password !== null)

  $effect(() => {
    void deviceCan().then((can) => (device = can))
  })

  async function byDevice() {
    if (busy) return
    busy = true
    await unlockByDevice(path)
    busy = false
  }

  $effect(() => {
    if (focused) field?.focus({ preventScroll: true })
  })

  async function unlock(event: SubmitEvent) {
    event.preventDefault()
    if (busy || !typed) return
    busy = true
    const opened = await unlockAt(path, typed)
    busy = false
    wrong = !opened
    if (!opened) {
      typed = ''
      field?.focus()
    }
  }
</script>

<div class="locked" data-region="editor" role="group" aria-label="Protected">
  <span class="mark" aria-hidden="true"><Icon icon={null} fallback={Lock} /></span>
  <p class="name">{nameOf(path)}</p>
  {#if device}
    <button class="orden-button" class:is-quiet={password} disabled={busy} onclick={byDevice}>
      Use {deviceName()}
    </button>
  {/if}
  {#if password}
    <form class="unlock" onsubmit={unlock}>
      <input
        bind:this={field}
        bind:value={typed}
        class="orden-field"
        type="password"
        autocomplete="current-password"
        placeholder="Password"
        aria-label="Password"
        aria-invalid={wrong}
        oninput={() => (wrong = false)}
      />
      <button class="orden-button" type="submit" disabled={busy || !typed}>Unlock</button>
    </form>
  {/if}
  {#if wrong}
    <p class="wrong" role="alert">Wrong password</p>
  {/if}
  {#if (wrong || !password) && !device}
    <p class="note">
      Forgot it? The file is still in the space’s folder, and another device can remove the
      protection.
    </p>
  {/if}
  <p class="note">Protected, not encrypted: this only keeps it from being opened by accident.</p>
</div>

<style>
  .locked {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-6);
    font-family: var(--font-ui);
    color: var(--muted);
    text-align: center;
  }

  .mark {
    width: var(--icon-lg);
    height: var(--icon-lg);
    font-size: var(--icon-lg);
    color: var(--muted-strong);
  }

  .name {
    margin: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .unlock {
    display: flex;
    gap: var(--space-2);
    width: min(100%, 320px);
  }

  .unlock .orden-field {
    flex: 1;
    min-width: 0;
  }

  .wrong {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--danger);
  }

  .note {
    margin: 0;
    max-width: 320px;
    font-size: var(--text-sm);
  }
</style>
