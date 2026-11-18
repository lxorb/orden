<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    label: string
    checked: boolean
    tight?: boolean
    onpick: () => void
    children: Snippet
  }

  const { label, checked, tight = false, onpick, children }: Props = $props()
</script>

<button class="card" class:tight type="button" role="radio" aria-checked={checked} onclick={onpick}>
  {@render children()}
  <span class="label"><span class="ring" aria-hidden="true"></span>{label}</span>
</button>

<style>
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 14px 12px 12px;
    border-radius: 16px;
    border: 1.5px solid transparent;
    cursor: pointer;
    background: var(--card);
    box-shadow:
      var(--shadow-sm),
      0 8px 24px rgb(16 24 40 / 0.08);
    color: var(--text);
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    transition:
      border-color 0.25s var(--ease-out),
      transform 0.25s var(--ease-out);
  }

  .card:hover {
    transform: translateY(-2px);
  }

  .card[aria-checked='true'] {
    border-color: var(--accent);
  }

  .label {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .ring {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1.5px solid var(--line-strong);
    display: grid;
    place-items: center;
  }

  .card[aria-checked='true'] .ring {
    background: var(--accent);
    border-color: var(--accent);
  }

  .card[aria-checked='true'] .ring::after {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #fff;
  }

  @media (max-width: 640px) {
    .tight {
      padding: 10px 8px;
    }
  }
</style>
