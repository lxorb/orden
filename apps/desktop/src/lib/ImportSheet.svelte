<script lang="ts">
  import { dropOver } from './drag-paths'

  import Facts from './Facts.svelte'
  import { key, plural, t } from './i18n.svelte'
  import { importing, onMac } from './importing.svelte'
  import { droppedFiles, pickFiles } from './import/picking'
  import { type FormatId, worthKnowing } from './import/plan'
  import { dur, fade } from './motion'
  import { settings } from './settings.svelte'
  import { segmented } from './slide'
  import { viewport } from './viewport.svelte'
  import Sheet from './Sheet.svelte'

  const FORMATS: Record<FormatId, string> = {
    notion: 'Notion',
    evernote: 'Evernote',
    keep: 'Google Keep',
    bear: 'Bear',
    logseq: 'Logseq',
    roam: 'Roam',
    craft: 'Craft',
    obsidian: 'Obsidian',
    onenote: 'OneNote',
    tomboy: 'Tomboy',
    'apple-notes': 'Apple Notes',
    journal: 'Apple Journal',
    table: key('A table'),
    markdown: key('Markdown files'),
    pandoc: key('A document'),
    'pdf-pages': key('A PDF, as pages to write on'),
    todoist: 'Todoist',
  }

  let over = $state(false)

  const plan = $derived(importing.plan)
  const counts = $derived(importing.counts)

  const said = $derived([
    plural(counts.notes, { one: '{count} note', other: '{count} notes' }),
    counts.files ? plural(counts.files, { one: '{count} file', other: '{count} files' }) : '',
  ])

  const target = $derived(
    [importing.spaceName, importing.under].filter(Boolean).join(' / ') || t('This space'),
  )

  const ready = $derived(
    importing.stage === 'ready' && !!plan?.files.length && !!importing.root && !importing.error,
  )

  let token = $state('')
  let withDone = $state(false)

  async function readTodoist() {
    const pasted = token
    token = ''
    await importing.readTodoist(pasted, withDone)
  }

  async function choose() {
    await importing.take(await pickFiles())
  }

  async function drop(event: DragEvent) {
    event.preventDefault()
    over = false
    await importing.take(await droppedFiles(event.dataTransfer))
  }
</script>

