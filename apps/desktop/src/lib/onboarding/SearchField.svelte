<script lang="ts">
  import { onMount } from 'svelte'

  interface Props {
    value: string
    label: string
    onvalue: (value: string) => void
  }

  const { value, label, onvalue }: Props = $props()
  let field = $state<HTMLInputElement>()

  onMount(() => {
    const focusing = setTimeout(() => field?.focus({ preventScroll: true }), 250)
    return () => clearTimeout(focusing)
  })
</script>

<label class="orden-field search">
  <svg viewBox="0 0 24 24" aria-hidden="true"
    ><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg
  >
  <input
    bind:this={field}
    {value}
    oninput={(event) => onvalue(event.currentTarget.value)}
    type="search"
    placeholder="Search"
    autocomplete="off"
    aria-label={label}
  />
</label>

<style>
  .search {
    gap: 8px;
    height: 42px;
    padding: 0 14px;
    border-radius: 12px;
    background: var(--card);
    box-shadow: var(--shadow-sm);
  }

  svg {
    width: 17px;
    height: 17px;
    flex: none;
    fill: none;
    stroke: var(--muted);
    stroke-width: 2;
    stroke-linecap: round;
  }

  input {
    font-size: 15px;
  }
</style>
