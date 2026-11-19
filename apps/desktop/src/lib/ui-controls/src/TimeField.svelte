<script lang="ts">
  import { clockAfter, clockWords, readClock } from './calendar'

  const {
    value,
    onchange,
    label,
    placeholder = '',
    disabled = false,
    autofocus = false,
  }: {
    value: string
    onchange: (clock: string) => void
    label: string
    placeholder?: string
    disabled?: boolean
    autofocus?: boolean
  } = $props()
  const shown = $derived(value ? clockWords(value) : '')
  function settle(field: HTMLInputElement) {
    const typed = field.value.trim()
    const clock = typed === '' ? '' : readClock(typed)
    field.value = shown
    if (clock === null) {
      field.setAttribute('aria-invalid', 'true')
      return
    }
    field.removeAttribute('aria-invalid')
    if (clock !== value) onchange(clock)
  }
  function onkeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
    if (event.isComposing) return
    if (event.key === 'Enter') {
      settle(event.currentTarget)
      return
    }
    const step = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const from = readClock(event.currentTarget.value) ?? (value || '00:00')
    const next = clockAfter(from, step * (event.shiftKey ? 60 : 5))
    event.currentTarget.value = clockWords(next)
    onchange(next)
  }
  function focusOnMount(node: HTMLElement) {
    if (autofocus) node.focus()
  }
</script>

<input
  class="orden-field is-value clock"
  type="text"
  inputmode="text"
  autocomplete="off"
  spellcheck="false"
  aria-label={label}
  {placeholder}
  {disabled}
  value={shown}
  use:focusOnMount
  onchange={(event) => settle(event.currentTarget)}
  {onkeydown}
/>

<style>
  .clock {
    font-variant-numeric: tabular-nums;
  }
</style>