<Sheet open={importing.open} title={t('Import')} onclose={() => importing.close()}>
  {#if importing.error}
    <p class="wrong">{importing.error}</p>
  {/if}

  {#if importing.stage === 'waiting' || importing.stage === 'reading'}
    <button
      class="drop"
      class:over
      class:busy={importing.stage === 'reading'}
      use:dropOver={(event) => {
        event.preventDefault()
        over = true
      }}
      ondragleave={() => (over = false)}
      ondrop={(event) => void drop(event)}
      onclick={() => void choose()}
      disabled={importing.stage === 'reading'}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v10m0 0 3.5-3.5M12 13 8.5 9.5" />
        <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      </svg>
      <span class="name">
        {importing.stage === 'reading'
          ? t('Reading')
          : viewport.touch
            ? t('Choose an export')
            : t('Drop an export here')}
      </span>
      <span class="hint">{t('A zip, a folder, or a file another app wrote')}</span>
    </button>

    {#if onMac()}
      <div class="card">
        <div class="row">
          <span class="name">{FORMATS['apple-notes']}</span>
          <button
            class="orden-chip"
            onclick={() => void importing.readMac()}
            disabled={importing.stage === 'reading'}
          >
            {t('Read them from this Mac')}
          </button>
        </div>
        {#if importing.noAccess}
          <p class="hint">{t('Turn Orden on under Full Disk Access, then ask again.')}</p>
          <button class="orden-chip" onclick={() => void importing.openAccess()}>
            {t('Open the setting')}
          </button>
        {/if}
      </div>
    {/if}

    <div class="card">
      <div class="row">
        <span class="name">{FORMATS.todoist}</span>
        <input
          class="field"
          type="password"
          bind:value={token}
          aria-label={t('API token')}
          autocomplete="off"
          spellcheck="false"
          onkeydown={(event) => {
            if (event.key === 'Enter') void readTodoist()
          }}
        />
        <button
          class="orden-chip"
          onclick={() => void readTodoist()}
          disabled={!token.trim() || importing.stage === 'reading'}
        >
          {t('Read')}
        </button>
      </div>
      <button
        class="orden-row"
        role="switch"
        aria-checked={withDone}
        onclick={() => (withDone = !withDone)}
      >
        <span class="orden-row-label">{t('Done tasks too')}</span>
        <span class="orden-switch" class:on={withDone} aria-hidden="true"></span>
      </button>
    </div>

    <p class="note">
      {t(
        'Apple Journal exports itself: Journal, Settings, Export. Apple Notes has no export, so away from the Mac it is on, what to drop is a folder an exporter wrote.',
      )}
    </p>
  {:else}
    <div class="card" in:fade={{ duration: dur(130) }}>
      <div class="row">
        <span class="name">{importing.format ? t(FORMATS[importing.format]) : ''}</span>
        <span class="hint"><Facts parts={said} /></span>
      </div>
    </div>

    {#if importing.needsPandoc}
      {#if settings.pandoc}
        <p class="note">{t('Pandoc reads this one, from the file on your disk.')}</p>
        <button class="orden-button" onclick={() => void importing.readWithPandoc()}>
          {t('Read it with pandoc')}
        </button>
      {:else}
        <p class="note">
          {t('Only pandoc reads this one, and it is not installed on this machine.')}
        </p>
      {/if}
    {:else}
      {#if importing.format === 'table'}
        <div class="orden-segmented" role="radiogroup" aria-label={t('Rows')} use:segmented>
          <button
            type="button"
            role="radio"
            aria-checked={importing.rows === 'table'}
            class:on={importing.rows === 'table'}
            onclick={() => importing.setRows('table')}
          >
            {t('As a table')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={importing.rows === 'notes'}
            class:on={importing.rows === 'notes'}
            onclick={() => importing.setRows('notes')}
          >
            {t('One note per row')}
          </button>
        </div>
      {/if}

      <div class="card">
        <div class="row">
          <span class="name">{t('Into')}</span>
          <button class="orden-chip" onclick={() => void importing.chooseTarget()}>{target}</button>
        </div>
        <div class="row">
          <span class="name">{t('Under')}</span>
          <input
            class="field"
            bind:value={importing.folder}
            aria-label={t('Under')}
            spellcheck="false"
          />
        </div>
      </div>

      {#if plan?.lost.length}
        <div class="card">
          <h3>{t('Worth knowing')}</h3>
          {#each plan.lost as line (line.text)}
            <p class="hint">{worthKnowing(line)}</p>
          {/each}
        </div>
      {/if}

      {#if importing.stage === 'done'}
        <p class="note">
          {plural(counts.notes, {
            one: '{count} note arrived.',
            other: '{count} notes arrived.',
          })}
        </p>
        {#if importing.stepped}
          <p class="hint">
            {plural(importing.stepped, {
              one: '{count} name was taken, so that file stepped aside.',
              other: '{count} names were taken, so those files stepped aside.',
            })}
          </p>
        {/if}
        <button class="orden-button" onclick={() => importing.close()}>{t('Done')}</button>
      {:else}
        <button class="orden-button" disabled={!ready} onclick={() => void importing.run()}>
          {importing.stage === 'writing' ? t('Importing') : t('Import')}
        </button>
        {#if importing.stage === 'writing'}
          <p class="hint" transition:fade={{ duration: dur(130) }}>
            {t('{at} of {count}', { at: importing.written, count: plan?.files.length ?? 0 })}
          </p>
        {/if}
      {/if}
    {/if}
  {/if}
</Sheet>

<style>
  .drop {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-6) var(--space-4);
    border: 1px dashed var(--line);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--muted-strong);
    font: inherit;
    text-align: center;
    cursor: pointer;
    transition:
      border-color var(--dur-base) var(--ease-out),
      background var(--dur-base) var(--ease-out);
  }

  .drop svg {
    width: 26px;
    height: 26px;
    fill: none;
    stroke: currentcolor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.75;
  }

  .drop.over {
    border-color: var(--accent);
    border-style: solid;
    background: color-mix(in srgb, var(--accent) 8%, var(--surface-2));
  }

  .drop.busy {
    cursor: default;
  }

  .drop:disabled {
    opacity: 0.7;
  }

  @media (hover: hover) {
    .drop:hover:not(:disabled) {
      border-color: var(--line-strong);
      background: var(--surface-3);
    }
  }
</style>
