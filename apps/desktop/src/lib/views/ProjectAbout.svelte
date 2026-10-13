<script lang="ts">
  /** Todoist's project description, the nib way: the words at the top of the project's
   *  note (`aboutOf`), under the head in the muted ink, one line. A press opens the note
   *  beside the view at its top, where they are written. Read again only when the note
   *  itself changes. */
  import { untrack } from 'svelte'
  import { rows } from '../rows/rows.svelte'
  import { insideSpace, samePath } from '../space-paths'
  import { workspace } from '../workspace.svelte'
  import { noteText } from '../workspace/note-text'
  import type { Kit } from './kit'
  import { projectOf } from './section-actions'
  import { aboutOf } from './sections'

  const { kit }: { kit: Kit } = $props()

  const project = $derived(projectOf(kit))
  let about = $state<string | null>(null)

  async function read(path: string, name: string) {
    const text = await noteText(workspace, path)
    if (projectOf(kit)?.path === path) about = text === null ? null : aboutOf(text, name)
  }

  $effect(() => {
    const here = project
    if (!here) return
    void untrack(() => read(here.path, here.name))
    return untrack(() =>
      rows.watch((change) => {
        if (change.path !== null && samePath(insideSpace(change.root, change.path), here.path))
          void read(here.path, here.name)
      }),
    )
  })

  function open() {
    if (!project) return
    const path = project.path
    void workspace.openAside(path).then(() => (workspace.goto = { path, line: 0 }))
  }
</script>

{#if about}
  <button type="button" class="about" onclick={open}>{about}</button>
{/if}

<style>
  .about {
    flex: none;
    display: block;
    width: 100%;
    overflow: hidden;
    padding: 0 var(--space-4) var(--space-2);
    border: none;
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: start;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: default;
  }

  @media (hover: hover) {
    .about:hover {
      color: var(--text);
    }
  }
</style>
