<script lang="ts">
  import type { VaultColor, VaultIcon } from '@orden/pass/types'
  import Icon from '../Icon.svelte'
  import { readIcon } from '../ui-kit/src/api'
  import { theme } from '../theme/src/api'
  import Glyph from './Glyph.svelte'
  import { VAULT_ICON_MARKS, vaultColour } from './icons'

  const { color, icon, mark }: { color: VaultColor; icon: VaultIcon; mark?: string | undefined } =
    $props()

  const ink = $derived(vaultColour(color, theme.current))
  const chosen = $derived(mark ? readIcon(mark) : null)
</script>

<span
  class="orden-badge vault-mark"
  aria-hidden="true"
  style:--badge-fill="color-mix(in srgb, {ink} 18%, transparent)"
  style:--badge-ink={ink}
>
  {#if chosen}
    <Icon icon={chosen} fallback={VAULT_ICON_MARKS[icon]} />
  {:else}
    <Glyph icon={VAULT_ICON_MARKS[icon]} />
  {/if}
</span>

<style>
  .vault-mark {
    flex: none;
  }
</style>
