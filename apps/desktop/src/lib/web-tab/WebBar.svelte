<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import ArrowDownToLine from 'lucide/dist/esm/icons/arrow-down-to-line.mjs'
  import ArrowLeft from 'lucide/dist/esm/icons/arrow-left.mjs'
  import ArrowRight from 'lucide/dist/esm/icons/arrow-right.mjs'
  import Ellipsis from 'lucide/dist/esm/icons/ellipsis.mjs'
  import Globe from 'lucide/dist/esm/icons/globe.mjs'
  import Lock from 'lucide/dist/esm/icons/lock.mjs'
  import RotateCw from 'lucide/dist/esm/icons/rotate-cw.mjs'
  import X from 'lucide/dist/esm/icons/x.mjs'
  import { t } from '../i18n.svelte'
  import { longPress } from '../longpress'
  import { dur } from '../motion'
  import { middleOpens } from '../new-tab'
  import { overlays } from '../overlays'
  import { shortcuts } from '../shortcuts.svelte'
  import { showTab } from '../shortcuts/registry'
  import { present } from '../slides/present.svelte'
  import AddressField from './AddressField.svelte'
  import PrivateMark from './PrivateMark.svelte'
  import ExtensionButtons from './ExtensionButtons.svelte'
  import { barKey, stops, type ZoomStep } from './bar-keys'
  import { watchRows } from './bar-rows'
  import { isWebAddress } from './address'
  import { meantBy, shownUrl } from './idn'
  import { downloads, progressOf } from './downloads.svelte'
  import { addressing } from './passed.svelte'
  import { invoke, isDesktop } from '../tauri'
  import { IN_A_PAGE } from '../trap'
  import { type Page, siteMark } from './pages.svelte'

  const {
    page,
    tab,
    focused,
    book,
    onstep,
    onhistory,
    onaddress,
    onnote,
    onmenu,
    onsite,
    ondownloads,
    ontyping,
    onzoom,
    onbrowser,
    extending = null,
    ground,
    theme,
  }: {
    page: Page
    tab: string
    ground?: { colour: string } | undefined
    theme?: 'dark' | 'light' | undefined
    focused: boolean
    book: string
    onstep: (step: 'back' | 'forward' | 'reload' | 'fresh' | 'stop', press?: MouseEvent) => void
    onhistory: (forward: boolean, event: MouseEvent) => void
    onaddress: (said: string, aside: boolean, typed: string) => void
    onnote?: (path: string) => void
    onmenu: (event: MouseEvent) => void
    onsite: () => void
    ondownloads: () => void
    ontyping: (on: boolean) => void
    onzoom: (step: ZoomStep) => void
    onbrowser: (which: 'history' | 'clear') => void
    extending?: {
      addable: string | null
      open: string | null
      onpress: (id: string, anchor: HTMLElement) => void
      onlist: (anchor: HTMLElement) => void
      onadd: (anchor: HTMLElement) => void
    } | null
  } = $props()

  const progress = $derived(progressOf(downloads.list))
  const RING = 2 * Math.PI * 10

  const mark = $derived(siteMark(page.icon, page.url))

  let marked = $state(true)

  $effect(() => {
    if (mark) marked = true
  })

  let field = $state<{ take(): void }>()

  const resting = $derived(shownUrl(page.url ?? ''))

  const started = untrack(() => page.url === null)

  onMount(() => {
    const was = page.keyboard
    page.keyboard = null
    if (focused && (was === 'address' || (started && !page.seen))) take()
    else if (focused && was === 'page' && isDesktop)
      void invoke('keyboard_back', { tab }).catch(() => undefined)
    page.seen = true

    const key = (event: KeyboardEvent) => {
      if (!focused || overlays.depth > 0 || present.on) return

      const said = barKey(event, shortcuts)
      if (!said || (said.to === 'zoom' && !page.live)) return

      event.preventDefault()
      if (said.to === 'address') take()
      else if (said.to === 'history' || said.to === 'clear') onbrowser(said.to)
      else if (said.to === 'step') onstep(said.step)
      else if (said.to === 'zoom') onzoom(said.step)
      else showTab(said.at)
    }

    const escape = (event: KeyboardEvent) => {
      if (!focused || !stops(event, page.loading, shortcuts)) return

      event.preventDefault()
      onstep('stop')
    }

    window.addEventListener('keydown', key, true)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('keydown', escape)
      if (focused && document.documentElement.hasAttribute(IN_A_PAGE)) page.keyboard = 'page'
    }
  })

  function take() {
    field?.take()
  }

  const answered = untrack(() => addressing.asked)
  $effect(() => {
    const asked = addressing.asked
    if (asked && asked !== answered && asked.page === page) untrack(take)
  })

  let row = $state<HTMLElement>()
  let alone = $state(false)
  $effect(() => {
    if (!row) return
    return watchRows(row, (said) => (alone = said))
  })
</script>

<div
  class="webbar"
  class:alone
  bind:this={row}
  class:grounded={ground !== undefined}
  data-theme={theme}
  style:--web-ground={ground?.colour}
