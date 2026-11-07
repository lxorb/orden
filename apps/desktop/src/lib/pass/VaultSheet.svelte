<script lang="ts">
  import type { VaultColor, VaultIcon } from '@orden/pass/types'
  import { VAULT_COLORS, VAULT_ICONS } from '@orden/pass/types'
  import { message, t } from '../i18n.svelte'
  import Sheet from '../Sheet.svelte'
  import { theme } from '../theme.svelte'
  import Glyph from './Glyph.svelte'
  import { VAULT_ICON_MARKS, vaultColour } from './icons'
  import { pass } from './store.svelte'
  import type { PassUi } from './ui.svelte'
  import { colorName, iconName } from './vault-words'
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
  let busy = $state(false)
  let wrong = $state('')

  $effect(() => {
    if (!asked) return
    name = editing?.name ?? ''
    description = editing?.description ?? ''
    color = editing?.color ?? 'purple'
    icon = editing?.icon ?? 'home'
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
        await pass.updateVault(editing.id, { name: named, description, color, icon })
        close()
      } else {
        const made = await pass.createVault({ name: named, description, color, icon })
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

<Sheet open={asked !== null} title={editing ? t('Edit vault') : t('New vault')} onclose={close}>
  {#snippet mark()}<VaultMark {color} {icon} />{/snippet}
  <form class="vault-form" onsubmit={kept}>
    <input
      class="nib-field is-value"
      placeholder={t('Name')}
      aria-label={t('Name')}
      bind:value={name}
      data-lands
    />
    <input
      class="nib-field is-value"
      placeholder={t('Description')}
      aria-label={t('Description')}
      bind:value={description}
    />
    <div class="nib-section">{t('Colour')}</div>
    <div class="dots" role="radiogroup" aria-label={t('Colour')}>
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
    <div class="nib-section">{t('Icon')}</div>
    <div class="icons" role="radiogroup" aria-label={t('Icon')}>
      {#each VAULT_ICONS as one (one)}
        <button
          type="button"
          class="nib-glyph icon"
          class:on={icon === one}
          role="radio"
          aria-checked={icon === one}
          aria-label={iconName(one)}
          title={iconName(one)}
          onclick={() => (icon = one)}
        >
          <Glyph icon={VAULT_ICON_MARKS[one]} />
        </button>
      {/each}
    </div>
    {#if wrong}<p class="wrong" role="alert">{wrong}</p>{/if}
    <div class="buttons">
      <button class="nib-button is-quiet" type="button" onclick={close}>{t('Cancel')}</button>
      <button class="nib-button" type="submit" disabled={!name.trim() || busy}>
        {editing ? t('Save') : t('Create vault')}
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

  .nib-section {
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

  .icons {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--row-height), 1fr));
    gap: 2px;
  }

  .icon.on {
    background: var(--accent-soft);
    color: var(--accent);
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
