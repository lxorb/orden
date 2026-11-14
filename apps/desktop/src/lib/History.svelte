<script lang="ts">
  import { closeOnBack } from './ui-kit/src/api'
  import { diffCount, lineDiff, trimmed } from '@orden/markdown/line-diff'
  import { overlays } from './ui-kit/src/api'
  import { KEEP_YEAR, modes } from './modes.svelte'
  import { recovery } from './recovery.svelte'
  import { scrollbar } from './ui-kit/src/api'
  import { canWriteIn } from './sharing/src/api'
  import { readableSize } from './usage.svelte'
  import { localDate } from './platform/src/api'
  import { when } from './when'
  import { cubicOut } from 'svelte/easing'
  import { type Tab, workspace } from './workspace.svelte'
  import { type Version, versionsOf, versionText } from './versions'
  import { fade, LAYER, scale } from './platform/src/api'
  import { trap } from './ui-controls/src/api'

  let { open = $bindable(false) }: { open?: boolean } = $props()

  let versions = $state<Version[]>([])
  let selected = $state<Version | null>(null)
  let preview = $state('')
  let previewOf = $state<Tab | null>(null)
  let comparing = $state(true)

  const shut = $derived(workspace.protection.locked(workspace.active?.path))

  $effect(() => {
    if (open && shut) open = false
  })

  $effect(() => {
    if (!open) return

    const path = workspace.active?.path
    if (!path || shut) {
      versions = []
      return
    }

    let current = true

    void versionsOf(path)
      .then((found) => {
        if (!current) return
        versions = found
        selected = found[0] ?? null
      })
      .catch(() => {
        if (current) versions = []
      })

    return () => {
      current = false
    }
  })

  $effect(() => {
    const tab = workspace.active
    if (!selected || shut) {
      preview = ''
      previewOf = null
      return
    }

    let current = true

    void versionText(selected, tab?.path ?? '')
      .then((body) => {
        if (!current) return
        preview = body
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

  const difference = $derived(lineDiff(preview, workspace.active?.note.text ?? ''))
  const changes = $derived(trimmed(difference))
  const counted = $derived(diffCount(difference))

  interface Row {
    month?: string
    version?: Version
  }

  const rows = $derived.by((): Row[] => {
    if (modes.keepVersions < KEEP_YEAR) return versions.map((version) => ({ version }))

    const out: Row[] = []
    let said = ''

    for (const version of versions) {
      const month = localDate(version.at, { month: 'long', year: 'numeric' })

      if (month !== said) {
        out.push({ month })
        said = month
      }

      out.push({ version })
    }

    return out
  })

  async function restore() {
    const tab = previewOf
    if (!preview || !tab?.path || !canWriteIn(tab.note)) return

    await recovery.keep(tab.path, tab.note.text)
    await workspace.restoreVersion(preview, tab)
    open = false
  }

  $effect(() => (open ? overlays.show(() => (open = false)) : undefined))
  $effect(() => closeOnBack(open, () => (open = false)))
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="orden-scrim scrim"
    transition:fade={{ duration: LAYER.fade }}
    onclick={() => (open = false)}
  ></div>

  <div
    class="orden-screen is-centred is-steady sheet"
    use:trap
    role="dialog"
    aria-modal="true"
    aria-label="Version history"
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    {#if !workspace.active?.path || shut || !versions.length}
      <p class="empty">No earlier versions yet.</p>
    {:else}
      <ul class="versions" use:scrollbar>
        {#each rows as row (row.month ?? row.version?.at)}
          {#if row.month}
            <li class="month"><p class="orden-section">{row.month}</p></li>
          {:else if row.version}
            {@const version = row.version}
            <li>
              <button
                class:active={selected?.at === version.at}
                onclick={() => (selected = version)}
              >
                <span>{when(version.at, 'medium')}</span>
                {#if version.by}
                  <em>{version.by}</em>
                {/if}
                <kbd>{readableSize(version.size)}</kbd>
              </button>
            </li>
          {/if}
        {/each}
      </ul>

      <div class="preview">
        <div class="faces">
          <button class:on={comparing} onclick={() => (comparing = true)}>Changes</button>
          <button class:on={!comparing} onclick={() => (comparing = false)}>Text</button>

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
          <div class="diff same"><p class="empty">No changes</p></div>
        {/if}

        {#if canWriteIn(previewOf?.note)}
          <button class="orden-button" onclick={() => void restore()}>
            Restore this version
          </button>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .sheet {
    --screen-width: var(--screen-pair);

    z-index: var(--z-sheet);
    display: flex;
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
    border-inline-end: 1px solid var(--line);
  }

  .versions .month p {
    margin: var(--space-3) 0 var(--space-1);
  }

  .versions .month:first-child p {
    margin-top: 0;
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
    text-align: start;
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .versions button:hover {
    background: var(--item-hover-bg-color);
  }

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

  .versions em {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-style: normal;
    font-size: var(--text-xs);
    color: var(--muted);
    text-align: end;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    margin-inline-start: auto;
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
    margin-inline-start: var(--space-2);
    color: var(--danger);
  }

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
    text-align: end;
    color: var(--muted);
    user-select: none;
    -webkit-user-select: none;
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

  .orden-button {
    align-self: flex-start;
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

  :global([data-touch]) .versions button {
    min-height: var(--touch-row);
    gap: var(--touch-gap);
    padding: 0 var(--touch-pad);
    font-size: var(--touch-text);
  }

  :global([data-touch]) .faces button {
    min-height: var(--touch-target);
    padding: 0 var(--space-3);
    font-size: var(--touch-text);
  }
</style>
