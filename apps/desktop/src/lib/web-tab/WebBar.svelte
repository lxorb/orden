<script lang="ts">
  /** The bar over a page: back, forward, reload, the address, a clip and the dots.
   *
   *  A browser's row, in nib's shapes. The same `.nib-glyph` squares the find bar and
   *  the sidebar's foot are made of, the same `.nib-field` every box you type in is,
   *  and the same row scale, so a thumb gets 56px where a pointer gets 28 without a
   *  second design for a small screen. Under the strip and above the page, which is
   *  where the find bar sits too: a bar over the page would cover the first line of
   *  it.
   *
   *  The field is one control with two faces. Nobody typing in it wants to read a
   *  title, and nobody reading wants to read an address: so it holds the whole
   *  address while it has the keyboard and the site and the page's own name while it
   *  does not. The site is there whichever face is up - it is the one part of an
   *  address worth being sure of, and an `http:` page says so in front of its own
   *  name.
   *
   *  Nothing here decides anything. Every press is handed up to the tab. */

  import { onMount } from 'svelte'
  import ArrowLeft from 'lucide/dist/esm/icons/arrow-left.mjs'
  import ArrowRight from 'lucide/dist/esm/icons/arrow-right.mjs'
  import Ellipsis from 'lucide/dist/esm/icons/ellipsis.mjs'
  import RotateCw from 'lucide/dist/esm/icons/rotate-cw.mjs'
  import Scissors from 'lucide/dist/esm/icons/scissors.mjs'
  import { t } from '../i18n.svelte'
  import { plainOrigin } from './address'
  import type { Page } from './pages.svelte'

  const {
    page,
    /** Whether a clip can read the page's words. In a browser it cannot - the
     *  frame's document is the site's - so the glyph says it will keep the link. */
    reads,
    /** Whether the pane this bar is in has the focus, so Ctrl+L lands in one bar
     *  rather than in all of them. */
    focused,
    /** How many times somebody has asked for the address field. A count rather than
     *  a call, because the key is pressed in the window and the field is in whichever
     *  pane has the focus; see pages.svelte.ts. */
    asked,
    onstep,
    onaddress,
    onclip,
    onmenu,
    ontyping,
  }: {
    page: Page
    reads: boolean
    focused: boolean
    asked: number
    onstep: (step: 'back' | 'forward' | 'reload') => void
    onaddress: (typed: string) => void
    onclip: () => void
    onmenu: (event: MouseEvent) => void
    ontyping: (on: boolean) => void
  } = $props()

  let field = $state<HTMLInputElement>()
  /** Whether the field itself has the keyboard, which is what swaps its two faces.
   *  Not the same as `focused`, which is about the pane. */
  let editing = $state(false)

  /** The site, plainly, and the page's own name after it. The name is the page's
   *  while it has said one and the address's host until then, so the bar never reads
   *  as empty. */
  const resting = $derived.by(() => {
    if (page.url === null) return ''

    const site = plainOrigin(page.url)
    return page.title ? `${site} - ${page.title}` : site
  })

  /** Puts the resting face back on a field nobody is typing in. Done by writing the
   *  value rather than by binding it: a bound value fights the keys somebody is
   *  pressing, and this is a field with two faces rather than one value. */
  $effect(() => {
    const box = field
    if (box && !editing && box.value !== resting) box.value = resting
  })

  /** Ctrl+L. Only the bar in the pane that has the focus answers. */
  let answered = asked
  $effect(() => {
    if (asked === answered) return

    answered = asked
    if (focused) take()
  })

  /** A tab with nowhere to go yet: the field takes the keyboard, because typing an
   *  address is the only thing to do with an empty tab. */
  onMount(() => {
    if (page.url === null && focused) take()
  })

  function take() {
    field?.focus()
    field?.select()
  }

  function onFocus() {
    editing = true
    ontyping(true)
    if (field) field.value = page.url ?? ''
    field?.select()
  }

  function onBlur() {
    editing = false
    ontyping(false)
    if (field) field.value = resting
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault()
      onaddress(field?.value ?? '')
      field?.blur()
      return
    }

    if (event.key !== 'Escape') return

    // The layer above the bar has its own Escape; a field being typed in keeps
    // this one. See overlays.ts.
    event.preventDefault()
    event.stopPropagation()
    field?.blur()
  }
</script>

<div class="webbar">
  <button
    class="nib-glyph"
    title={t('Back')}
    aria-label={t('Back')}
    disabled={!page.back}
    onclick={() => onstep('back')}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {#each ArrowLeft as [tag, attrs], index (index)}
        <svelte:element this={tag} {...attrs} />
      {/each}
    </svg>
  </button>

  <button
    class="nib-glyph"
    title={t('Forward')}
    aria-label={t('Forward')}
    disabled={!page.forward}
    onclick={() => onstep('forward')}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {#each ArrowRight as [tag, attrs], index (index)}
        <svelte:element this={tag} {...attrs} />
      {/each}
    </svg>
  </button>

  <!-- One glyph for both, the way a browser has one: it turns while the page is
       coming, which is the whole of what a spinner would have said. -->
  <button
    class="nib-glyph"
    class:turning={page.loading}
    title={t('Reload')}
    aria-label={t('Reload')}
    onclick={() => onstep('reload')}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {#each RotateCw as [tag, attrs], index (index)}
        <svelte:element this={tag} {...attrs} />
      {/each}
    </svg>
  </button>

  <input
    bind:this={field}
    class="nib-field address"
    type="text"
    spellcheck="false"
    autocapitalize="off"
    autocorrect="off"
    placeholder={t('Address')}
    aria-label={t('Address')}
    onfocus={onFocus}
    onblur={onBlur}
    onkeydown={onKeydown}
  />

  <button
    class="nib-glyph"
    title={reads ? t('Clip this page') : t('Clip the link')}
    aria-label={reads ? t('Clip this page') : t('Clip the link')}
    disabled={page.url === null}
    onclick={onclip}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {#each Scissors as [tag, attrs], index (index)}
        <svelte:element this={tag} {...attrs} />
      {/each}
    </svg>
  </button>

  <button
    class="nib-glyph"
    title={t('More')}
    aria-label={t('More')}
    aria-haspopup="menu"
    onclick={onmenu}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {#each Ellipsis as [tag, attrs], index (index)}
        <svelte:element this={tag} {...attrs} />
      {/each}
    </svg>
  </button>
</div>

<style>
  /* The find bar's own row, because it is the same kind of thing in the same place:
     a row of controls between the strip and what is being read. */
  .webbar {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    background: var(--surface);
    border-bottom: 1px solid var(--line);
  }

  /* The field takes whatever the glyphs leave, and never less than can be read. */
  .address {
    flex: 1 1 8rem;
    min-width: 0;
  }

  /* A page on its way says so where a browser says it: on the button that would
     stop it. One turn a second, which is slow enough to read as waiting rather
     than as an animation. */
  .turning > svg {
    animation: turn 1s linear infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .turning > svg {
      animation: none;
      opacity: 0.6;
    }
  }

  @keyframes turn {
    to {
      transform: rotate(1turn);
    }
  }
</style>
