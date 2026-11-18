;(function () {
  const SIDE = 24
  const NOTCH = 120
  const SLACK = 0.5

  const open = window.open.bind(window)

  function say(said) {
    const words = JSON.stringify(said)
    const bound = globalThis.ordenSwiped
    if (typeof bound === 'function') bound(words)
    else open('about:blank', 'orden-swipe:' + words)
  }

  function takes(from) {
    let left = false
    let right = false
    const root = document.scrollingElement || document.documentElement
    for (let at = from instanceof Element ? from : root; at; at = at.parentElement) {
      const style = getComputedStyle(at)
      const rooted = at === root
      let overflow = style.overflowX
      if (rooted && overflow === 'visible' && document.body)
        overflow = getComputedStyle(document.body).overflowX
      const container = rooted || (overflow !== 'visible' && overflow !== 'clip')
      const keeps =
        container &&
        (style.overscrollBehaviorX === 'contain' || style.overscrollBehaviorX === 'none')
      const sideways = rooted
        ? overflow !== 'hidden' && overflow !== 'clip'
        : /auto|scroll|overlay/.test(overflow)
      const range = at.scrollWidth - at.clientWidth
      if (sideways && range > SLACK) {
        const rtl = style.direction === 'rtl'
        const least = rtl ? -range : 0
        const most = rtl ? 0 : range
        if (at.scrollLeft > least + SLACK) left = true
        if (at.scrollLeft < most - SLACK) right = true
      }
      if (keeps) return [true, true]
    }
    if (document.body && /contain|none/.test(getComputedStyle(document.body).overscrollBehaviorX)) {
      return [true, true]
    }
    return [left, right]
  }

  const QUIET = 120
  const START = 60
  const RATIO = 2.5

  let stream = null

  const LEAD = 50
  const lefts = new WeakMap()
  let slid = -Infinity

  addEventListener(
    'scroll',
    function (event) {
      const at =
        event.target === document
          ? document.scrollingElement || document.documentElement
          : event.target
      if (!(at instanceof Element)) return
      const was = lefts.has(at) ? lefts.get(at) : 0
      lefts.set(at, at.scrollLeft)
      if (Math.abs(at.scrollLeft - was) > SLACK) slid = event.timeStamp
    },
    { capture: true, passive: true },
  )

  let heard = null
  const LATE = 50
  let waiting = false
  let frame = 0
  let late = 0

  function flush() {
    waiting = false
    cancelAnimationFrame(frame)
    clearTimeout(late)
    const one = heard
    if (!one) return
    one.kept =
      one.kept ||
      slid >= stream.first - LEAD ||
      one.events.some(function (event) {
        return event.defaultPrevented
      })
    one.events = []
    const sideways = Math.abs(stream.across) > Math.abs(stream.down) * RATIO
    if (!stream.said && !sideways) return
    heard = null
    stream.said = true
    say({
      k: 'w',
      dx: one.dx,
      dy: one.dy,
      t: one.t,
      l: one.kept || one.l,
      r: one.kept || one.r,
    })
  }

  addEventListener(
    'wheel',
    function (event) {
      if (!event.isTrusted || event.deltaMode !== 0) return
      if (!event.deltaX && !event.deltaY) return
      if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return
      if (event.wheelDeltaX && event.wheelDeltaX % NOTCH === 0) return
      const at = event.timeStamp
      if (!stream || at - stream.last > QUIET) {
        stream = { first: at, last: at, across: 0, down: 0, said: false, downFirst: false }
        heard = null
      }
      stream.last = at
      if (stream.downFirst) return
      stream.across += event.deltaX
      stream.down += event.deltaY
      const down = Math.abs(stream.down)
      if (!stream.said && down > START && down > Math.abs(stream.across) * RATIO) {
        stream.downFirst = true
        heard = null
        say({ k: 'w', dx: stream.across, dy: stream.down, t: at, l: false, r: false })
        return
      }
      const free = event.deltaX ? takes(event.target) : [false, false]
      if (!heard) heard = { dx: 0, dy: 0, t: 0, l: false, r: false, kept: false, events: [] }
      heard.dx += event.deltaX
      heard.dy += event.deltaY
      heard.t = at
      heard.l = heard.l || free[0]
      heard.r = heard.r || free[1]
      heard.events.push(event)
      if (!waiting) {
        waiting = true
        frame = requestAnimationFrame(flush)
        late = setTimeout(flush, LATE)
      }
    },
    { capture: true, passive: true },
  )

  let finger = null

  addEventListener(
    'touchstart',
    function (event) {
      finger = null
      if (!event.isTrusted || event.touches.length !== 1 || window !== window.top) return
      const touch = event.touches[0]
      if (touch.clientX > SIDE && touch.clientX < innerWidth - SIDE) return
      const free = takes(event.target)
      finger = { x: touch.clientX, y: touch.clientY, l: free[0], r: free[1] }
    },
    { capture: true, passive: true },
  )

  addEventListener(
    'touchmove',
    function (event) {
      if (!finger || !event.isTrusted) return
      if (event.touches.length !== 1) return lift(event)
      const touch = event.touches[0]
      say({
        k: 't',
        dx: finger.x - touch.clientX,
        dy: finger.y - touch.clientY,
        t: event.timeStamp,
        l: finger.l,
        r: finger.r,
      })
      finger.x = touch.clientX
      finger.y = touch.clientY
    },
    { capture: true, passive: true },
  )

  function lift(event) {
    if (!finger) return
    finger = null
    say({ k: 'e', t: event.timeStamp })
  }

  addEventListener('touchend', lift, { capture: true, passive: true })
  addEventListener('touchcancel', lift, { capture: true, passive: true })
})()
