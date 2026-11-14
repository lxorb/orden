<script lang="ts">
  import type { Snippet } from 'svelte'
  import Logo from './Logo.svelte'

  interface Props {
    name: string
    icon?: string | null
    colour?: string | null
    checked: boolean
    later?: string
    glyph?: Snippet
    onpick: () => void
  }

  const { name, icon = null, colour = null, checked, later = '', glyph, onpick }: Props = $props()
</script>

<button
  class="tile"
  class:later={!!later}
  type="button"
  role="radio"
  aria-checked={checked}
  onclick={onpick}
>
  <span class="ring" aria-hidden="true"></span>
  <span class="mark">
    {#if glyph}{@render glyph()}{:else}<Logo {name} {icon} {colour} />{/if}
  </span>
  <span class="label">{name}</span>
  {#if later}<span class="soon">{later}</span>{/if}
</button>

<style>
  .tile {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 10px;
    height: 104px;
    padding: 18px 8px 0;
    border-radius: 16px;
    border: 1.5px solid transparent;
    cursor: pointer;
    background: var(--card);
    box-shadow:
      var(--shadow-sm),
      0 8px 24px rgb(16 24 40 / 0.08);
    color: var(--text);
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    min-width: 0;
    transition:
      border-color 0.25s var(--ease-out),
      transform 0.25s var(--ease-out);
  }

  .tile:hover {
    transform: translateY(-2px);
  }

  .tile[aria-checked='true'] {
    border-color: var(--accent);
  }

  .mark {
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
  }

  .later .mark {
    opacity: 0.55;
  }

  .label {
    display: block;
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .soon {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 7px;
    font-size: 11px;
    color: var(--muted);
    text-align: center;
  }

  .ring {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 1.5px solid var(--line-strong);
    display: grid;
    place-items: center;
    transition: all 0.25s var(--ease-out);
  }

  .tile[aria-checked='true'] .ring {
    background: var(--accent);
    border-color: var(--accent);
  }

  .tile[aria-checked='true'] .ring::after {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #fff;
  }
</style>
