<script lang="ts">
  import { t } from '../i18n.svelte'
  import { hasRequested, request } from './kept'
  import Logo from './Logo.svelte'

  interface Props {
    name: string
    icon?: string | null
    colour?: string | null
    asked: string
  }

  const { name, icon = null, colour = null, asked }: Props = $props()

  let sent = $derived(hasRequested(asked))

  function ask() {
    request(asked)
    sent = true
  }
</script>

<div class="row">
  <Logo {name} {icon} {colour} size={28} />
  <span class="name">{name}</span>
  {#if sent}
    <span class="pill done" role="status" aria-label={t('Done')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
    </span>
  {:else}
    <button class="pill" type="button" onclick={ask}>{t('Request')}</button>
  {/if}
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 13px 16px;
    font-size: 15px;
  }

  .name {
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pill {
    margin-inline-start: auto;
    min-width: 74px;
    height: 30px;
    padding: 0 14px;
    border-radius: 999px;
    border: 0;
    cursor: pointer;
    background: var(--accent-soft);
    color: var(--accent);
    font: inherit;
    font-size: 13.5px;
    font-weight: 600;
    display: inline-grid;
    place-items: center;
    flex: none;
  }

  .pill.done {
    background: color-mix(in srgb, var(--success) 16%, transparent);
    color: var(--success);
    cursor: default;
  }

  .pill svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
