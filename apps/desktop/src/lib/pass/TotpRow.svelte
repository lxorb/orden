<script lang="ts">
  import Copy from 'lucide/dist/esm/icons/copy.mjs'
  import { code, totpIn, type TotpCode } from '@orden/pass/totp'
  import { t } from '../i18n.svelte'
  import { copyField } from './copied'
  import Glyph from './Glyph.svelte'

  const { secret, label = t('2FA code') }: { secret: string; label?: string } = $props()

  const totp = $derived(totpIn(secret))
  let now = $state<TotpCode | null>(null)

  $effect(() => {
    const asked = totp
    if (!asked) {
      now = null
      return
    }
    let stale = false
    const tick = () =>
      void code(asked, Date.now()).then((made) => {
        if (!stale) now = made
      })
    tick()
    const timer = setInterval(tick, 1000)
    return () => {
      stale = true
      clearInterval(timer)
    }
  })

  const shown = $derived.by(() => {
    const digits = now?.code ?? ''
    const half = Math.ceil(digits.length / 2)
    return digits.length > 4 ? `${digits.slice(0, half)} ${digits.slice(half)}` : digits
  })
  const left = $derived(totp && now ? now.remaining / totp.period : 0)
  const RING = 2 * Math.PI * 9
</script>

<div class="field totp" data-field={label}>
  {#if totp}
    <button
      class="tap"
      type="button"
      title={t('Copy {field}', { field: label })}
      onclick={() => now && void copyField(label, now.code)}
    >
      <span class="label">{label}</span>
      <span class="value">{shown || '••• •••'}</span>
    </button>
    <svg
      class="ring"
      class:is-low={(now?.remaining ?? 30) <= 5}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle class="track" cx="12" cy="12" r="9" />
      <circle
        class="left"
        cx="12"
        cy="12"
        r="9"
        stroke-dasharray={RING}
        stroke-dashoffset={RING * (1 - left)}
      />
      <text x="12" y="12">{now?.remaining ?? ''}</text>
    </svg>
    <button
      class="nib-glyph"
      type="button"
      aria-label={t('Copy {field}', { field: label })}
      title={t('Copy {field}', { field: label })}
      onclick={() => now && void copyField(label, now.code)}
    >
      <Glyph icon={Copy} />
    </button>
  {:else}
    <div class="tap">
      <span class="label">{label}</span>
      <span class="wrong">{t('This 2FA secret cannot be read')}</span>
    </div>
  {/if}
</div>

<style>
  .field {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
  }

  :global(.field) + .field {
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
    font-family: var(--font-mono);
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    letter-spacing: 0.08em;
    color: var(--text-strong);
  }

  .wrong {
    font-size: var(--text-sm);
    color: var(--danger);
  }

  .ring {
    flex: none;
    width: 26px;
    height: 26px;
    transform: rotate(-90deg);
  }

  .ring circle {
    fill: none;
    stroke-width: 2.25;
  }

  .track {
    stroke: var(--surface-3);
  }

  .left {
    stroke: var(--accent);
    stroke-linecap: round;
    transition: stroke-dashoffset var(--dur-slow) linear;
  }

  .ring.is-low .left {
    stroke: var(--danger);
  }

  .ring text {
    transform: rotate(90deg);
    transform-origin: 12px 12px;
    font-family: var(--font-ui);
    font-size: 8.5px;
    font-weight: var(--weight-strong);
    fill: var(--muted-strong);
    text-anchor: middle;
    dominant-baseline: central;
  }
</style>
