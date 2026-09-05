<script lang="ts">
  import { closeOnBack } from './backstack.svelte'
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

    void invoke<string>('read_snapshot', { path: selected.path })
      .then((body) => (preview = body))
      .catch(() => (preview = ''))
  })

  const when = (stamp: number) =>
    new Date(stamp).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })

  /** Restoring is itself an edit, so it lands in the history too. */
  function restore() {
    if (!preview || !workspace.active) return

    workspace.replace(preview)
    open = false
  }

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
      <ul class="versions">
        {#each snapshots as snapshot (snapshot.path)}
          <li>
            <button class:active={selected?.path === snapshot.path} onclick={() => (selected = snapshot)}>
              <span>{when(snapshot.taken_at)}</span>
              <kbd>{Math.max(1, Math.round(snapshot.size / 1024))} kB</kbd>
            </button>
          </li>
        {/each}
      </ul>

      <div class="preview">
        <pre>{preview}</pre>
        <button class="primary" onclick={restore}>{t('Restore this version')}</button>
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

  @media (max-width: 720px) {
    .sheet {
      top: auto;
      bottom: 0;
      left: 0;
      translate: none;
      width: 100%;
      max-height: 88dvh;
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
      padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom));
    }
  }
</style>
