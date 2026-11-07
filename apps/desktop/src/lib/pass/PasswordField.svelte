<script lang="ts">
  import Eye from 'lucide/dist/esm/icons/eye.mjs'
  import EyeOff from 'lucide/dist/esm/icons/eye-off.mjs'
  import WandSparkles from 'lucide/dist/esm/icons/wand-sparkles.mjs'
  import { t } from '../i18n.svelte'
  import Glyph from './Glyph.svelte'
  import StrengthMeter from './StrengthMeter.svelte'
  import type { PassUi } from './ui.svelte'

  /* eslint-disable prefer-const, @typescript-eslint/no-useless-default-assignment -- the content is bindable, and a $props() pattern cannot be split */
  let {
    ui,
    value = $bindable(),
    label,
    onchange,
  }: { ui: PassUi; value: string; label: string; onchange?: () => void } = $props()
  /* eslint-enable prefer-const, @typescript-eslint/no-useless-default-assignment */

  let shown = $state(false)
  const id = `pass-password-${Math.random().toString(36).slice(2, 8)}`

  function generate() {
    ui.sheet = {
      kind: 'generator',
      use: (password) => {
        value = password
        onchange?.()
      },
    }
  }
</script>

<div class="password">
  <div class="line">
    <div class="text">
      <label class="label" for={id}>{label}</label>
      <input
        {id}
        class="value"
        type={shown ? 'text' : 'password'}
        bind:value
        autocomplete="new-password"
        spellcheck="false"
        oninput={() => onchange?.()}
      />
    </div>
    <button
      type="button"
      class="nib-glyph"
      aria-label={shown ? t('Hide') : t('Show')}
      title={shown ? t('Hide') : t('Show')}
      onclick={() => (shown = !shown)}
    >
      <Glyph icon={shown ? EyeOff : Eye} />
    </button>
    <button
      type="button"
      class="nib-glyph"
      aria-label={t('Generate password')}
      title={t('Generate password')}
      onclick={generate}
    >
      <Glyph icon={WandSparkles} />
    </button>
  </div>
  {#if value !== ''}<StrengthMeter password={value} />{/if}
</div>

<style>
  .password {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
  }

  .line {
    display: flex;
    align-items: center;
    gap: var(--space-2);
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

  .value {
    width: 100%;
    min-height: 22px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-strong);
    font-family: var(--font-mono);
    font-size: var(--text-row);
    letter-spacing: 0.02em;
  }

  .nib-glyph {
    flex: none;
    color: var(--muted-strong);
  }
</style>
