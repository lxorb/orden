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
  import { type Tab, workspace } from './workspace.svelte'
  import { dur } from './motion'

  interface Snapshot {
    taken_at: number
    size: number
    path: string
  }

  let { open = $bindable(false) }: { open?: boolean } = $props()

  let snapshots = $state<Snapshot[]>([])
  let selected = $state<Snapshot | null>(null)
  let preview = $state('')
  /** Which tab the version on show was read for. A version belongs to one note,
   *  and the sheet stays open while tabs can be switched under it, so restoring
   *  puts it back into the note it came from rather than into whatever is on
   *  screen by then. Null while nothing has been read. */
  let previewOf = $state<Tab | null>(null)
  /** Whether the version is shown as itself or as what it would change. The
   *  changes are what somebody looking for a lost paragraph wants first. */
  let comparing = $state(true)

  // Each read carries a flag its own effect clears on the way out, so a list or
  // a version that arrives after the note has changed - or after the sheet has
  // been shut - cannot land on top of a newer one.
  $effect(() => {
    if (!open) return

    const path = workspace.active?.path
    if (!path) {
      snapshots = []
      return
    }

    let current = true

    void invoke<Snapshot[]>('list_snapshots', { path })
      .then((found) => {
        if (!current) return
        snapshots = found
        selected = found[0] ?? null
      })
      .catch(() => {
        if (current) snapshots = []
      })

    return () => {
      current = false
    }
  })

  $effect(() => {
    const tab = workspace.active
    if (!selected) {
      preview = ''
      previewOf = null
      return
    }

    let current = true

    // The note is named as well as the version, because the browser keeps its
    // versions in one store and the desktop keeps each note's in a folder.
    void invoke<string>('read_snapshot', {
      path: selected.path,
      notePath: tab?.path ?? '',
    })
      .then((body) => {
        if (!current) return
        preview = body
        // The version and the note it is a version of, set together, so a
        // restore cannot pair one note's words with another note's tab.
        previewOf = tab ?? null
      })
      .catch(() => {
        if (!current) return
        preview = ''
        previewOf = null
      })

    return () => {
      current = false
    }
  })

  /** What this version would change, against the note as it stands now. One diff
   *  read two ways: the lines and how many of them there are are the same walk
   *  over the whole document, and walking it twice is a whole document twice. */
  const difference = $derived(lineDiff(preview, workspace.active?.note.text ?? ''))
  const changes = $derived(trimmed(difference))
  const counted = $derived(diffCount(difference))

  const when = (stamp: number) =>
    new Date(stamp).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })

  /** Restoring is itself an edit, so the words being replaced are kept first:
   *  putting an old version back is one more version, and undoable like any. */
  async function restore() {
    // The tab the version on show was read for, not whichever is active now: the
    // two are the same until somebody switches notes with the sheet open.
    const tab = previewOf
    if (!preview || !tab?.path) return

    await recovery.keep(tab.path, tab.note.text)
    workspace.replace(preview, tab)
    open = false
  }

  $effect(() => (open ? overlays.show(() => (open = false)) : undefined))
  $effect(() => closeOnBack(open, () => (open = false)))
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" transition:fade={{ duration: dur(140) }} onclick={() => (open = false)}></div>

  <div class="sheet" transition:scale={{ duration: dur(200), start: 0.97, easing: cubicOut }}>
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
    padding-bottom: var(--touch-bottom);
  }

  /* A version is a row in a list like any other, and the button that puts one
     back is the one thing here to press. */
  :global([data-touch]) .versions button {
    min-height: var(--touch-row);
    gap: var(--touch-gap);
    padding: 0 var(--touch-pad);
    font-size: var(--touch-text);
  }

  :global([data-touch]) .primary {
    min-height: var(--touch-target);
    padding: 0 var(--space-4);
    font-size: var(--text-base);
  }
</style>
