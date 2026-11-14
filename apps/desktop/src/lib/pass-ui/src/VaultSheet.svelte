<script lang="ts">
  import type { VaultColor, VaultIcon } from '@orden/pass/types'
  import { VAULT_COLORS } from '@orden/pass/types'
  import { iconChoice } from '../../icon-choice.svelte'
  import { message } from '../../ui-kit/src/api'
  import { Sheet } from '../../ui-controls/src/api'
  import { theme } from '../../theme/src/api'
  import { vaultColour } from '../../pass-sync/src/api'
  import { pass } from '../../pass-sync/src/api'
  import type { PassUi } from '../../pass-sync/src/api'
  import { colorName } from '../../pass-sync/src/api'
  import VaultMark from './VaultMark.svelte'

  const { ui }: { ui: PassUi } = $props()

  const asked = $derived(ui.sheet?.kind === 'vault' ? ui.sheet : null)
  const editing = $derived(
    asked?.vault ? (pass.vaults.find((one) => one.id === asked.vault) ?? null) : null,
  )

  let name = $state('')
  let description = $state('')
  let color = $state<VaultColor>('purple')
  let icon = $state<VaultIcon>('home')
  let picked = $state<string | undefined>(undefined)
  let busy = $state(false)
  let wrong = $state('')

  $effect(() => {
    if (!asked) return
    name = editing?.name ?? ''
    description = editing?.description ?? ''
    color = editing?.color ?? 'purple'
    icon = editing?.icon ?? 'home'
    picked = editing?.mark
    wrong = ''
  })

  const close = () => (ui.sheet = null)

  async function kept(event: SubmitEvent) {
    event.preventDefault()
    const named = name.trim()
    if (!named || busy) return
    busy = true
    try {
      if (editing) {
        await pass.updateVault(editing.id, {
          name: named,
          description,
          color,
          icon,
          mark: picked,
        })
        close()
      } else {
        const made = await pass.createVault({
          name: named,
          description,
          color,
          icon,
          ...(picked ? { mark: picked } : {}),
        })
        close()
        await ui.choose({ kind: 'vault', vault: made.id, folder: null })
      }
    } catch (error) {
      wrong = message(error, 'The vault could not be kept.')
    } finally {
      busy = false
    }
  }
</script>

<Sheet open={asked !== null} title={editing ? 'Edit vault' : 'New vault'} onclose={close}>
  {#snippet mark()}<VaultMark {color} {icon} mark={picked} />{/snippet}
  <form class="vault-form" onsubmit={kept}>
    <input
      class="orden-field is-value"
      placeholder="Name"
      aria-label="Name"
      bind:value={name}
      data-lands
    />
    <input
      class="orden-field is-value"
      placeholder="Description"
      aria-label="Description"
      bind:value={description}
    />
    <div class="orden-section">Colour</div>
    <div class="dots" role="radiogroup" aria-label="Colour">
      {#each VAULT_COLORS as one (one)}
        <button
          type="button"
          class="dot"
          class:on={color === one}
          role="radio"
          aria-checked={color === one}
          aria-label={colorName(one)}
          title={colorName(one)}
          style:--dot={vaultColour(one, theme.current)}
          onclick={() => (color = one)}
        ></button>
      {/each}
    </div>
    <div class="orden-section">Icon</div>
    <button
      type="button"
      class="orden-row chooser"
      onclick={() => iconChoice.pass(picked ?? null, (chosen) => (picked = chosen ?? undefined))}
    >
      <VaultMark {color} {icon} mark={picked} />
      <span class="orden-row-label">Choose an icon</span>
    </button>
    {#if wrong}<p class="wrong" role="alert">{wrong}</p>{/if}
    <div class="buttons">
      <button class="orden-button is-quiet" type="button" onclick={close}>Cancel</button>
      <button class="orden-button" type="submit" disabled={!name.trim() || busy}>
        {editing ? 'Save' : 'Create vault'}
      </button>
    </div>
  </form>
</Sheet>

<style>
  .vault-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: 0 var(--space-2) var(--space-2);
  }

  .orden-section {
    margin: var(--space-2) 0 0;
  }

  .dots {
    display: grid;
    grid-template-columns: repeat(10, minmax(0, 32px));
    gap: 2px;
  }

  .dot {
    display: grid;
    place-items: center;
    height: 32px;
    padding: 0;
    border: none;
    background: none;
  }

  .dot::after {
    content: '';
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--dot);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--text) 28%, transparent);
    transition: box-shadow var(--dur-fast) var(--ease-out);
  }

  .dot.on::after {
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 4px var(--accent);
  }

  .chooser {
    gap: var(--space-2);
  }

  .wrong {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--danger);
  }

  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
