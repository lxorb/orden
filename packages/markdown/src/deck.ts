import type { SlideShape } from './slides'

export interface RenderedSlide {
  html: string
  shape: SlideShape
  vertical: boolean
  fragments: readonly number[]
}

export const DECK_WIDTH = 1280
export const DECK_HEIGHT = 720

export const FIT_STEPS = [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.52, 0.45, 0.38, 0.32] as const

export function deckBody(slides: readonly RenderedSlide[]): string {
  const stages = slides.map((slide) => {
    return [
      '<div class="stage">',
      `<div class="slide" data-shape="${slide.shape}" data-steps="${slide.fragments.length}"`,
      slide.vertical ? ' data-vertical="yes"' : '',
      '>',
      `<div id="write">${slide.html}</div>`,
      '</div>',
      '</div>',
    ].join('')
  })

  return [
    '<div class="deck" data-move="none">',
    stages.join('\n'),
    '<div class="rail"><div class="run"></div></div>',
    '<div class="count"></div>',
    '</div>',
  ].join('\n')
}

const STAGE_SOURCE = `
  var deck = document.querySelector('.deck')
  var stages = deck ? Array.prototype.slice.call(deck.querySelectorAll('.stage')) : []
  var slides = stages.map(function (stage) { return stage.querySelector('.slide') })
  var pages = slides.map(function (slide) { return slide.querySelector('#write') })
  var ladder = ${JSON.stringify([...FIT_STEPS])}
  var fitted = []

  function scale() {
    var wanted = Math.min(deck.clientWidth / ${DECK_WIDTH}, deck.clientHeight / ${DECK_HEIGHT})
    for (var i = 0; i < stages.length; i++) {
      stages[i].style.setProperty('--stage-scale', String(wanted > 0 ? wanted : 1))
    }
  }

  /* Down the ladder until the slide fits, and the answer kept. The same rungs
     the app steps down; see FIT_STEPS. */
  function fit(index) {
    if (fitted[index]) return
    var page = pages[index]
    for (var rung = 0; rung < ladder.length; rung++) {
      page.style.setProperty('--stage-fit', String(ladder[rung]))
      if (page.scrollHeight <= page.clientHeight + 1) break
    }
    fitted[index] = true
  }

  /* Every slide, which is what printing needs: each of them is on its own sheet
     and none of them was ever on screen to be measured. */
  function fitAll() {
    for (var i = 0; i < pages.length; i++) fit(i)
  }

  /* A picture whose size the page did not know, and a font that arrived late,
     both change how tall a slide is. A published deck fetches KaTeX's
     stylesheet, so its maths is measured twice or not at all. */
  function refit() {
    fitted = []
    fitAll()
  }
`

export const DECK_LAYOUT_SCRIPT = `(function () {
${STAGE_SOURCE}
  if (!stages.length) return

  scale()
  fitAll()
  window.addEventListener('load', refit)
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit)
})()`

export const DECK_SCRIPT = `(function () {
${STAGE_SOURCE}
  if (!stages.length) return

  var run = deck.querySelector('.run')
  var count = deck.querySelector('.count')
  var steps = slides.map(function (slide) { return Number(slide.getAttribute('data-steps') || 0) })

  var at = 0
  var step = 0
  var typed = ''
  var hiding

  /* Which of the slide's items wait for a click, and which are out. The
     renderer marks each item written with a plus; see slides.ts. An embedded
     note's own list is not the slide's, so it is skipped. */
  function marks(index) {
    var found = pages[index].querySelectorAll('li[data-fragment]')
    var items = []
    for (var f = 0; f < found.length; f++) {
      if (!found[f].closest || !found[f].closest('figure.embed')) items.push(found[f])
    }

    for (var i = 0; i < items.length; i++) {
      items[i].classList.add('fragment')
      items[i].classList.toggle('shown', i < step)
    }
  }

  function draw(move) {
    deck.setAttribute('data-move', move || 'none')
    for (var i = 0; i < stages.length; i++) {
      if (i === at) stages[i].className = 'stage'
      else stages[i].className = 'stage away'
    }

    fit(at)
    marks(at)
    if (run) run.style.setProperty('--at', String((at + 1) / stages.length))
    if (count) {
      count.textContent = (typed || String(at + 1)) + '/' + stages.length
      count.setAttribute('data-shown', 'yes')
      clearTimeout(hiding)
      hiding = setTimeout(function () { count.setAttribute('data-shown', 'no') }, 1600)
    }
  }

  function go(index, next, move) {
    if (index === at && next === step) return
    var same = index === at
    at = index
    step = next
    draw(same ? null : move)
  }

  function onwards() {
    if (step < steps[at]) go(at, step + 1, null)
    else if (at + 1 < stages.length) go(at + 1, 0, slides[at + 1].getAttribute('data-vertical') ? 'down' : 'forward')
  }

  function backwards() {
    if (step > 0) go(at, step - 1, null)
    else if (at > 0) go(at - 1, steps[at - 1], slides[at].getAttribute('data-vertical') ? 'up' : 'back')
  }

  document.addEventListener('keydown', function (event) {
    /* A key held with a modifier belongs to the browser: Alt and an arrow is the
       way back, and Ctrl and Home is the top of the page. */
    if (event.ctrlKey || event.metaKey || event.altKey) return

    if (/^[0-9]$/.test(event.key)) {
      typed = (typed + event.key).slice(-4)
      draw(null)
      return
    }

    var jumping = typed
    typed = ''

    switch (event.key) {
      case 'Enter':
        var wanted = Number(jumping)
        if (jumping && wanted >= 1 && wanted <= stages.length) go(wanted - 1, 0, wanted - 1 > at ? 'forward' : 'back')
        else onwards()
        break
      case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': case 'Spacebar':
        onwards(); break
      case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'Backspace':
        backwards(); break
      case 'Home':
        go(0, 0, 'back'); break
      case 'End':
        go(stages.length - 1, steps[stages.length - 1], 'forward'); break
      default:
        return
    }
    event.preventDefault()
  })

  deck.addEventListener('click', function (event) {
    var target = event.target
    while (target && target !== deck) {
      if (target.tagName === 'A') return
      target = target.parentNode
    }
    if (event.clientX - deck.getBoundingClientRect().left < deck.clientWidth / 2) backwards()
    else onwards()
  })

  var from = null
  deck.addEventListener('touchstart', function (event) {
    var finger = event.changedTouches[0]
    from = finger ? { x: finger.clientX, y: finger.clientY } : null
  }, { passive: true })

  deck.addEventListener('touchend', function (event) {
    var finger = event.changedTouches[0]
    if (!from || !finger) return
    var dx = finger.clientX - from.x
    var dy = finger.clientY - from.y
    from = null
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) onwards()
      else backwards()
    }
  })

  /* A picture or a font that arrived late changes how tall a slide is. Only the
     slide on screen is measured again; the rest have not been measured at all
     yet, and will be when they are shown. */
  function again() {
    fitted = []
    draw(null)
  }

  window.addEventListener('resize', scale)
  /* On paper every slide is on its own sheet, and only the one on screen has
     ever been measured. */
  window.addEventListener('beforeprint', fitAll)
  window.addEventListener('load', again)
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(again)

  scale()
  draw(null)
})()`

export const DECK_PAGE_CSS = `
.deck .stage.away { display: none; }
@media print { .deck .stage.away { display: block; } }
`
