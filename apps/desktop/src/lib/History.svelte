<script lang="ts">
  import { closeOnBack } from './backstack.svelte'
  import { diffCount, lineDiff, trimmed } from './diff'
  import { overlays } from './overlays'
  import { recovery } from './recovery.svelte'
  import { scrollbar } from './scrollbar'
  import { t } from './i18n.svelte'
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { invoke } from './tauri'
  import { workspace } from './workspace.svelte'

  interface Snapshot {
    taken_at: number
    size: number
    path: string
  }

  let { open = $bindable(false) }: { open?: boolean } = $props()

  let snapshots = $state<Snapshot[]>([])
  let selected = $state<Snapshot | null>(null)
  let preview = $state('')
  /** Whether the version is shown as itself or as what it would change. The
   *  changes are what somebody looking for a lost paragraph wants first. */
  let comparing = $state(true)

  $effect(() => {
    if (!open) return

    const path = workspace.active?.path
    if (!path) {
      snapshots = []
      return
    }

    void invoke<Snapshot[]>('list_snapshots', { path })
      .then((found) => {
        snapshots = found
        selected = found[0] ?? null
      })
      .catch(() => (snapshots = []))
  })

  $effect(() => {
    if (!selected) {
      preview = ''
      return
    }

    // The note is named as well as the version, because the browser keeps its
    // versions in one store and the desktop keeps each note's in a folder.
    void invoke<string>('read_snapshot', {
      path: selected.path,
      notePath: workspace.active?.path ?? '',
    })
      .then((body) => (preview = body))
      .catch(() => (preview = ''))
  })

  /** What this version would change, against the note as it stands now. */
  const changes = $derived(trimmed(lineDiff(preview, workspace.active?.note.text ?? '')))
  const counted = $derived(diffCount(lineDiff(preview, workspace.active?.note.text ?? '')))

  const when = (stamp: number) =>
    new Date(stamp).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })

  /** Restoring is itself an edit, so the words being replaced are kept first:
   *  putting an old version back is one more version, and undoable like any. */
  async function restore() {
    const tab = workspace.active
    if (!preview || !tab?.path) return

    await recovery.keep(tab.path, tab.note.text)
    workspace.replace(preview)
    open = false
  }

  $effect(() => (open ? overlays.show(() => (open = false)) : undefined))
  $effect(() => closeOnBack(open, () => (open = false)))
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" transition:fade={{ duration: 140 }} onclick={() => (open = false)}></div>

  <div class="sheet" transition:scale={{ duration: 200, start: 0.97, easing: cubicOut }}>
    {#if !workspace.active?.path}
      <p class="empty">{t('Save this note first; there is nothing to compare against yet.')}</p>
    {:else if !snapshots.length}
      <p class="empty">{t('No earlier versions yet. One is kept each time you save.')}</p>
    {:else}
      <ul class="versions" use:scrollbar>
        {#each snapshots as snapshot (snapshot.path)}
          <li>
            <button
              class:active={selected?.path === snapshot.path}
              onclick={() => (selected = snapshot)}
            >
              <span>{when(snapshot.taken_at)}</span>
              <kbd>{Math.max(1, Math.round(snapshot.size / 1024))} kB</kbd>
            </button>
          </li>
        {/each}
      </ul>

      <div class="preview">
        <!-- Two faces of one version: what it would change, and what it says.
             A pair of tabs rather than a switch, because both are a way of
             reading the same thing. -->
        <div class="faces">
          <button class:on={comparing} onclick={() => (comparing = true)}>{t('Changes')}</button>
          <button class:on={!comparing} onclick={() => (comparing = false)}>{t('Text')}</button>

          {#if comparing && changes.length}
            <span class="tally">
              <ins>+{counted.added}</ins><del>-{counted.removed}</del>
            </span>
          {/if}
        </div>

        {#if !comparing}
          <pre>{preview}</pre>
        {:else if changes.length}
          <div class="diff" use:scrollbar>
            {#each changes as row, at (at)}
              <div class="row {row.change}">
                <span class="gutter">{row.before ?? row.after ?? ''}</span>
                <span class="text">{row.text || ' '}</span>
              </div>
            {/each}
          </div>
        {:else}
          <!-- The version the note already says. Said here rather than in the
               tally, so an empty box never reads as a broken one. -->
          <div class="diff same"><p class="empty">{t('No changes')}</p></div>
        {/if}

        <button class="primary" onclick={() => void restore()}>
          {t('Restore this version')}
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    backdrop-filter: blur(3px);
    z-index: 50;
  }

  .sheet {
    position: fixed;
    top: 10vh;
    left: 50%;
    translate: -50% 0;
    width: min(46rem, calc(100vw - 3rem));
    height: 70vh;
    z-index: 51;
    display: flex;
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }

  .empty {
    margin: auto;
    padding: var(--space-5);
    color: var(--muted);
    font-size: var(--text-sm);
    text-align: center;
  }

  .versions {
    width: 15rem;
    flex: none;
    margin: 0;
    padding: var(--space-2);
    list-style: none;
    overflow-y: auto;
    border-right: 1px solid var(--line);
  }

  .versions button {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: 7px 9px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: left;
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .versions button:hover {
    background: var(--item-hover-bg-color);
  }

  /* Each version has to be read off disk before it can be shown, so the row
     answers first. */
  .versions button:active {
    background: var(--press);
  }

  .versions button.active {
    background: var(--accent-soft);
    color: var(--text-strong);
  }

  .versions kbd {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .preview {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: var(--space-4);
    gap: var(--space-3);
  }

  pre {
    flex: 1;
    margin: 0;
    padding: var(--space-3);
    overflow: auto;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.6;
    color: var(--muted-strong);
    white-space: pre-wrap;
  }

  /* Which face of the version is showing. The same shape as the tabs elsewhere
     in the app: a word that lights up rather than a control with a label. */
  .faces {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .faces button {
    padding: 4px 9px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .faces button:hover {
    background: var(--item-hover-bg-color);
  }

  .faces button:active {
    background: var(--press);
  }

  .faces button.on {
    background: var(--accent-soft);
    color: var(--text-strong);
  }

  .tally {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .tally ins,
  .tally del {
    text-decoration: none;
  }

  .tally ins {
    color: var(--success);
  }

  .tally del {
    margin-left: var(--space-2);
    color: var(--danger);
  }

  /* A line of the diff. The colour is the whole signal, so the gutter stays
     quiet and the sign is the tint of the line rather than a character. */
  .diff {
    flex: 1;
    overflow: auto;
    padding: var(--space-2) 0;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.6;
  }

  .diff.same {
    display: flex;
  }

  .row {
    display: flex;
    gap: var(--space-3);
    padding: 0 var(--space-3);
    color: var(--muted-strong);
    white-space: pre-wrap;
  }

  .gutter {
    flex: none;
    width: 2.5em;
    text-align: right;
    color: var(--muted);
    user-select: none;
  }

  .text {
    min-width: 0;
    flex: 1;
  }

  .row.added {
    background: color-mix(in srgb, var(--success) 14%, transparent);
    color: var(--text-strong);
  }

  .row.removed {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    color: var(--text-strong);
  }

  .primary {
    align-self: flex-start;
    padding: 9px 14px;
    border: none;
    border-radius: var(--radius-md);
    background: var(--accent);
    color: #fff;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 550;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-spring);
  }

  .primary:hover {
    background: var(--accent-hover);
    transform: translateY(-1px);
  }

  .primary:active {
    background: var(--accent-press);
    transform: translateY(0);
  }

  :global([data-touch]) .sheet {
    top: auto;
    bottom: 0;
    left: 0;
    translate: none;
    width: 100%;
    max-height: 88dvh;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    padding-bottom: calc(var(--space-4) + var(--inset-bottom));
  }
</style>
