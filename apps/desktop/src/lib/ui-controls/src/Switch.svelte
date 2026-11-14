<script lang="ts">
  const {
    on,
    label,
    disabled = false,
    onchange,
  }: { on: boolean; label: string; disabled?: boolean; onchange: (on: boolean) => void } = $props()

  function flip(event: Event) {
    event.stopPropagation()
    if (!disabled) onchange(!on)
  }
</script>

<span
  class="orden-switch"
  class:on
  class:off={disabled}
  role="switch"
  tabindex="0"
  aria-checked={on}
  aria-label={label}
  aria-disabled={disabled || undefined}
  onclick={flip}
  onkeydown={(event) => {
    if (event.key !== ' ' && event.key !== 'Enter') return
    event.preventDefault()
    flip(event)
  }}
></span>
