<script lang="ts">
  import type { IconNode } from 'lucide'
  import type { Snippet } from 'svelte'
  import Eye from 'lucide/dist/esm/icons/eye.mjs'
  import EyeOff from 'lucide/dist/esm/icons/eye-off.mjs'
  import Cross from '../Cross.svelte'
  import { t } from '../i18n.svelte'
  import Glyph from './Glyph.svelte'

  /* eslint-disable prefer-const, @typescript-eslint/no-useless-default-assignment -- the content is bindable, and a $props() pattern cannot be split */
  let {
    label = $bindable(),
    value = $bindable(),
    kind = 'text',
    icon,
    named = false,
    mono = false,
    big = false,
    invalid = null,
    placeholder = '',
    inputmode,
    oninput,
    onremove,
    tools,
  }: {
    label: string
    value: string
    kind?: 'text' | 'hidden' | 'date' | 'multiline'
    icon?: IconNode
    named?: boolean
    mono?: boolean
    big?: boolean
    invalid?: string | null
    placeholder?: string
    inputmode?: 'numeric' | 'email' | 'url' | 'text'
    oninput?: () => void
    onremove?: () => void
    tools?: Snippet
  } = $props()
  /* eslint-enable prefer-const, @typescript-eslint/no-useless-default-assignment */

  let shown = $state(false)
  const id = `pass-field-${Math.random().toString(36).slice(2, 8)}`
</script>

<div
  class="field orden-edit-row"
  class:is-invalid={invalid !== null}
  class:is-tall={kind === 'multiline'}
>
  {#if icon}<span class="mark"><Glyph {icon} /></span>{/if}
  <div class="text">
    {#if named}
      <input
        class="label is-named"
        bind:value={label}
        aria-label={t('Field name')}
        placeholder={t('Field name')}
        oninput={() => oninput?.()}
      />
    {:else}
      <label class="label" for={id}>{label}</label>
    {/if}
    {#if kind === 'multiline'}
      <textarea
        {id}
        class="value"
        class:is-mono={mono}
        rows="3"
        bind:value
        {placeholder}
        spellcheck="false"
        oninput={() => oninput?.()}></textarea>
    {:else}
      <input
        {id}
        class="value"
        class:is-mono={mono || kind === 'hidden'}
        class:is-big={big}
        type={kind === 'hidden' && !shown ? 'password' : kind === 'date' ? 'date' : 'text'}
        bind:value
        {placeholder}
        {inputmode}
        autocomplete="off"
        spellcheck="false"
        aria-invalid={invalid !== null}
        aria-label={named ? label : undefined}
        oninput={() => oninput?.()}
      />
    {/if}
    {#if invalid}<span class="wrong" role="alert">{invalid}</span>{/if}
  </div>
  {#if kind === 'hidden'}
    <button
      type="button"
      class="orden-glyph"
      aria-label={shown ? t('Hide') : t('Show')}
      title={shown ? t('Hide') : t('Show')}
      onclick={() => (shown = !shown)}
    >
      <Glyph icon={shown ? EyeOff : Eye} />
    </button>
  {/if}
  {#if tools}{@render tools()}{/if}
  {#if onremove}
    <button
      type="button"
      class="orden-glyph"
      aria-label={t('Remove')}
      title={t('Remove')}
      onclick={() => onremove()}
    >
      <Cross />
    </button>
  {/if}
</div>

<style>
  .field {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
  }

  .mark {
    flex: none;
    color: var(--muted);
  }

  .is-tall .mark {
    align-self: flex-start;
    margin-top: 11px;
  }

  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .label {
    font-size: var(--text-xs);
    color: var(--muted);
  }

  input.label {
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    font-family: var(--font-ui);
  }

  input.label:focus {
    color: var(--text);
  }

  .value {
    width: 100%;
    min-height: 22px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    resize: vertical;
  }

  .value::placeholder,
  .label::placeholder {
    color: var(--muted);
  }

  .value.is-mono {
    font-family: var(--font-mono);
    letter-spacing: 0.02em;
  }

  .value.is-big {
    font-size: var(--text-head);
    font-weight: var(--weight-strong);
  }

  .is-invalid .label {
    color: var(--danger);
  }

  .wrong {
    font-size: var(--text-xs);
    color: var(--danger);
  }

  .orden-glyph {
    flex: none;
    color: var(--muted-strong);
  }

  .orden-glyph :global(.orden-cross) {
    width: var(--icon-lg);
    height: var(--icon-lg);
    stroke-width: 1.5;
  }
</style>
