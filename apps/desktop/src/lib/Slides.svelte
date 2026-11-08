<script lang="ts">
  import { onDestroy, tick } from 'svelte'
  import { loadEmbed } from '@orden/editor'
  import { claimsGesture } from './swipe'
  import { menu } from './menu.svelte'
  import { overlays } from './overlays'
  import { trustsHtmlIn } from './sharing.svelte'
  import { links } from './link-index.svelte'
  import { deckHtml, type StageSlide } from './slides/render'
  import {
    openPresenter,
    presenterChannel,
    closePresenter,
    secondScreen,
    type Channel,
    type Message,
  } from './slides/presenter'
  import { fitSurface } from './slides/fit'
  import { present } from './slides/present.svelte'
  import {
    axesOf,
    back,
    clamp,
    forward,
    type Move,
    type Place,
    moveBetween,
    shownFragments,
    STAGE_HEIGHT,
    STAGE_WIDTH,
    stageScale,
    START,
    stepsOf,
    toEnd,
    toSlide,
    typedSlide,
  } from './slides/stage'
  import { followHref, MIDDLE, opensLink } from './open-link'
  import { theme } from './theme.svelte'
  import { views } from './views.svelte'
  import type { Tab } from './workspace.svelte'

  const { tab }: { tab: Tab } = $props()

  const REDRAW = 200
  const COUNTER = 1600
  const STILL = 2000
  const SHEET = 40

  let slides = $state<StageSlide[]>([])
  let place = $state<Place>(START)
  let move = $state<Move>(null)
  let typed = $state('')
  let notesOpen = $state(false)
  let counting = $state(false)
  let still = $state(false)
  let scale = $state(0)

  let deck = $state<HTMLElement>()
  let page = $state<HTMLElement>()

  const steps = $derived(stepsOf(slides))
  const axes = $derived(axesOf(slides))
  const current = $derived(slides[place.slide])
  const next = $derived(slides[place.slide + 1])
  const count = $derived(slides.length)

  let latest = 0
  let redraw: ReturnType<typeof setTimeout> | undefined
  let drawn = false

  async function draw() {
    const mine = ++latest
    tab.note.flush()
    const built = await deckHtml(
      { text: tab.doc, path: tab.path },
      theme.current,
      trustsHtmlIn(tab.note),
    )
    if (mine !== latest) return

    slides = built
    place = clamp(stepsOf(built), place)
    fitted = []
  }

  $effect(() => {
    const reasons = [tab.note.revision, theme.current, links.locksSeen()]
    if (!reasons.length) return

    if (!drawn) {
      drawn = true
      void draw()
      return
    }

    clearTimeout(redraw)
    redraw = setTimeout(() => void draw(), REDRAW)
    return () => clearTimeout(redraw)
  })

  onDestroy(() => clearTimeout(redraw))

  $effect(() => {
    const room = deck
    if (!room) return

    const measure = () => {
      scale = stageScale(room.clientWidth, room.clientHeight)
    }

    measure()
    const watcher = new ResizeObserver(measure)
    watcher.observe(room)
    return () => watcher.disconnect()
  })

  let fitted: (number | undefined)[] = []

  function fit() {
    const surface = page
    if (!surface) return

    const known = fitted[place.slide]
    if (known !== undefined) {
      surface.style.setProperty('--stage-fit', String(known))
      return
    }

    fitted[place.slide] = fitSurface(surface)
  }

  let facesReady = false

  $effect(() => {
    const reasons = [place.slide, slides]
    if (!reasons.length) return

    fit()

    const surface = page
    if (!surface) return

    const again = () => {
      fitted[place.slide] = undefined
      fit()
    }

    const pictures = [...surface.querySelectorAll('img')].filter((one) => !one.complete)
    for (const picture of pictures) picture.addEventListener('load', again, { once: true })

    if (!facesReady) {
      void document.fonts.ready.then(() => {
        facesReady = true
        fitted = []
        fit()
      })
    }

    return () => {
      for (const picture of pictures) picture.removeEventListener('load', again)
    }
  })

  $effect(() => {
    const surface = page
    const waiting = current?.fragments ?? []
    if (!surface) return

    const items = [...surface.querySelectorAll('li')].filter(
      (item) => !item.closest('figure.embed'),
    )
    const shown = new Set(shownFragments(waiting, place.step))

    for (const [at, item] of items.entries()) {
      item.classList.toggle('fragment', waiting.includes(at))
      item.classList.toggle('shown', shown.has(at))
    }
  })

  function go(to: Place) {
    if (to.slide === place.slide && to.step === place.step) return

    move = moveBetween(axes, place.slide, to.slide)
    place = to
    show()
  }

  function onwards() {
    go(forward(steps, place))
  }

  function backwards() {
    go(back(steps, place))
  }

  let counter: ReturnType<typeof setTimeout> | undefined

  function show() {
    counting = true
    clearTimeout(counter)
    counter = setTimeout(() => (counting = false), COUNTER)
  }

  onDestroy(() => clearTimeout(counter))

  let counted = false

  $effect(() => {
    if (!slides.length || counted) return

    counted = true
    show()
  })

  function leave() {
    const view = views.of(tab.paneId)
    const from = current?.from
    if (view && from !== undefined && from <= view.state.doc.length) {
      view.dispatch({ selection: { anchor: from } })
    }

    present.stop()
  }

  $effect(() => overlays.show(leave))

  $effect(() => {
    if (notesOpen && current?.notes) return overlays.show(() => (notesOpen = false))
  })

  function onKeydown(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey) return

    const focused = document.activeElement
    if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) return
    if (menu.open) return

    if (/^\d$/.test(event.key)) {
      event.preventDefault()
      typed = (typed + event.key).slice(-4)
      show()
      return
    }

    const jumping = typed
    if (event.key !== 'Shift') typed = ''

    switch (event.key) {
      case 'Enter': {
        event.preventDefault()
        const wanted = typedSlide(jumping, count)
        if (wanted !== null) go(toSlide(steps, wanted))
        else onwards()
        return
      }
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
      case ' ':
      case 'Spacebar':
        event.preventDefault()
        onwards()
        return
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
      case 'Backspace':
        event.preventDefault()
        backwards()
        return
      case 'Home':
        event.preventDefault()
        go(toSlide(steps, 0))
        return
      case 'End':
        event.preventDefault()
        go(toEnd(steps))
        return
      case 'n':
      case 'N':
        event.preventDefault()
        notesOpen = !notesOpen
        return
      case 'p':
      case 'P':
        event.preventDefault()
        takePresenter()
        return
      default:
        return
    }
  }

  function onClick(event: MouseEvent) {
    const target = event.target as Element | null
    if (!opensLink(event)) return

    if (event.button === MIDDLE) {
      const address = target?.closest('a')?.getAttribute('href')
      if (!address) return

      event.preventDefault()
      followHref(address, event)
      return
    }

    if (target?.closest('.notes')) return

    const card = target?.closest('.embed-web')
    if (card instanceof HTMLElement && loadEmbed(card)) {
      event.preventDefault()
      return
    }

    const href = target?.closest('a')?.getAttribute('href')
    if (href && /^[a-z][a-z\d+.-]*:/i.test(href)) {
      event.preventDefault()
      followHref(href, event)
      return
    }

    const room = deck
    if (!room) return

    const box = room.getBoundingClientRect()
    if (event.clientX - box.left < box.width / 2) backwards()
    else onwards()
  }

  let touch: { x: number; y: number } | null = null

  function onTouchStart(event: TouchEvent) {
    const finger = event.changedTouches[0]
    touch = finger ? { x: finger.clientX, y: finger.clientY } : null
  }

  function onTouchEnd(event: TouchEvent) {
    const from = touch
    const finger = event.changedTouches[0]
    touch = null
    if (!from || !finger) return

    const dx = finger.clientX - from.x
    const dy = finger.clientY - from.y

    if (claimsGesture(dx, dy)) {
      event.preventDefault()
      if (dx < 0) onwards()
      else backwards()
      return
    }

    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > SHEET) {
      event.preventDefault()
      notesOpen = dy < 0
    }
  }

  $effect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined

    const wake = () => {
      still = false
      clearTimeout(timer)
      timer = setTimeout(() => (still = true), STILL)
    }

    wake()
    window.addEventListener('pointermove', wake)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointermove', wake)
    }
  })

  let channel: Channel | null = null
  const started = Date.now()
  const deckId = crypto.randomUUID()
  let others: string[] = []
  let took = $state(0)

  function takePresenter() {
    took = Date.now()
    void openPresenter()
  }

  const broadcast = $derived<Message>({
    kind: 'stage',
    show: deckId,
    took,
    stage: {
      slide: current?.html ?? '',
      next: next?.html ?? '',
      shape: current?.shape ?? 'prose',
      nextShape: next?.shape ?? 'prose',
      notes: current?.notes ?? '',
      at: place.slide + 1,
      count,
      started,
      scheme: theme.current,
    },
  })

  $effect(() => {
    const line = presenterChannel((message) => {
      if (message.kind === 'here') {
        line.send(broadcast)
        return
      }

      if (message.kind === 'stage') {
        if (!others.includes(message.show)) others = [...others, message.show]
        return
      }

      if (message.kind === 'gone') {
        others = others.filter((one) => one !== message.show)
        return
      }

      if (message.show === deckId) {
        if (message.by > 0) onwards()
        else backwards()
      }
    })
    channel = line
    line.send({ kind: 'here' })

    void secondScreen().then((other) => {
      if (other) takePresenter()
    })

    return () => {
      line.send({ kind: 'gone', show: deckId })
      line.close()
      channel = null
      if (others.length === 0) void closePresenter()
    }
  })

  $effect(() => {
    channel?.send(broadcast)
  })

  $effect(() => {
    void tick().then(() => deck?.focus({ preventScroll: true }))
  })

  const stageStyle = $derived(
    `--stage-width: ${STAGE_WIDTH}px; --stage-height: ${STAGE_HEIGHT}px; --stage-scale: ${scale}`,
  )
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div
  class="deck orden-host"
  tabindex="-1"
  data-move={move ?? 'none'}
  data-still={still ? 'yes' : 'no'}
  style={stageStyle}
  bind:this={deck}
  onclick={onClick}
  onauxclick={onClick}
  ontouchstart={onTouchStart}
  ontouchend={onTouchEnd}
>
  <div class="stage">
    {#key place.slide}
      <div class="slide" data-shape={current?.shape ?? 'prose'}>
        <div class="orden-write" bind:this={page}>
          <!-- eslint-disable-next-line svelte/no-at-html-tags -- the note's own words, through the renderer the reading view and every export use -->
          {@html current?.html ?? ''}
        </div>
      </div>
    {/key}
  </div>

  {#if notesOpen && current?.notes}
    <div class="notes">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- the note's own words again, the part only the presenter reads -->
      {@html current.notes}
    </div>
  {/if}

  <div class="rail">
    <div class="run" style="--at: {count ? (place.slide + 1) / count : 0}"></div>
  </div>
  <div class="count" data-shown={counting ? 'yes' : 'no'}>
    {typed || place.slide + 1}/{count}
  </div>
</div>
