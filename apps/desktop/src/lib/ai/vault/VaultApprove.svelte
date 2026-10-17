<script lang="ts">
  /** Another of the reader's devices asking for their AI accounts (docs/ai.md, "Every
   *  device"): *"Phone wants your AI accounts  482 913"*, with Don't allow and Allow.
   *
   *  The bubble another computer asks for web logins in (WebApprove.svelte), in the same
   *  shape and the same two answers. It comes up on the device that answered the asking
   *  one, once that device has revealed the key it committed to: the six digits are worked
   *  out from both devices' keys and nonces, the asking device shows the same six in
   *  Settings > AI, and a key slipped in between would show others (vault.svelte.ts).
   *  Allow wraps the key to the one these digits came from. Escape puts it away without
   *  an answer, and the question comes back with the next read. */
  import { onMount } from 'svelte'
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { accentFor } from '../../accents'
  import { t } from '../../i18n.svelte'
  import { initial } from '../../icons'
  import { dur } from '../../motion'
  import { overlays } from '../../overlays'
  import { theme } from '../../theme.svelte'
  import type { Vault } from './vault.svelte'

  const { vault }: { vault: Vault } = $props()

  const asking = $derived(vault.asking[0] ?? null)
  const device = $derived(asking?.name ?? '')

  let card = $state<HTMLElement>()

  $effect(() => {
    const one = asking
    if (!one) return
    return overlays.show(() => {
      vault.dismiss(one.id)
    })
  })

  onMount(() => {
    card?.focus({ preventScroll: true })
  })
</script>

{#if asking}
  <div
    class="approve nib-bubble is-pressable nib-host"
    role="dialog"
    aria-label={t('{device} wants your AI accounts', { device })}
    tabindex="-1"
    bind:this={card}
    transition:fly={{ y: -6, duration: dur(120), easing: cubicOut }}
  >
    <p class="what">
      <span
        class="nib-badge"
        style:--badge-fill={accentFor(device, theme.current)}
        style:--badge-ink="var(--accent-ink)"
        aria-hidden="true">{initial(device)}</span
      >
      <span class="device">{t('{device} wants your AI accounts', { device })}</span>
      <span class="digits">{asking.digits}</span>
    </p>
    <div class="rows">
      <button class="nib-button is-quiet" onclick={() => void vault.deny(asking.id)}>
        {t('Don’t allow')}
      </button>
      <button class="nib-button" onclick={() => void vault.allow(asking.id)}>{t('Allow')}</button>
    </div>
  </div>
{/if}

<style>
  .approve {
    position: fixed;
    top: calc(var(--titlebar-height) + var(--space-2));
    inset-inline-end: var(--space-3);
    z-index: var(--z-notice);
    width: min(22rem, calc(100vw - var(--space-6)));
    max-width: none;
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .what {
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    color: var(--text-strong);
    font-size: var(--text-row);
  }

  .device {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .digits {
    flex: none;
    color: var(--text-strong);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
  }

  .rows {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
