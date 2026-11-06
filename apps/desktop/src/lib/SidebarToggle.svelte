<script lang="ts">
  import { tick } from 'svelte'
  import { intoSide } from './focus'
  import { t } from './i18n.svelte'
  import { shortcuts } from './shortcuts.svelte'
  import { type PanelSide, workspace } from './workspace.svelte'

  const {
    side = 'left',
    unseen = false,
  }: {
    side?: PanelSide
    unseen?: boolean
  } = $props()

  let keyed = $state(false)

  const open = $derived(side === 'right' ? workspace.rightShows !== null : !!workspace.openOn(side))
  const label = $derived(
    side === 'left'
      ? open
        ? t('Hide left sidebar')
        : t('Show left sidebar')
      : open
        ? t('Hide right sidebar')
        : t('Show right sidebar'),
  )

  let opened = false

  function pressed(event: MouseEvent & { currentTarget: HTMLElement }) {
    workspace.toggleSidebar(side)
    opened = event.detail === 0 && open
    if (event.detail === 0) void handOn(event.currentTarget)
  }

  async function handOn(from: HTMLElement, left = 8) {
    await tick()
    const lost = !from.isConnected || from.closest('[inert]') !== null
    if (!lost || (document.activeElement !== document.body && document.activeElement !== from))
      return
    const other = [...document.querySelectorAll<HTMLElement>(`[data-side-toggle="${side}"]`)].find(
      (one) => one !== from && one.isConnected && one.closest('[inert]') === null,
    )
    if (other) other.focus()
    else if (left > 0) requestAnimationFrame(() => void handOn(from, left - 1))
  }

  function onward(event: KeyboardEvent & { currentTarget: HTMLElement }) {
    if (event.key !== 'Tab' || event.shiftKey || !opened) return
    const toggle = event.currentTarget
    const landed = intoSide(side)
    if (!landed) return
    event.preventDefault()

    const back = (press: KeyboardEvent) => {
      if (press.key !== 'Tab' || !press.shiftKey) return
      press.preventDefault()
      toggle.focus()
    }
    landed.addEventListener('keydown', back)
    landed.addEventListener('focusout', () => landed.removeEventListener('keydown', back), {
      once: true,
    })
  }
</script>

<button
  class="nib-glyph toggle"
  class:is-on={open}
  class:right={side === 'right'}
  class:nib-said={unseen && !keyed}
  data-side-toggle={side}
  title={shortcuts.tooltip(label, side === 'left' ? 'app.sidebar' : 'app.right-sidebar')}
  aria-label={label}
  aria-pressed={open}
  onclick={pressed}
  onkeydown={onward}
  onfocus={(event) => (keyed = event.currentTarget.matches(':focus-visible'))}
  onblur={() => {
    opened = false
    keyed = false
  }}
>
  <svg viewBox="0 0 14 14">
    <rect x="1" y="2.5" width="12" height="9" rx="1.5" />
    <path class="edge" d="M5.5 2.5v9" />
  </svg>
</button>

<style>
  .toggle {
    align-self: center;
  }

  .toggle svg {
    stroke-width: 1.2;
  }

  .toggle.right svg {
    scale: -1 1;
  }
</style>
