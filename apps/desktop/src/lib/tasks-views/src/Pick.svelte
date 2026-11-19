<script lang="ts">
  import { Select } from '../../ui-controls/src/api'

  const {
    name,
    value,
    options,
    onchange,
    ...rest
  }: {
    name: string
    value: string
    options: { value: string; label: string }[]
    onchange: (next: string) => void
    [key: `data-${string}`]: string | boolean
  } = $props()
</script>

<div class="pick" {...rest}>
  <span>{name}</span>
  <Select plain label={name} {value} {options} {onchange} />
</div>

<style>
  .pick {
    display: inline-flex;
    gap: var(--space-1);
    align-items: center;
    color: var(--muted);
    font-size: var(--text-sm);
  }
</style>
