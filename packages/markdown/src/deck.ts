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

/** The sizes a slide's text is allowed to take, largest first.
 *
 *  A ladder rather than a number worked out from the height, because the text has
 *  to be measured to know whether it fits at all: a picture, a table and a fenced
 *  block all take the room they take. Ten rungs reach a third of the size, which
 *  holds a slide nobody should have written.
 *
 *  Here rather than beside the app's own stage, because a slide has to come out
 *  the same size on all three: on screen, in an exported file, and on a published
 *  page. The app imports it; the script below is given it as a literal. */
export const FIT_STEPS = [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.52, 0.45, 0.38, 0.32] as const

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

/** Everything a deck on a page of its own has to do before anybody looks at it:
 *  find its slides, scale the stage to the window, and shrink each slide's text
 *  until it fits.
 *
 *  Shared source rather than a second copy, because both scripts below need it
 *  and a deck that fitted one way on screen and another on paper would be two
 *  decks. Written as text so it can be inlined into a file with no network
 *  behind it, and with no syntax a bundler would have to touch. */
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

/** A deck that turns no pages: it lays itself out and stops there.
 *
 *  What a deck on its way to a printer gets. Every slide is on the page and the
 *  print rules give each of them a sheet, so every one of them has to be fitted
 *  rather than only whichever was on screen. */
export const DECK_LAYOUT_SCRIPT = `(function () {
${STAGE_SOURCE}
  if (!stages.length) return

  scale()
  fitAll()
  window.addEventListener('load', refit)
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit)
})()`

/** Moving through a deck on a page of its own.
 *
 *  The same gestures the app answers to: the arrows, space, the page keys, Home
 *  and End, a number then Enter, and a click on either half of the screen. A key
 *  held with a modifier is the browser's - Alt and an arrow is the way back - and
 *  is left alone. */
export const DECK_SCRIPT = `(function () {
${STAGE_SOURCE}
  if (!stages.length) return

  var run = deck.querySelector('.run')
  var count = deck.querySelector('.count')
  var steps = slides.map(function (slide) { return Number(slide.getAttribute('data-steps') || 0) })
  var waiting = slides.map(function (slide) {
    var written = slide.getAttribute('data-fragments')
    return written ? written.split(',').map(Number) : []
  })

  var at = 0
  var step = 0
  var typed = ''
  var hiding

  /* Which of the slide's items wait for a click, and which are out. By their
     place among the items the slide renders, which is what the deck parser
     counted; see slides.ts. An embedded note's own list is not the slide's, and
     the parser never saw it, so it is skipped here too. */
  function marks(index) {
    var found = pages[index].querySelectorAll('li')
    var items = []
    for (var f = 0; f < found.length; f++) {
      if (!found[f].closest || !found[f].closest('figure.embed')) items.push(found[f])
    }

    var mine = waiting[index]
    for (var i = 0; i < items.length; i++) {
      var place = mine.indexOf(i)
      items[i].classList.toggle('fragment', place >= 0)
      items[i].classList.toggle('shown', place >= 0 && place < step)
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

/** What the markup above needs on top of the prose stylesheet, for a page that
 *  has no app around it. The app's own stage is dressed by
 *  packages/themes/src/slides.css, which this leans on: only the two things a
 *  standalone page adds are here. */
export const DECK_PAGE_CSS = `
.deck .stage.away { display: none; }
@media print { .deck .stage.away { display: block; } }
`
