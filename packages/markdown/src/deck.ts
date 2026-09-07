/** A deck as a page that stands on its own.
 *
 *  Two places need one and neither can borrow the app's: a deck exported as a
 *  single HTML file, which has to work from an email attachment with no network
 *  at all, and a published note read as slides, which is served by the Worker.
 *  Both put the same markup on the page and run the same handful of lines to
 *  move through it, so they are here rather than written twice.
 *
 *  The markup carries no behaviour of its own: without the script every slide is
 *  simply on the page, one after another, which is exactly what printing wants
 *  and how a deck becomes a PDF of one page per slide. */

import type { SlideShape } from './slides'

/** A slide already rendered by `renderMarkdown`. */
export interface RenderedSlide {
  html: string
  shape: SlideShape
  /** Whether the slide continues the one before it downwards, which is the only
   *  thing it changes: the direction the deck moves in when it arrives. */
  vertical: boolean
  /** Which list items wait for a click, by their place among the items the
   *  slide renders. */
  fragments: readonly number[]
}

/** The stage, in CSS pixels. Sixteen by nine, and the same numbers the app's own
 *  stage uses; see apps/desktop/src/lib/slides/stage.ts. */
export const DECK_WIDTH = 1280
export const DECK_HEIGHT = 720

/** The whole deck as markup: one stage per slide, in order.
 *
 *  Every slide is on the page rather than swapped in, so the file holds the deck
 *  whether or not any script runs - a printer, a reader with scripting off and a
 *  crawler all get the words. */
export function deckBody(slides: readonly RenderedSlide[]): string {
  const stages = slides.map((slide) => {
    const fragments = slide.fragments.join(',')

    return [
      '<div class="stage">',
      `<div class="slide" data-shape="${slide.shape}" data-steps="${slide.fragments.length}"`,
      slide.vertical ? ' data-vertical="yes"' : '',
      fragments ? ` data-fragments="${fragments}"` : '',
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

/** How wide the stage is, written where the stylesheet can read it. */
export function deckSizeCss(): string {
  return `.deck .stage { --stage-width: ${DECK_WIDTH}px; --stage-height: ${DECK_HEIGHT}px; }`
}

/** Moving through a deck on a page of its own.
 *
 *  The same gestures the app answers to: the arrows, space, the page keys, Home
 *  and End, a number then Enter, and a click on either half of the screen. The
 *  slide is scaled to the window rather than laid out to it and shrunk until it
 *  fits, which is what stops one ever scrolling.
 *
 *  Written out as text because it is inlined into a file that must work with no
 *  network. Plain ES5 so an old browser opening an emailed deck still turns the
 *  pages. */
export const DECK_SCRIPT = `(function () {
  var deck = document.querySelector('.deck')
  if (!deck) return

  var stages = Array.prototype.slice.call(deck.querySelectorAll('.stage'))
  if (!stages.length) return

  var run = deck.querySelector('.run')
  var count = deck.querySelector('.count')
  var slides = stages.map(function (stage) { return stage.querySelector('.slide') })
  var pages = slides.map(function (slide) { return slide.querySelector('#write') })
  var steps = slides.map(function (slide) { return Number(slide.getAttribute('data-steps') || 0) })
  var waiting = slides.map(function (slide) {
    var written = slide.getAttribute('data-fragments')
    return written ? written.split(',').map(Number) : []
  })

  var at = 0
  var step = 0
  var typed = ''
  var fitted = []
  var shown

  function scale() {
    var wanted = Math.min(deck.clientWidth / ${DECK_WIDTH}, deck.clientHeight / ${DECK_HEIGHT})
    for (var i = 0; i < stages.length; i++) {
      stages[i].style.setProperty('--stage-scale', String(wanted > 0 ? wanted : 1))
    }
  }

  /* Shrink the text until the slide fits. Walked down rather than halved: it is
     done once per slide and the answer is kept. */
  function fit(index) {
    if (fitted[index]) return
    var page = pages[index]
    var size = 1
    for (var tries = 0; tries < 10; tries++) {
      page.style.setProperty('--stage-fit', String(size))
      if (page.scrollHeight <= page.clientHeight + 1) break
      size = size * 0.92
    }
    fitted[index] = true
  }

  function marks(index) {
    var items = pages[index].querySelectorAll('li')
    var mine = waiting[index]
    for (var i = 0; i < items.length; i++) {
      var isStep = mine.indexOf(i) >= 0
      items[i].className = items[i].className.replace(/ ?fragment ?/g, ' ').replace(/ ?shown ?/g, ' ')
      if (!isStep) continue
      items[i].className += ' fragment' + (mine.indexOf(i) < step ? ' shown' : '')
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
      clearTimeout(shown)
      shown = setTimeout(function () { count.setAttribute('data-shown', 'no') }, 1600)
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
      case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ':
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

  window.addEventListener('resize', scale)
  scale()
  draw(null)
})()`

/** What the markup above needs on top of the prose stylesheet, for a page that
 *  has no app around it. The app's own stage is dressed by
 *  packages/themes/src/slides.css, which this leans on: only the two things a
 *  standalone page adds are here. */
export const DECK_PAGE_CSS = `
.deck .stage.away { display: none; }
@media print { .deck .stage.away { display: block; } }
`
