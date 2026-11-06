<script lang="ts">
  const {
    label,
    checked,
    onchange,
  }: { label: string; checked: boolean; onchange: (on: boolean) => void } = $props()
</script>

<label class="tick">
  <input
    type="checkbox"
    class="nib-checkbox"
    {checked}
    onchange={(event) => onchange(event.currentTarget.checked)}
  />
  <span>{label}</span>
</label>

<style>
  .tick {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-inline-end: auto;
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--muted-strong);
    white-space: nowrap;
  }

  .tick input {
    flex: none;
    margin: 0;
  }
</style>
