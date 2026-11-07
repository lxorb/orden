<script lang="ts">
  import { flushSync } from 'svelte'
  import { guessSource, type Imported, SOURCES, type SourceId } from '@orden/pass/import/index'
  import { message, plural, t } from '../i18n.svelte'
  import Select from '../Select.svelte'
  import { importedFrom, isSealed } from './import-file'
  import { kindsOf, markOf, stepsOf } from './import-sources'
  import { pass } from './store.svelte'

  let source = $state<SourceId>('proton')
  let asked = $state(false)
  let file = $state<{ name: string; bytes: Uint8Array } | null>(null)
  let passphrase = $state('')
  let imported = $state.raw<Imported | null>(null)
  let into = $state('new')
  let wrong = $state('')
  let busy = $state(false)
  let done = $state<{ added: number; skipped: Imported['skipped'] } | null>(null)
  let picker = $state<HTMLInputElement>()

  const accept = $derived(SOURCES.find((one) => one.id === source)?.accept.join(',') ?? '')
  const shown = $derived(SOURCES.find((one) => one.id === source))

  function pick(id: SourceId) {
    source = id
    asked = true
    imported = null
    done = null
    wrong = ''
    file = null
    passphrase = ''
    flushSync()
    picker?.click()
  }
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

<h3 class="orden-section">{t('Select your password manager')}</h3>
<div class="sources" role="group" aria-label={t('Select your password manager')}>
  {#each SOURCES as one (one.id)}
    {@const mark = markOf(one.id)}
    <button
      type="button"
      class="source"
      class:on={asked && source === one.id}
      aria-pressed={asked && source === one.id}
      data-source={one.id}
      onclick={() => pick(one.id)}
    >
      <svg class="mark" viewBox="0 0 24 24" aria-hidden="true">
        <rect width="24" height="24" rx="6" fill={mark.fill} />
        <text
          x="12"
          y="12"
          dy="0.36em"
          text-anchor="middle"
          fill={mark.ink}
          font-size={mark.letters.length > 2 ? 7.5 : mark.letters.length > 1 ? 10 : 13}
          >{mark.letters}</text
        >
      </svg>
      <span class="words">
        <span class="title">{one.name}</span>
        <span class="kinds">{kindsOf(one)}</span>
      </span>
    </button>
  {/each}
</div>

{#if asked && shown}
  <p class="steps" data-steps>{stepsOf(shown)}</p>
{/if}

<div class="card padded">
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

  .sources {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: var(--space-2);
  }

  .source {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--text-strong);
    font-family: var(--font-ui);
    text-align: start;
  }

  .source:hover {
    background: var(--surface-hover);
  }

  .source.on {
    border-color: var(--accent);
  }

  .mark {
    flex: none;
    width: 28px;
    height: 28px;
    font-family: var(--font-ui);
    font-weight: 700;
  }

  .words {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .kinds {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .title {
    overflow-wrap: anywhere;
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
  }

  .kinds {
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .steps {
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
    color: var(--muted-strong);
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
