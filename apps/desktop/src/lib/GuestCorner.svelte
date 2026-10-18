<script lang="ts">
  /** Who a guest is, in the corner of the one file a link gave them.
   *
   *  A guest alone in a shared file has none of the app round it (alone.svelte.ts), so
   *  the foot of the panel that used to say who they are, and where they changed it, is
   *  not there. This is all of it that is theirs: their initial on the colour their
   *  caret wears for the others, and under it the name the others see and the way to
   *  an account. In the top corner at the end, where the way out of full screen sits:
   *  the canvas's bar is at the foot, and the carets held at a note's edge are at the
   *  start. See docs/sharing.md.
   *
   *  A press outside it shuts it and the press that opened it does not, the way a menu
   *  is shut (`shutBy` in menu.svelte.ts); Escape shuts it as it shuts every layer
   *  (overlays.ts), and back does on a phone. */

  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { accentColour } from './accents'
  import { account } from './account.svelte'
  import { closeOnBack } from './backstack.svelte'
  import { initial } from './icons'
  import { message, t } from './i18n.svelte'
  import { LAYER } from './motion'
  import { overlays } from './overlays'
  import { deviceAccent } from './rooms/who'
  import { theme } from './theme.svelte'
  import { viewport } from './viewport.svelte'

  let open = $state(false)
  let error = $state<string | null>(null)
  let corner = $state<HTMLElement>()
  let field = $state<HTMLInputElement>()

  /** When it opened, on the clock a press's own `timeStamp` is read from; see `openedAt`
   *  in menu.svelte.ts. */
  let openedAt = 0

  const name = $derived(account.guest?.name ?? '')
  /** The colour this device's caret is drawn in for everybody else; see rooms/who.ts. */
  const fill = $derived(accentColour(deviceAccent(), theme.current))

  $effect(() => closeOnBack(open, shut))
  $effect(() => (open ? overlays.show(shut) : undefined))

  // The name is what there is to do here, so a keyboard lands in it. Not under a finger,
  // where it would put the keyboard over the file for somebody who came to sign in.
  $effect(() => {
    if (open && !viewport.touch) field?.select()
  })

  function toggle() {
    open = !open
    error = null
    if (open) openedAt = performance.now()
  }

  function shut() {
    open = false
  }

  /** A press aimed past it, which is every press but the one that opened it. */
  function shutBy(event: MouseEvent) {
    if (!open || event.timeStamp <= openedAt) return
    if (event.target instanceof Node && corner?.contains(event.target)) return
    shut()
  }

  /** Written when the field is left or Enter is pressed, as every field in the settings
   *  is; the room's caret follows the account's name (`rooms.rename` in App.svelte). */
  async function rename(to: string) {
    if (to.trim() === name) return
    error = null
    try {
      await account.rename(to)
    } catch (failed) {
      error = message(failed, 'that did not work')
    }
  }

  /** The sign-in the rest of the app opens. What a link let this device into goes with it
   *  into the account; see `verify` in account.svelte.ts. */
  function signIn() {
    shut()
    account.open = true
  }
</script>

<svelte:window onclick={shutBy} />

<div class="guest-corner" bind:this={corner}>
  <button
    class="who"
    title={name}
    aria-label={name}
    aria-haspopup="dialog"
    aria-expanded={open}
    onclick={toggle}
  >
    <span class="face nib-badge" style:--badge-fill={fill} aria-hidden="true">{initial(name)}</span>
  </button>

  {#if open}
    <div
      class="pop nib-layer"
      role="dialog"
      aria-label={t('Account')}
      transition:fly={{ y: -6, duration: LAYER.rise, easing: cubicOut }}
    >
      <label class="name">
        <span class="caption">{t('Your name')}</span>
        <input
          bind:this={field}
          class="nib-field"
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
      <button class="nib-button" onclick={signIn}>{t('Sign in')}</button>
    </div>
  {/if}
</div>

<style>
  /* In the corner the bar's own buttons were in, as the way out of full screen is, and
     the same size: `--leave-size`. */
  .guest-corner {
    --face: var(--leave-size);
    position: absolute;
    top: max(var(--space-2), var(--inset-top));
    inset-inline-end: max(var(--space-2), var(--inset-end));
    z-index: var(--z-float);
  }

  /* A thumb's target round a smaller face, flush with the top of what the system
     leaves: a phone's note starts its words a target's height down, so the corner
     sits above them rather than over the end of a long first line. */
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
