<script lang="ts">
  import { deliver } from '../export/save'
  import { message } from '../ui-kit/src/api'
  import { segmented } from '../ui-kit/src/api'
  import { pass } from './store.svelte'

  type Format = 'sealed' | 'json' | 'csv'

  let format = $state<Format>('sealed')
  let password = $state('')
  let passphrase = $state('')
  let again = $state('')
  let busy = $state(false)
  let wrong = $state('')
  let saved = $state('')

  const FORMATS: { id: Format; label: () => string }[] = [
    { id: 'sealed', label: () => 'Encrypted' },
    { id: 'json', label: () => 'JSON' },
    { id: 'csv', label: () => 'CSV' },
  ]

  const ready = $derived(
    password !== '' && (format !== 'sealed' || (passphrase !== '' && passphrase === again)),
  )

  async function exported(event: SubmitEvent) {
    event.preventDefault()
    if (!ready || busy) return
    busy = true
    wrong = ''
    saved = ''
    try {
      const made = await pass.exportAll(
        password,
        format,
        format === 'sealed' ? passphrase : undefined,
      )
      if (!made) {
        wrong = 'Wrong password'
        return
      }
      const dot = made.name.lastIndexOf('.')
      const stem = made.name.slice(0, dot)
      const extension = made.name.slice(dot + 1)
      const mime = format === 'csv' ? 'text/csv' : 'application/json'
      const label = FORMATS.find((one) => one.id === format)?.label() ?? ''
      const where = await deliver(stem, extension, label, { text: made.text, mime })
      if (where) saved = 'Saved'
      password = ''
    } catch (error) {
      wrong = message(error, 'Pass could not be exported.')
    } finally {
      busy = false
    }
  }
</script>

<form class="card padded" onsubmit={exported}>
  <p class="meta">
    Only the vaults you own are exported. A vault shared with you stays with its owner.
  </p>
  <div class="orden-segmented" role="radiogroup" aria-label="Format" use:segmented>
    {#each FORMATS as one (one.id)}
      <button
        type="button"
        role="radio"
        aria-checked={format === one.id}
        class:on={format === one.id}
        onclick={() => (format = one.id)}
      >
        {one.label()}
      </button>
    {/each}
  </div>
  {#if format === 'sealed'}
    <input
      class="orden-field is-value"
      type="password"
      autocomplete="new-password"
      placeholder="Passphrase for the file"
      aria-label="Passphrase for the file"
      bind:value={passphrase}
    />
    <input
      class="orden-field is-value"
      type="password"
      autocomplete="new-password"
      placeholder="Type it again"
      aria-label="Type it again"
      aria-invalid={again !== '' && again !== passphrase}
      bind:value={again}
    />
  {:else}
    <p class="warn">This file is not encrypted. Anyone who has it can read every password.</p>
  {/if}
  <input
    class="orden-field is-value"
    type="password"
    autocomplete="current-password"
    placeholder="Pass password"
    aria-label="Pass password"
    bind:value={password}
    oninput={() => (wrong = '')}
  />
  {#if wrong}<p class="wrong" role="alert">{wrong}</p>{/if}
  {#if saved}<p class="meta" role="status">{saved}</p>{/if}
  <div class="buttons">
    <button class="orden-button" type="submit" disabled={!ready || busy} aria-busy={busy}
      >Export</button
    >
  </div>
</form>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }

  .card.padded {
    padding: var(--space-3);
  }

  .warn {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--callout-warning) 14%, transparent);
    font-size: var(--text-sm);
    color: var(--text-strong);
  }

  .wrong {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--danger);
  }

  .meta {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .buttons {
    display: flex;
    justify-content: flex-end;
  }
</style>