>
  <button
    class="nib-glyph"
    title={shortcuts.tooltip(t('Back'), 'app.back')}
    aria-label={t('Back')}
    disabled={!page.back}
    onclick={(event) => onstep('back', event)}
    use:middleOpens={(event) => onstep('back', event)}
    oncontextmenu={(event) => onhistory(false, event)}
    use:longPress={(event) => onhistory(false, event)}
  >
    <svg class="nib-mirror" viewBox="0 0 24 24" aria-hidden="true">
      {#each ArrowLeft as [tag, attrs], index (index)}
        <svelte:element this={tag} {...attrs} />
      {/each}
    </svg>
  </button>

  <button
    class="nib-glyph"
    title={shortcuts.tooltip(t('Forward'), 'app.forward')}
    aria-label={t('Forward')}
    disabled={!page.forward}
    onclick={(event) => onstep('forward', event)}
    use:middleOpens={(event) => onstep('forward', event)}
    oncontextmenu={(event) => onhistory(true, event)}
    use:longPress={(event) => onhistory(true, event)}
  >
    <svg class="nib-mirror" viewBox="0 0 24 24" aria-hidden="true">
      {#each ArrowRight as [tag, attrs], index (index)}
        <svelte:element this={tag} {...attrs} />
      {/each}
    </svg>
  </button>

  <button
    class="nib-glyph"
    title={page.loading
      ? shortcuts.tooltip(t('Stop'), 'web.stop')
      : shortcuts.tooltip(t('Reload'), 'web.reload')}
    aria-label={page.loading ? t('Stop') : t('Reload')}
    onclick={(event) => onstep(page.loading ? 'stop' : 'reload', event)}
    use:middleOpens={(event) => onstep('reload', event)}
  >
    {#key page.loading}
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        in:scale={{ start: 0.6, duration: dur(120), easing: cubicOut }}
      >
        {#each page.loading ? X : RotateCw as [tag, attrs], index (index)}
          <svelte:element this={tag} {...attrs} />
        {/each}
      </svg>
    {/key}
  </button>

  <button
    class="nib-glyph site"
    data-opens="site"
    title={t('Site information')}
    aria-label={t('Site information')}
    aria-haspopup="dialog"
    disabled={page.url === null || !isWebAddress(page.url)}
    onclick={onsite}
  >
    {#if mark && marked}
      <img class="mark" src={mark} alt="" draggable="false" onerror={() => (marked = false)} />
    {:else}
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {#each page.url?.startsWith('https:') ? Lock : Globe as [tag, attrs], index (index)}
          <svelte:element this={tag} {...attrs} />
        {/each}
      </svg>
    {/if}
  </button>

  {#if page.inPrivate}
    <span class="privately"><PrivateMark large /></span>
  {/if}

  <AddressField
    bind:this={field}
    {resting}
    {book}
    address={resting}
    held={page}
    onenter={(said: string, aside: boolean, typed: string) =>
      onaddress(meantBy(said, page.url), aside, typed)}
    onnote={page.inPrivate ? undefined : onnote}
    {ontyping}
  />

  {#if extending}
    <ExtensionButtons {...extending} />
  {/if}

  {#if downloads.list.length > 0}
    <button
      class="nib-glyph saving"
      data-opens="downloads"
      data-tab={tab}
      class:is-on={progress !== null}
      title={t('Downloads')}
      aria-label={t('Downloads')}
      aria-haspopup="dialog"
      onclick={ondownloads}
      transition:scale={{ start: 0.6, duration: dur(160), easing: cubicOut }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {#each ArrowDownToLine as [tag, attrs], index (index)}
          <svelte:element this={tag} {...attrs} />
        {/each}
      </svg>
      {#if progress !== null}
        <svg
          class="ring"
          class:sweeping={progress === 'unknown'}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke-dasharray={RING}
            stroke-dashoffset={RING * (1 - (progress === 'unknown' ? 0.25 : progress))}
          />
        </svg>
      {/if}
    </button>
  {/if}

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
  .webbar {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    background: var(--web-ground, var(--surface));
    border-bottom: 1px solid var(--line);
    transition:
      background-color var(--dur-slow) var(--ease-out),
      border-color var(--dur-slow) var(--ease-out);
  }

  .webbar.alone {
    row-gap: 0;
  }

  .webbar.alone::before {
    content: '';
    order: 1;
    flex: 1 1 0;
  }

  .webbar.alone > :global(.field) ~ :global(*) {
    order: 2;
  }

  .webbar.alone::after {
    content: '';
    order: 3;
    flex-basis: 100%;
    height: var(--space-1);
  }

  .webbar.alone > :global(.field) {
    order: 4;
  }

  .webbar.grounded {
    border-bottom-color: transparent;
  }

  .site {
    margin-left: var(--space-1);
  }

  .privately {
    flex: none;
    display: flex;
    align-items: center;
    color: var(--muted-strong);
  }

  .mark {
    width: var(--icon-md);
    height: var(--icon-md);
    border-radius: var(--radius-sm);
  }

  .saving {
    position: relative;
  }

  .nib-glyph > .ring {
    position: absolute;
    top: 2px;
    left: 2px;
    width: calc(100% - 4px);
    height: calc(100% - 4px);
    transform: rotate(-90deg);
  }

  .ring > circle {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    transition: stroke-dashoffset var(--dur-base) var(--ease-out);
  }

  .nib-glyph > .ring.sweeping {
    animation: turn 1s linear infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .nib-glyph > .ring.sweeping {
      animation: none;
    }
  }

  @keyframes turn {
    to {
      transform: rotate(1turn);
    }
  }
</style>
