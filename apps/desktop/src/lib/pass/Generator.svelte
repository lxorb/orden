<script lang="ts">
  import { MEMORABLE_WORDS, RANDOM_LENGTH, SEPARATORS } from '@orden/pass/generate'
  import RefreshCw from 'lucide/dist/esm/icons/refresh-cw.mjs'
  import Select from '../Select.svelte'
  import Sheet from '../Sheet.svelte'
  import { segmented } from '../slide'
  import { copyField } from './copied'
  import { separatorLabel } from './field-words'
  import GeneratedText from './GeneratedText.svelte'
  import { type GeneratorMode, generated, keepPrefs, MODES, readPrefs } from './generator-prefs'
  import Glyph from './Glyph.svelte'
  import StrengthMeter from './StrengthMeter.svelte'
  import SwitchRow from './SwitchRow.svelte'
  import type { PassUi } from './ui.svelte'

  const { ui }: { ui: PassUi } = $props()

  const asked = $derived(ui.sheet?.kind === 'generator' ? ui.sheet : null)
  const open = $derived(asked !== null)

  const prefs = $state(readPrefs())
  let turn = $state(0)
  let result = $state('')

  $effect(() => {
    if (!open || turn < 0) return
    const now = $state.snapshot(prefs)
    keepPrefs(now)
    result = generated(now)
  })

  function modeName(mode: GeneratorMode): string {
    switch (mode) {
      case 'random':
        return 'Random'
      case 'memorable':
        return 'Memorable'
      case 'username':
        return 'Username'
    }
  }

  const separators = $derived(SEPARATORS.map((one) => ({ value: one, label: separatorLabel(one) })))
  const usernameSeparators = $derived([
    { value: 'none', label: separatorLabel('none') },
    ...separators,
  ])

  function close() {
    ui.sheet = null
  }

  function use() {
    const chosen = asked?.use
    if (!chosen) return
    chosen(result)
    close()
  }

  function copy() {
    void copyField(prefs.mode === 'username' ? 'Username' : 'Password', result)
  }
</script>

{#snippet slider(
  label: string,
  value: number,
  range: { min: number; max: number },
  set: (next: number) => void,
)}
  <div class="dial">
    <span class="name">{label}</span>
    <input
      class="orden-slider"
      type="range"
      min={range.min}
      max={range.max}
      step="1"
      {value}
      aria-label={label}
      style:--fill="{((value - range.min) / (range.max - range.min)) * 100}%"
      oninput={(event) => set(Number(event.currentTarget.value))}
    />
    <span class="count">{value}</span>
  </div>
{/snippet}

{#snippet foot()}
  <button type="button" class="orden-button is-quiet is-soft" onclick={copy}>Copy</button>
  {#if asked?.use}
    <button type="button" class="orden-button use" data-lands onclick={use}>Use</button>
  {/if}
{/snippet}

<Sheet {open} title="Generate password" onclose={close} {foot}>
  <div class="generator">
    <div class="orden-segmented" role="radiogroup" aria-label="Generate password" use:segmented>
      {#each MODES as mode (mode)}
        <button
          type="button"
          role="radio"
          aria-checked={prefs.mode === mode}
          class:on={prefs.mode === mode}
          onclick={() => (prefs.mode = mode)}>{modeName(mode)}</button
        >
      {/each}
    </div>

    <div class="result">
      <GeneratedText text={result} />
      <button
        type="button"
        class="orden-glyph"
        aria-label="Regenerate"
        title="Regenerate"
        onclick={() => turn++}
      >
        <Glyph icon={RefreshCw} />
      </button>
    </div>
    {#if prefs.mode !== 'username'}<StrengthMeter password={result} />{/if}

    <div class="card">
      {#if prefs.mode === 'random'}
        {@render slider(
          'Characters',
          prefs.random.length,
          RANDOM_LENGTH,
          (next) => (prefs.random.length = next),
        )}
        <SwitchRow
          label="Capital letters"
          on={prefs.random.upper}
          onchange={(on: boolean) => (prefs.random.upper = on)}
        />
        <SwitchRow
          label="Numbers"
          on={prefs.random.digits}
          onchange={(on: boolean) => (prefs.random.digits = on)}
        />
        <SwitchRow
          label="Symbols"
          on={prefs.random.symbols}
          onchange={(on: boolean) => (prefs.random.symbols = on)}
        />
      {:else if prefs.mode === 'memorable'}
        {@render slider(
          'Words',
          prefs.memorable.words,
          MEMORABLE_WORDS,
          (next) => (prefs.memorable.words = next),
        )}
        <div class="choice">
          <span class="name">Separator</span>
          <Select
            plain
            value={prefs.memorable.separator}
            options={separators}
            onchange={(next: string) => {
              prefs.memorable.separator =
                SEPARATORS.find((one) => one === next) ?? prefs.memorable.separator
            }}
          />
        </div>
        <SwitchRow
          label="Capitalize"
          on={prefs.memorable.capitalize}
          onchange={(on: boolean) => (prefs.memorable.capitalize = on)}
        />
        <SwitchRow
          label="Include numbers"
          on={prefs.memorable.numbers}
          onchange={(on: boolean) => (prefs.memorable.numbers = on)}
        />
      {:else}
        {@render slider(
          'Words',
          prefs.username.words,
          MEMORABLE_WORDS,
          (next) => (prefs.username.words = next),
        )}
        <div class="choice">
          <span class="name">Separator</span>
          <Select
            plain
            value={prefs.username.separator}
            options={usernameSeparators}
            onchange={(next: string) => {
              prefs.username.separator =
                next === 'none'
                  ? 'none'
                  : (SEPARATORS.find((one) => one === next) ?? prefs.username.separator)
            }}
          />
        </div>
        <SwitchRow
          label="Capitalize"
          on={prefs.username.capitalize}
          onchange={(on: boolean) => (prefs.username.capitalize = on)}
        />
        <SwitchRow
          label="Include numbers"
          on={prefs.username.numbers}
          onchange={(on: boolean) => (prefs.username.numbers = on)}
        />
        <SwitchRow
          label="Letters as numbers"
          on={prefs.username.leet}
          onchange={(on: boolean) => (prefs.username.leet = on)}
        />
      {/if}
    </div>
  </div>
</Sheet>

<style>
  .generator {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: 0 var(--space-2);
  }

  .result {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }

  .result > :global(:first-child) {
    flex: 1;
    min-width: 0;
  }

  .orden-glyph {
    flex: none;
    color: var(--muted-strong);
  }

  .card {
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    overflow: hidden;
  }

  .card > :global(* + *) {
    border-top: 1px solid var(--line);
  }

  .dial,
  .choice {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--row-height);
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-row);
    color: var(--text);
  }

  .name {
    flex: none;
    min-width: 6rem;
  }

  .orden-slider {
    flex: 1;
    min-width: 0;
  }

  .count {
    flex: none;
    min-width: 2ch;
    font-variant-numeric: tabular-nums;
    text-align: end;
    color: var(--muted-strong);
  }

  .choice > :global(:last-child) {
    flex: 1;
    min-width: 0;
  }

  .use {
    margin-inline-start: auto;
  }
</style>
