<script lang="ts">
  import type { Folder, Vault } from '@orden/pass/types'
  import FolderMark from 'lucide/dist/esm/icons/folder.mjs'
  import { Sheet } from '../ui-controls/src/api'
  import Glyph from './Glyph.svelte'
  import { pass } from './store.svelte'
  import type { PassUi } from './ui.svelte'
  import VaultMark from './VaultMark.svelte'

  const { ui }: { ui: PassUi } = $props()

  const asked = $derived(ui.sheet?.kind === 'move' ? ui.sheet : null)
  const close = () => (ui.sheet = null)

  function childrenOf(vault: Vault, parent: string | null): Folder[] {
    return vault.folders
      .filter((one) => one.parent === parent)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async function moved(vault: string, folder: string | null) {
    if (!asked) return
    const ids = asked.ids
    close()
    await pass.move(ids, vault, folder)
    ui.picked = null
  }
</script>

{#snippet folders(vault: Vault, parent: string | null, depth: number)}
  {#each childrenOf(vault, parent) as folder (folder.id)}
    <button
      class="orden-row"
      type="button"
      style:padding-inline-start="calc(var(--row-pad) + {depth} * var(--row-indent))"
      onclick={() => void moved(vault.id, folder.id)}
    >
      <Glyph icon={FolderMark} class="orden-row-mark" />
      <span class="orden-row-label">{folder.name}</span>
    </button>
    {@render folders(vault, folder.id, depth + 1)}
  {/each}
{/snippet}

<Sheet
  open={asked !== null}
  title={(asked?.ids.length ?? 0) === 1 ? 'Move 1 item' : `Move ${asked?.ids.length ?? 0} items`}
  onclose={close}
>
  <div class="targets">
    {#each pass.vaults as vault (vault.id)}
      <button class="orden-row vault" type="button" onclick={() => void moved(vault.id, null)}>
        <VaultMark color={vault.color} icon={vault.icon} mark={vault.mark} />
        <span class="orden-row-label">{vault.name}</span>
      </button>
      {@render folders(vault, null, 1)}
    {/each}
  </div>
</Sheet>

<style>
  .targets {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .vault {
    --row-height-sm: 22px;
  }
</style>
