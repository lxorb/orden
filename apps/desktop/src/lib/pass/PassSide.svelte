<script lang="ts">
  import { report } from '@orden/pass/monitor'
  import type { Folder, Vault } from '@orden/pass/types'
  import type { Snippet } from 'svelte'
  import ChevronDown from 'lucide/dist/esm/icons/chevron-down.mjs'
  import Ellipsis from 'lucide/dist/esm/icons/ellipsis.mjs'
  import FolderMark from 'lucide/dist/esm/icons/folder.mjs'
  import Inbox from 'lucide/dist/esm/icons/inbox.mjs'
  import Link from 'lucide/dist/esm/icons/link.mjs'
  import Lock from 'lucide/dist/esm/icons/lock.mjs'
  import Plus from 'lucide/dist/esm/icons/plus.mjs'
  import Settings from 'lucide/dist/esm/icons/settings.mjs'
  import Share from 'lucide/dist/esm/icons/share.mjs'
  import ShieldCheck from 'lucide/dist/esm/icons/shield-check.mjs'
  import Trash from 'lucide/dist/esm/icons/trash-2.mjs'
  import UsersRound from 'lucide/dist/esm/icons/users-round.mjs'
  import { account } from '../account.svelte'
  import Icon from '../Icon.svelte'
  import { readIcon } from '../icons'
  import { menu } from '../menu.svelte'
  import SharedMark from '../SharedMark.svelte'
  import Glyph from './Glyph.svelte'
  import type { Scope } from './list'
  import { newItemEntries } from './new-items'
  import { pass } from './store.svelte'
  import SyncBadge from './SyncBadge.svelte'
  import { passSync } from './syncing.svelte'
  import type { PassUi } from './ui.svelte'
  import { folderEntries, vaultEntries } from './vault-menu'
  import VaultMark from './VaultMark.svelte'

  const {
    ui,
    onchosen,
    corner,
  }: { ui: PassUi; onchosen?: () => void; corner?: Snippet<[PassUi]> | undefined } = $props()

  const view = $derived(ui.view)
  const live = $derived(pass.items.filter((one) => one.trashed === null))
  const trashed = $derived(pass.items.length - live.length)
  const invited = $derived(passSync.invites.length)
  const shared = $derived(
    account.user !== null ||
      invited > 0 ||
      pass.vaults.some((one) => one.shared || one.role !== 'owner'),
  )
  const issues = $derived.by(() => {
    const found = report(pass.items, ui.compromised)
    return (
      found.weak.length + found.reused.size + found.inactive2fa.length + found.compromised.length
    )
  })

  function countIn(vault: string, folder: string | null = null): number {
    return live.filter((one) => one.vault === vault && (folder === null || one.folder === folder))
      .length
  }

  function childrenOf(vault: Vault, parent: string | null): Folder[] {
    return vault.folders
      .filter((one) => one.parent === parent)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  function isOn(scope: Scope): boolean {
    if (view.page !== 'items') return false
    const now = view.scope
    if (now.kind !== scope.kind) return false
    if (now.kind === 'vault' && scope.kind === 'vault')
      return now.vault === scope.vault && now.folder === scope.folder
    return true
  }

  function chosen(scope: Scope) {
    void ui.choose(scope).then(() => onchosen?.())
  }

  function newItem(event: MouseEvent) {
    const box = (event.currentTarget as Element).getBoundingClientRect()
    menu.show(event, newItemEntries(ui, { x: box.left, y: box.bottom }), { until: pass.opened })
  }
</script>

{#snippet folders(vault: Vault, parent: string | null, depth: number)}
  {#each childrenOf(vault, parent) as folder (folder.id)}
    {@const scope = { kind: 'vault' as const, vault: vault.id, folder: folder.id }}
    <button
      class="orden-row"
      class:is-on={isOn(scope)}
      type="button"
      style:padding-inline-start="calc(var(--row-pad) + {depth} * var(--row-indent))"
      onclick={() => chosen(scope)}
      oncontextmenu={(event) =>
        menu.show(event, folderEntries(ui, vault, folder), { until: pass.opened })}
    >
      {#if folder.mark}
        <span class="orden-row-mark folder-mark"
          ><Icon icon={readIcon(folder.mark)} fallback={FolderMark} /></span
        >
      {:else}
        <Glyph icon={FolderMark} class="orden-row-mark" />
      {/if}
      <span class="orden-row-label" dir="auto">{folder.name}</span>
      <span class="orden-row-meta">{countIn(vault.id, folder.id)}</span>
    </button>
    {@render folders(vault, folder.id, depth + 1)}
  {/each}
{/snippet}

<nav class="side" aria-label="Pass">
  <div class="top">
    <button class="orden-button new" type="button" aria-haspopup="menu" onclick={newItem}>
      <Glyph icon={Plus} />
      <span class="grow">New item</span>
      <Glyph icon={ChevronDown} />
    </button>
  </div>

  <div class="scroll" data-scrolls>
    <h3 class="orden-section">Vaults</h3>
    <button
      class="orden-row"
      class:is-on={isOn({ kind: 'all' })}
      type="button"
      onclick={() => chosen({ kind: 'all' })}
    >
      <Glyph icon={Inbox} class="orden-row-mark" />
      <span class="orden-row-label">All items</span>
      <span class="orden-row-meta">{live.length}</span>
    </button>
    {#each pass.vaults as vault (vault.id)}
      {@const scope = { kind: 'vault' as const, vault: vault.id, folder: null }}
      <div class="vault-row">
        <button
          class="orden-row vault"
          class:is-on={isOn(scope)}
          type="button"
          data-vault={vault.id}
          onclick={() => chosen(scope)}
          oncontextmenu={(event) =>
            menu.show(event, vaultEntries(ui, vault), { until: pass.opened })}
        >
          <VaultMark color={vault.color} icon={vault.icon} mark={vault.mark} />
          <span class="orden-row-label" dir="auto">{vault.name}</span>
          {#if vault.shared}<SharedMark />{/if}
          <span class="orden-row-meta count">{countIn(vault.id)}</span>
        </button>
        <button
          class="orden-glyph more"
          type="button"
          aria-label="Vault options"
          title="Vault options"
          onclick={(event) => menu.show(event, vaultEntries(ui, vault), { until: pass.opened })}
        >
          <Glyph icon={Ellipsis} />
        </button>
      </div>
      {@render folders(vault, null, 1)}
    {/each}
    <button
      class="orden-row is-quiet"
      type="button"
      onclick={() => (ui.sheet = { kind: 'vault', vault: null })}
    >
      <Glyph icon={Plus} class="orden-row-mark" />
      <span class="orden-row-label">New vault</span>
    </button>

    <div class="gap"></div>

    <button
      class="orden-row"
      class:is-on={isOn({ kind: 'trash' })}
      type="button"
      onclick={() => chosen({ kind: 'trash' })}
    >
      <Glyph icon={Trash} class="orden-row-mark" />
      <span class="orden-row-label">Trash</span>
      {#if trashed}<span class="orden-row-meta">{trashed}</span>{/if}
    </button>

    {#if shared}
      <h3 class="orden-section">Shared</h3>
      <button
        class="orden-row"
        class:is-on={isOn({ kind: 'shared-with-me' })}
        type="button"
        onclick={() => chosen({ kind: 'shared-with-me' })}
      >
        <Glyph icon={UsersRound} class="orden-row-mark" />
        <span class="orden-row-label">Shared with me</span>
        {#if invited}<span class="orden-row-meta invited" data-invites>{invited}</span>{/if}
      </button>
      <button
        class="orden-row"
        class:is-on={isOn({ kind: 'shared-by-me' })}
        type="button"
        onclick={() => chosen({ kind: 'shared-by-me' })}
      >
        <Glyph icon={Share} class="orden-row-mark" />
        <span class="orden-row-label">Shared by me</span>
      </button>
      <button
        class="orden-row"
        class:is-on={view.page === 'links'}
        type="button"
        onclick={() => void ui.goTo('links').then(() => onchosen?.())}
      >
        <Glyph icon={Link} class="orden-row-mark" />
        <span class="orden-row-label">Secure links</span>
      </button>
    {/if}

    <div class="gap"></div>

    <button
      class="orden-row"
      class:is-on={view.page === 'monitor'}
      type="button"
      onclick={() => void ui.goTo('monitor').then(() => onchosen?.())}
    >
      <Glyph icon={ShieldCheck} class="orden-row-mark" />
      <span class="orden-row-label">Monitor</span>
      {#if issues}<span class="orden-row-meta issues">{issues}</span>{/if}
    </button>
  </div>

  <div class="foot">
    <SyncBadge onadopt={() => (ui.sheet = { kind: 'adopt' })} />
    {#if !corner}
      <button
        class="orden-row"
        class:is-on={view.page === 'settings'}
        type="button"
        onclick={() => void ui.goTo('settings').then(() => onchosen?.())}
      >
        <Glyph icon={Settings} class="orden-row-mark" />
        <span class="orden-row-label">Settings</span>
      </button>
    {/if}
    <button class="orden-row" type="button" onclick={() => pass.lock()}>
      <Glyph icon={Lock} class="orden-row-mark" />
      <span class="orden-row-label">Lock</span>
    </button>
  </div>
  {#if corner}{@render corner(ui)}{/if}
</nav>

<style>
  .side {
    display: flex;
    flex-direction: column;
    min-width: 0;
    height: 100%;
  }

  .top {
    flex: none;
    padding: var(--space-3) var(--space-3) var(--space-2);
  }

  .new {
    width: 100%;
    justify-content: flex-start;
    font-size: var(--text-row);
  }

  .new :global(.glyph) {
    stroke-width: 2;
  }

  .grow {
    flex: 1;
    text-align: start;
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 0 var(--space-2) var(--space-2);
  }

  .orden-section {
    margin: var(--space-3) 0 var(--space-1);
    padding: 0 var(--row-pad);
  }

  .vault-row {
    position: relative;
    display: flex;
  }

  .vault {
    --row-height-sm: 22px;
  }

  .vault-row .more {
    position: absolute;
    inset-inline-end: 2px;
    top: 50%;
    translate: 0 -50%;
    width: var(--row-height-sm);
    height: var(--row-height-sm);
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .vault-row:hover .more,
  .more:focus-visible {
    opacity: 1;
  }

  .vault-row:hover .count {
    visibility: hidden;
  }

  :global([data-touch]) .vault-row .more {
    opacity: 1;
    position: static;
    translate: none;
  }

  .invited {
    min-width: 18px;
    padding: 0 5px;
    border-radius: 99px;
    background: var(--accent-soft);
    color: var(--text-strong);
    text-align: center;
  }

  .issues {
    min-width: 18px;
    padding: 0 5px;
    border-radius: 99px;
    background: color-mix(in srgb, var(--callout-warning) 22%, transparent);
    color: var(--text-strong);
    text-align: center;
  }

  .gap {
    height: var(--space-3);
    flex: none;
  }

  .foot {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: var(--space-2);
    border-top: 1px solid var(--line);
  }

  [dir='auto'] {
    text-align: -webkit-match-parent;
    text-align: match-parent;
  }
</style>
