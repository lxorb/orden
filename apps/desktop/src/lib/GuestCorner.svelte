<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { accentColour } from './accents'
  import { account } from './account.svelte'
  import { closeOnBack } from './backstack.svelte'
  import { initial } from './icons'
  import { message, t } from './i18n.svelte'
  import { fly, LAYER } from './motion'
  import { overlays } from './overlays'
  import { deviceAccent } from './rooms/who'
  import { theme } from './theme.svelte'
  import { viewport } from './viewport.svelte'

  let open = $state(false)
  let error = $state<string | null>(null)
  let corner = $state<HTMLElement>()
  let field = $state<HTMLInputElement>()

  const name = $derived(account.guest?.name ?? '')
  const fill = $derived(accentColour(deviceAccent(), theme.current))

  $effect(() => closeOnBack(open, shut))
  $effect(() => (open ? overlays.show(shut, () => [corner]) : undefined))

  $effect(() => {
    if (open && !viewport.touch) field?.select()
  })

  function toggle() {
    open = !open
    error = null
  }

  function shut() {
    open = false
  }

  async function rename(to: string) {
    if (to.trim() === name) return
    error = null
    try {
      await account.rename(to)
    } catch (failed) {
      error = message(failed, 'that did not work')
    }
  }

  function signIn() {
    shut()
    account.open = true
  }
</script>

<div class="guest-corner" data-covers bind:this={corner}>
  <button
    class="who"
    title={name}
    aria-label={name}
    aria-haspopup="dialog"
    aria-expanded={open}
    onclick={toggle}
  >
    <span class="face orden-badge" style:--badge-fill={fill} aria-hidden="true"
      >{initial(name)}</span
    >
  </button>

  {#if open}
    <div
      class="pop orden-layer"
      role="dialog"
      aria-label={t('Account')}
      transition:fly={{ y: -6, duration: LAYER.rise, easing: cubicOut }}
    >
      <label class="name">
        <span class="caption">{t('Your name')}</span>
        <input
          bind:this={field}
          class="orden-field"
          value={name}
          placeholder={t('Your name')}
          spellcheck="false"
          autocomplete="nickname"
          onchange={(event) => void rename(event.currentTarget.value)}
        />
      </label>
      {#if error}
        <p class="error caption" role="alert">{error}</p>
      {/if}
      <button class="orden-button" onclick={signIn}>{t('Sign in')}</button>
    </div>
  {/if}
</div>

<style>
  .guest-corner {
    --face: var(--leave-size);
    position: absolute;
    top: max(var(--space-2), var(--inset-top));
    inset-inline-end: max(var(--space-2), var(--inset-end));
    z-index: var(--z-float);
  }

  :global([data-touch]) .guest-corner {
    --face: calc(var(--touch-target) * 0.75);
    top: var(--inset-top);
    inset-inline-end: max(var(--space-1), var(--inset-end));
  }

  .who {
    display: grid;
    place-items: center;
    width: var(--leave-size);
    height: var(--leave-size);
    padding: 0;
    border: none;
    background: none;
    cursor: default;
  }

  .face {
    --badge-ink: var(--accent-ink);
    width: var(--face);
    height: var(--face);
    border-radius: 50%;
    font-size: calc(var(--face) * 0.44);
    box-shadow: var(--shadow-sm);
    transition:
      transform var(--dur-fast) var(--ease-spring),
      box-shadow var(--dur-fast) var(--ease-out);
    animation: arrive var(--dur-base) var(--ease-out);
  }

  @keyframes arrive {
    from {
      opacity: 0;
    }
  }

  @media (hover: hover) {
    .who:hover .face {
      box-shadow: var(--shadow-md);
    }
  }

  .who:active .face {
    transform: scale(0.94);
  }

  .who:focus-visible {
    border-radius: 50%;
    outline-offset: 2px;
  }

  .pop {
    position: absolute;
    top: calc(100% + var(--space-2));
    inset-inline-end: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: min(260px, calc(100vw - 2 * var(--space-4)));
    padding: var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--text-row);
  }

  .name {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .caption {
    color: var(--muted);
  }

  .error {
    margin: 0;
    color: var(--danger);
  }
</style>
