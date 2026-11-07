<script lang="ts">
  import Copy from 'lucide/dist/esm/icons/copy.mjs'
  import Eye from 'lucide/dist/esm/icons/eye.mjs'
  import EyeOff from 'lucide/dist/esm/icons/eye-off.mjs'
  import { t } from '../i18n.svelte'
  import { copyField } from './copied'
  import Glyph from './Glyph.svelte'
  import StrengthMeter from './StrengthMeter.svelte'

  const {
    label,
    value,
    hidden = false,
    sealed = false,
    mono = false,
    strength = false,
    multiline = false,
  }: {
    label: string
    value: string
    hidden?: boolean
    sealed?: boolean
    mono?: boolean
    strength?: boolean
    multiline?: boolean
  } = $props()

  let shown = $state(false)
  const masked = $derived(sealed || (hidden && !shown))
  const dots = $derived('•'.repeat(Math.min(Math.max(value.length, 8), 16)))
</script>

<div class="field" data-field={label} data-sealed={sealed || undefined}>
  {#if sealed}
    <span class="tap" title={t('Hidden from viewers')}>
      <span class="label">{label}</span>
      <span class="value is-mono">{dots}</span>
    </span>
  {:else}
    <button
      class="tap"
      type="button"
      title={t('Copy {field}', { field: label })}
      onclick={() => void copyField(label, value)}
    >
      <span class="label">{label}</span>
      <span class="value" class:is-mono={mono || hidden} class:is-multiline={multiline && !masked}>
        {masked ? dots : value}
      </span>
    </button>
  {/if}
  {#if hidden && !sealed}
    <button
      class="orden-glyph"
      type="button"
      aria-pressed={shown}
      aria-label={shown ? t('Hide') : t('Show')}
      title={shown ? t('Hide') : t('Show')}
      onclick={() => (shown = !shown)}
    >
      <Glyph icon={shown ? EyeOff : Eye} />
    </button>
  {/if}
  {#if !sealed}
    <button
      class="orden-glyph"
      type="button"
      aria-label={t('Copy {field}', { field: label })}
      title={t('Copy {field}', { field: label })}
      onclick={() => void copyField(label, value)}
    >
      <Glyph icon={Copy} />
    </button>
  {/if}
  {#if strength && !sealed && value !== ''}
    <div class="strength"><StrengthMeter password={value} /></div>
  {/if}
</div>

<style>
  .field {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 var(--space-1);
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
  }

  .field + :global(.field) {
    border-top: 1px solid var(--line);
  }

  .tap {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: default;
  }

  .label {
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .value {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-row);
    color: var(--text-strong);
    -webkit-user-select: text;
    user-select: text;
  }

  .value.is-mono {
    font-family: var(--font-mono);
    letter-spacing: 0.02em;
  }

  .value.is-multiline {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .orden-glyph {
    opacity: 0.7;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .field:hover .orden-glyph,
  .orden-glyph:focus-visible,
  .orden-glyph[aria-pressed='true'] {
    opacity: 1;
  }

  .strength {
    flex-basis: 100%;
    padding: var(--space-1) var(--space-2) 0 0;
  }
</style>
