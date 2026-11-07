<script lang="ts">
  const {
    label,
    on,
    onchange,
    disabled = false,
  }: { label: string; on: boolean; onchange: (on: boolean) => void; disabled?: boolean } = $props()
</script>

<button
  class="orden-setting switch-row"
  type="button"
  role="switch"
  aria-checked={on}
  aria-disabled={disabled || undefined}
  onclick={() => {
    if (!disabled) onchange(!on)
  }}
>
  <span class="name">{label}</span>
  <span class="orden-switch" class:on class:off={disabled} aria-hidden="true"></span>
</button>

<style>
  .switch-row {
    padding: var(--space-1) var(--space-3);
  }

  .switch-row + :global(.switch-row) {
    border-top: 1px solid var(--line);
  }
</style>
