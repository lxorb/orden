<script lang="ts">
  import { onMount } from 'svelte'
  import { t } from '../i18n.svelte'

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

<label class="search">
  <svg viewBox="0 0 24 24" aria-hidden="true"
    ><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg
  >
  <input
    bind:this={field}
    {value}
    oninput={(event) => onvalue(event.currentTarget.value)}
    type="search"
    placeholder={t('Search')}
    autocomplete="off"
    aria-label={label}
  />
</label>

<style>
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 42px;
    padding: 0 14px;
    border-radius: 12px;
    background: var(--card);
    border: 1px solid var(--line);
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
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    font: inherit;
    font-size: 15px;
    color: var(--text);
    outline: none;
  }

  .search input:focus {
    border: 0;
    box-shadow: none;
  }

  .search:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
</style>
