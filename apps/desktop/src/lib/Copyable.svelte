<script lang="ts">
  import CopyButton from './CopyButton.svelte'

  const {
    value,
    label = '',
    plain = false,
    word = '',
    disabled = false,
  }: {
    value: string
    label?: string
    plain?: boolean
    word?: string
    disabled?: boolean
  } = $props()
</script>

<div class="copyable">
  {#if label}<span class="label">{label}</span>{/if}
  <code class="value" class:plain class:off={disabled}>{value}</code>
  {#if !plain}<CopyButton {value} {word} {disabled} />{/if}
</div>

<style>
  .copyable {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-width: 0;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .label {
    flex: none;
    width: 5.5rem;
    color: var(--muted);
  }

  .value {
    flex: 1;
    min-width: 0;
    padding: 6px 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.6;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .value.off {
    color: var(--muted);
  }

  .value.plain {
    border-color: transparent;
    background: none;
    padding-inline-start: 0;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  @media (max-width: 480px) {
    .copyable {
      flex-wrap: wrap;
    }

    .label {
      width: 100%;
    }
  }
</style>
