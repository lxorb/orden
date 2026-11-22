<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'
  import { backOut, cubicIn, cubicOut } from 'svelte/easing'
  import { dur, fly, platform } from '../../platform/src/api'
  import { told } from './said.svelte'
  import { swipedAway, type ToastAction, toastForm } from './toast-form'
  import { viewport } from './viewport.svelte'

  interface Props extends HTMLAttributes<HTMLDivElement> {
    words: string
    said?: () => string
    actions?: ToastAction[]
    stacked?: boolean
    at?: 'start' | 'center'
    tone?: 'danger'
    ongone?: () => void
  }
  const { words, said, actions = [], stacked = false, at = 'start', tone, ongone, ...rest }: Props = $props()
  const form = $derived(
    toastForm(viewport.device, platform(), typeof navigator === 'undefined' ? '' : navigator.userAgent),
  )
  let pulled = $state({ x: 0, y: 0 })
  let from: { x: number; y: number; id: number } | null = null
  function down(event: PointerEvent) {
    if (form === 'desktop' || !ongone || (event.target instanceof Element && event.target.closest('button'))) return
    from = { x: event.clientX, y: event.clientY, id: event.pointerId }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }
  function move(event: PointerEvent) {
    if (event.pointerId !== from?.id) return
    const dx = event.clientX - from.x
    const dy = event.clientY - from.y
    pulled = form === 'ios' ? { x: 0, y: Math.min(0, dy) } : { x: dx, y: 0 }
  }
  function up(event: PointerEvent) {
    if (event.pointerId !== from?.id) return
    const gone = swipedAway(form, event.clientX - from.x, event.clientY - from.y)
    from = null
    if (gone) ongone?.()
    else pulled = { x: 0, y: 0 }
  }
  function arriving(node: Element) {
    if (form === 'ios') return fly(node, { y: -64, duration: dur(420), easing: backOut, opacity: 0.2 })
    if (form === 'android') return fly(node, { y: 32, duration: dur(250), easing: cubicOut })
    return fly(node, { y: 12, duration: dur(220), easing: cubicOut })
  }
  function leaving(node: Element) {
    if (form === 'ios') return fly(node, { y: pulled.y - 80, duration: dur(220), easing: cubicIn })
    if (form === 'android')
      return pulled.x
        ? fly(node, { x: Math.sign(pulled.x) * 360, duration: dur(200), easing: cubicIn })
        : fly(node, { y: 24, duration: dur(150), easing: cubicIn })
    return fly(node, { y: 12, duration: dur(220), easing: cubicOut })
  }
</script>

<div
  {...rest}
  class="toast"
  class:desktop={form === 'desktop'}
  class:ios={form === 'ios'}
  class:android={form === 'android'}
  class:stacked
  class:center={at === 'center'}
  class:danger={tone === 'danger'}
  class:pulling={pulled.x !== 0 || pulled.y !== 0}
  style:translate={pulled.x || pulled.y ? `${pulled.x}px ${pulled.y}px` : null}
  in:arriving|global
  out:leaving|global
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  {@attach told(said ? said() : words)}
>
  <p>{words}</p>
  {#if actions.length}
    <div class="actions">
      {#each actions as action (action.label)}
        <button class="undo {action.look ?? 'strong'}" onclick={action.run}>{action.label}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .toast {
    grid-column: 1;
    justify-self: start;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--surface-3);
    box-shadow: var(--shadow-lg);
  }
  .toast.stacked {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    max-width: 20rem;
  }
  .toast.center {
    grid-column: 2;
    justify-self: center;
    max-width: 24rem;
    border-color: var(--line);
  }
  .toast.danger {
    border-color: var(--danger);
  }
  p {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    gap: var(--space-3);
  }
  button {
    padding: 0;
    border: none;
    background: none;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: default;
    transition: opacity var(--dur-fast) var(--ease-out);
  }
  button:active {
    opacity: 0.6;
  }
  .strong {
    color: var(--accent);
    font-weight: var(--weight-strong);
  }
  .link {
    color: var(--accent);
  }
  .quiet {
    color: var(--muted-strong);
  }
  .quiet:hover {
    color: var(--text-strong);
  }
  .quieter {
    color: var(--muted);
  }
  :global([data-touch]) .toast.stacked:not(.center) {
    justify-self: stretch;
    max-width: none;
  }
  :global([data-touch]) button {
    min-height: var(--touch-target);
  }
  .toast.ios,
  .toast.android {
    grid-column: 1;
    justify-self: stretch;
    max-width: none;
    touch-action: none;
    -webkit-user-select: none;
    user-select: none;
  }
  .toast.ios.pulling,
  .toast.android.pulling {
    transition: none;
  }
  .toast.ios:not(.pulling),
  .toast.android:not(.pulling) {
    transition: translate var(--dur-base) var(--ease-out);
  }
  .toast.ios {
    position: fixed;
    top: calc(var(--inset-top) + var(--space-2));
    inset-inline: max(var(--space-3), var(--inset-left)) max(var(--space-3), var(--inset-right));
    z-index: var(--z-notice);
    padding: var(--space-3) var(--space-4);
    border: none;
    border-radius: 18px;
    background: var(--surface-3);
    box-shadow: 0 8px 32px rgb(0 0 0 / 0.18);
  }
  .toast.android {
    margin-bottom: var(--keyboard, 0px);
    min-height: 48px;
    padding: var(--space-1) var(--space-1) var(--space-1) var(--space-4);
    border: none;
    border-radius: 4px;
    background: var(--text-strong);
    box-shadow:
      0 3px 5px -1px rgb(0 0 0 / 0.2),
      0 6px 10px 0 rgb(0 0 0 / 0.14);
  }
  .toast.android p {
    color: var(--surface);
  }
  .toast.android .strong,
  .toast.android .link {
    color: color-mix(in srgb, var(--accent) 55%, var(--surface));
  }
  .toast.android .quiet,
  .toast.android .quieter {
    color: color-mix(in srgb, var(--surface) 70%, transparent);
  }
  .toast.ios p,
  .toast.android p {
    font-size: var(--text-base);
    line-height: 1.35;
  }
  .toast.ios .actions,
  .toast.android .actions {
    gap: 0;
    margin-inline-start: auto;
  }
  .toast.ios.stacked .actions,
  .toast.android.stacked .actions {
    justify-content: flex-end;
  }
  .toast.ios button,
  .toast.android button {
    min-width: 44px;
    min-height: 44px;
    padding: 0 var(--space-3);
    font-size: var(--text-base);
  }
  .toast.android button {
    min-height: 48px;
    text-transform: none;
    font-weight: var(--weight-strong);
  }
</style>
