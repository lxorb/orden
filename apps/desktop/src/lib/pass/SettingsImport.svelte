<script lang="ts">
  import { guessSource, type Imported, SOURCES, type SourceId } from '@orden/pass/import/index'
  import { message, plural, t } from '../i18n.svelte'
  import Select from '../Select.svelte'
  import { importedFrom, isSealed } from './import-file'
  import { pass } from './store.svelte'

  let source = $state<SourceId>('proton')
  let file = $state<{ name: string; bytes: Uint8Array } | null>(null)
  let passphrase = $state('')
  let imported = $state.raw<Imported | null>(null)
  let into = $state('new')
  let wrong = $state('')
  let busy = $state(false)
  let done = $state<{ added: number; skipped: Imported['skipped'] } | null>(null)
  let picker = $state<HTMLInputElement>()

  const accept = $derived(SOURCES.find((one) => one.id === source)?.accept.join(',') ?? '')
  const sealed = $derived(file !== null && isSealed(source, file.bytes))
  const counted = $derived(imported?.vaults.reduce((sum, one) => sum + one.items.length, 0) ?? 0)

  async function chosen(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const picked = input.files?.[0]
    input.value = ''
    if (!picked) return
    const bytes = new Uint8Array(await picked.arrayBuffer())
    const guessed = guessSource(picked.name, new TextDecoder().decode(bytes.slice(0, 4096)))
    if (guessed) source = guessed
    file = { name: picked.name, bytes }
    imported = null
    done = null
    wrong = ''
    if (!isSealed(source, bytes)) await read()
  }

  async function read() {
    if (!file) return
    busy = true
    wrong = ''
    try {
      imported = await importedFrom(source, file.name, file.bytes, passphrase)
    } catch (error) {
      imported = null
      wrong = message(error, 'This file could not be read.')
    } finally {
      busy = false
    }
  }

  async function brought() {
    if (!imported) return
    busy = true
    try {
      const { added } = await pass.importItems(imported, into)
      done = { added, skipped: imported.skipped }
      imported = null
      file = null
    } catch (error) {
      wrong = message(error, 'The items could not be imported.')
    } finally {
      busy = false
    }
  }
</script>

<div class="card padded">
  <div class="orden-setting">
    <span class="name">{t('Import from')}</span>
    <Select
      label={t('Import from')}
      value={source}
      options={SOURCES.map((one) => ({ value: one.id, label: one.name }))}
      onchange={(value: string) => {
        source = value as SourceId
        imported = null
        if (file) void read()
      }}
    />
  </div>
  <div class="orden-setting">
    <span class="name">{file?.name ?? t('No file chosen')}</span>
    <input
      class="picker"
      type="file"
      {accept}
      bind:this={picker}
      onchange={(event) => void chosen(event)}
    />
    <button class="orden-chip" type="button" onclick={() => picker?.click()}
      >{t('Choose a file')}</button
    >
  </div>
  {#if sealed && !imported}
    <form
      class="orden-setting"
      onsubmit={(event) => {
        event.preventDefault()
        void read()
      }}
    >
      <span class="name">{t('Passphrase')}</span>
      <input
        class="orden-field is-value"
        type="password"
        autocomplete="off"
        placeholder={t('Passphrase')}
        aria-label={t('Passphrase')}
        bind:value={passphrase}
      />
      <button class="orden-chip" type="submit" disabled={busy || passphrase === ''}
        >{t('Open')}</button
      >
    </form>
  {/if}
</div>

{#if wrong}<p class="wrong" role="alert">{wrong}</p>{/if}

{#if imported}
  <h3 class="orden-section">{t('Ready to import')}</h3>
  <div class="card padded preview">
    {#each imported.vaults as vault, index (index)}
      <div class="orden-setting">
        <span class="name">{vault.name}</span>
        <span class="text meta"
          >{plural(vault.items.length, { one: '{count} item', other: '{count} items' })}</span
        >
      </div>
    {/each}
    {#if imported.skipped.length}
      <p class="meta">
        {plural(imported.skipped.length, {
          one: '{count} item cannot be read',
          other: '{count} items cannot be read',
        })}
      </p>
    {/if}
    <div class="orden-setting">
      <span class="name">{t('Into')}</span>
      <Select
        label={t('Into')}
        value={into}
        options={[
          { value: 'new', label: t('A new vault for each') },
          ...pass.vaults.map((one) => ({ value: one.id, label: one.name })),
        ]}
        onchange={(value: string) => (into = value)}
      />
    </div>
    <div class="buttons">
      <button
        class="orden-button"
        type="button"
        disabled={busy || counted === 0}
        onclick={() => void brought()}
      >
        {plural(counted, { one: 'Import {count} item', other: 'Import {count} items' })}
      </button>
    </div>
  </div>
{/if}

{#if done}
  <div class="card padded report" role="status">
    <p class="added">
      {plural(done.added, { one: '{count} item imported', other: '{count} items imported' })}
    </p>
    {#each done.skipped as one, index (index)}
      <p class="meta">{one.title || t('Untitled')}: {one.reason}</p>
    {/each}
  </div>
{/if}

<style>
  .card {
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }

  .card.padded {
    padding: var(--space-2) var(--space-3);
  }

  .picker {
    display: none;
  }

  .orden-section {
    margin: var(--space-3) 0 0;
  }

  .meta {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .wrong {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--danger);
  }

  .buttons {
    display: flex;
    justify-content: flex-end;
    padding-top: var(--space-2);
  }

  .added {
    margin: 0 0 var(--space-1);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }
</style>
