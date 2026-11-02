<script lang="ts">
  /** Settings > Space: what belongs to a space rather than to whoever is reading it.
   *
   *  One field so far, the space's agent instructions: the `AGENTS.md` at its top, which
   *  stays a file there for agents, CLIs and sync, and which the app shows here instead
   *  of as a note. ChatGPT's and Claude's projects keep their instructions the same way,
   *  a box in the project's settings. See instructions-field.svelte.ts for what it writes
   *  and reserved-name.svelte.ts for the way here from a refused name. */
  import { t } from '../i18n.svelte'
  import { links } from '../link-index.svelte'
  import { AGENTS_NAME } from '../note-name'
  import { onDisk } from '../on-disk'
  import { canWriteAt } from '../sharing.svelte'
  import { settings } from '../settings.svelte'
  import { samePath } from '../space-paths'
  import { joinPath } from '../tauri'
  import { workspace } from '../workspace.svelte'
  import { noteText, writeNoteText } from '../workspace/note-text'
  import { writeFile } from '../workspace/write-file'
  import { type FieldHands, InstructionsField } from './instructions-field.svelte'
  import { landing } from './landing.svelte'

  const root = $derived(settings.space ?? workspace.activeSpace?.root ?? null)
  const name = $derived(workspace.spaces.find((one) => one.root === root)?.name ?? '')

  async function nudged() {
    const { sync } = await import('../sync.svelte')
    sync.nudge()
  }

  const hands: FieldHands = {
    read: (path) => noteText(workspace, path),
    there: onDisk,
    write: async (path, before, after, first) => {
      await writeNoteText(workspace, path, before, after, { undoable: false, snapshot: first })
      await nudged()
    },
    make: async (path, text) => {
      await writeFile(path, text)
      if (samePath(root, workspace.activeSpace?.root)) await workspace.loadTree()
      await workspace.fileCame(path, 'file')
      await nudged()
    },
  }

  let field = $state.raw<InstructionsField | null>(null)
  let box = $state<HTMLTextAreaElement>()

  $effect(() => {
    if (root === null) return
    const path = joinPath(root, AGENTS_NAME)
    const one = new InstructionsField(path, hands, () => !canWriteAt(path))
    field = one
    void one.load()

    // Written elsewhere, by sync, an agent or a pane; a CLI's write is seen on coming back.
    const stop = links.hearSaves((saved, words) => {
      if (samePath(saved, path)) one.heard(words)
    })
    const back = () => void one.look()
    const away = () => void one.flush()
    window.addEventListener('focus', back)
    window.addEventListener('pagehide', away)

    return () => {
      stop()
      window.removeEventListener('focus', back)
      window.removeEventListener('pagehide', away)
      void one.flush()
    }
  })

  // The hint on a refused name lands here, with the caret in the words.
  $effect(() => {
    if (!landing.instructions || !box) return
    landing.instructions = false
    box.focus()
  })
</script>

{#if field}
  <div class="card">
    <label class="nib-setting setting tall">
      <span class="name">{t('Agent instructions')}</span>
      {#if name}<span class="space">{name}</span>{/if}
      <textarea
        bind:this={box}
        rows="12"
        spellcheck="false"
        value={field.text}
        readonly={field.locked || !field.loaded}
        oninput={(event) => field?.type(event.currentTarget.value)}
        onblur={() => void field?.flush()}></textarea>
    </label>
  </div>
{/if}

<style>
  /* The settings pane's own shapes, carried here the way ProfileRows.svelte carries them:
     the pane's are scoped to it. */
  .card {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .tall {
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding-block: var(--space-2);
  }

  .name {
    flex: 1;
  }

  .space {
    color: var(--muted);
    font-size: var(--text-sm);
  }

  textarea {
    flex: 1 0 100%;
    min-height: 12rem;
    padding: 6px 9px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.5;
    resize: vertical;
  }

  textarea:read-only {
    border-color: transparent;
    background: none;
  }
</style>
