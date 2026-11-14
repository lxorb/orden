<script lang="ts">
  import { dropOver } from './drag-paths'

  import Facts from './Facts.svelte'
  import { importing, onMac } from './importing.svelte'
  import { droppedFiles, pickFiles } from './import/picking'
  import type { FormatId } from './import/plan'
  import { dur, fade } from './platform/src/api'
  import { settings } from './settings.svelte'
  import { segmented } from './ui-kit/src/api'
  import { viewport } from './ui-kit/src/api'
  import { Sheet } from './ui-controls/src/api'

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
    table: 'A table',
    markdown: 'Markdown files',
    pandoc: 'A document',
    'pdf-pages': 'A PDF, as pages to write on',
    todoist: 'Todoist',
  }

  let over = $state(false)

  const plan = $derived(importing.plan)
  const counts = $derived(importing.counts)

  const said = $derived([
    counts.notes === 1 ? '1 note' : `${counts.notes} notes`,
    counts.files ? (counts.files === 1 ? '1 file' : `${counts.files} files`) : '',
  ])

  const target = $derived(
    [importing.spaceName, importing.under].filter(Boolean).join(' / ') || 'This space',
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

<Sheet open={importing.open} title="Import" onclose={() => importing.close()}>
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
          ? 'Reading'
          : viewport.touch
            ? 'Choose an export'
            : 'Drop an export here'}
      </span>
      <span class="hint">A zip, a folder, or a file another app wrote</span>
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
            Read them from this Mac
          </button>
        </div>
        {#if importing.noAccess}
          <p class="hint">Turn Orden on under Full Disk Access, then ask again.</p>
          <button class="orden-chip" onclick={() => void importing.openAccess()}>
            Open the setting
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
          aria-label="API token"
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
          Read
        </button>
      </div>
      <button
        class="orden-row"
        role="switch"
        aria-checked={withDone}
        onclick={() => (withDone = !withDone)}
      >
        <span class="orden-row-label">Done tasks too</span>
        <span class="orden-switch" class:on={withDone} aria-hidden="true"></span>
      </button>
    </div>

    <p class="note">
      Apple Journal exports itself: Journal, Settings, Export. Apple Notes has no export, so away
      from the Mac it is on, what to drop is a folder an exporter wrote.
    </p>
  {:else}
    <div class="card" in:fade={{ duration: dur(130) }}>
      <div class="row">
        <span class="name">{importing.format ? FORMATS[importing.format] : ''}</span>
        <span class="hint"><Facts parts={said} /></span>
      </div>
    </div>

    {#if importing.needsPandoc}
      {#if settings.pandoc}
        <p class="note">Pandoc reads this one, from the file on your disk.</p>
        <button class="orden-button" onclick={() => void importing.readWithPandoc()}>
          Read it with pandoc
        </button>
      {:else}
        <p class="note">Only pandoc reads this one, and it is not installed on this machine.</p>
      {/if}
    {:else}
      {#if importing.format === 'table'}
        <div class="orden-segmented" role="radiogroup" aria-label="Rows" use:segmented>
          <button
            type="button"
            role="radio"
            aria-checked={importing.rows === 'table'}
            class:on={importing.rows === 'table'}
            onclick={() => importing.setRows('table')}
          >
            As a table
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={importing.rows === 'notes'}
            class:on={importing.rows === 'notes'}
            onclick={() => importing.setRows('notes')}
          >
            One note per row
          </button>
        </div>
      {/if}

      <div class="card">
        <div class="row">
          <span class="name">Into</span>
          <button class="orden-chip" onclick={() => void importing.chooseTarget()}>{target}</button>
        </div>
        <div class="row">
          <span class="name">Under</span>
          <input
            class="field"
            bind:value={importing.folder}
            aria-label="Under"
            spellcheck="false"
          />
        </div>
      </div>

      {#if plan?.lost.length}
        <div class="card">
          <h3>Worth knowing</h3>
          {#each plan.lost as line (line)}
            <p class="hint">{line}</p>
          {/each}
        </div>
      {/if}

      {#if importing.stage === 'done'}
        <p class="note">
          {counts.notes === 1 ? '1 note arrived.' : `${counts.notes} notes arrived.`}
        </p>
        {#if importing.stepped}
          <p class="hint">
            {importing.stepped === 1
              ? '1 name was taken, so that file stepped aside.'
              : `${importing.stepped} names were taken, so those files stepped aside.`}
          </p>
        {/if}
        <button class="orden-button" onclick={() => importing.close()}>Done</button>
      {:else}
        <button class="orden-button" disabled={!ready} onclick={() => void importing.run()}>
          {importing.stage === 'writing' ? 'Importing' : 'Import'}
        </button>
        {#if importing.stage === 'writing'}
          <p class="hint" transition:fade={{ duration: dur(130) }}>
            {importing.written} of {plan?.files.length ?? 0}
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
