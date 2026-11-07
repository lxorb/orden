<script lang="ts">
  import type { VaultColor, VaultIcon } from '@orden/pass/types'
  import { theme } from '../theme.svelte'
  import Glyph from './Glyph.svelte'
  import { VAULT_ICON_MARKS, vaultColour } from './icons'

  const { color, icon }: { color: VaultColor; icon: VaultIcon } = $props()

  const ink = $derived(vaultColour(color, theme.current))
</script>

<span
  class="nib-badge vault-mark"
  aria-hidden="true"
  style:--badge-fill="color-mix(in srgb, {ink} 18%, transparent)"
  style:--badge-ink={ink}
>
  <Glyph icon={VAULT_ICON_MARKS[icon]} />
</span>

<style>
  .vault-mark {
    flex: none;
  }
</style>
