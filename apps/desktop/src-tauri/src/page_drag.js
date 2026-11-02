// A drag out of the app's own page, on Linux, where the engine's own ends as it starts: see
// page_drag.rs. The events are the ones a drag says, in the order HTML says them, each with
// a DataTransfer of this drag's: nothing that listens for a drag has to know.
;(function () {
  if (window.top !== window) return

  // How often a pointer at rest says `dragover`: the HTML standard's, and Chromium's.
  const AT_REST = 350
  const PRESS_EVENTS = ['pointermove', 'pointerup', 'pointercancel', 'mousemove', 'mouseup']

  let drag = null

  /** What a dragover that was taken comes to: what it asked for, if the source allows it. */
  function effectOf(wanted, allowed) {
    if (wanted === 'none') return 'none'
    if (allowed === 'uninitialized' || allowed === 'all') return wanted
    return allowed.toLowerCase().includes(wanted) ? wanted : 'none'
  }

  /** What `dropEffect` starts as on each event, by what the source allows. */
  function startingEffect(allowed) {
    if (allowed === 'none') return 'none'
    if (allowed === 'move') return 'move'
    if (allowed === 'link' || allowed === 'linkMove') return 'link'
    return 'copy'
  }

  function say(type, target, related) {
    return target.dispatchEvent(
      new DragEvent(type, {
        bubbles: true,
        cancelable: type !== 'dragleave' && type !== 'dragend',
        composed: true,
        view: window,
        dataTransfer: drag.transfer,
        relatedTarget: related ?? null,
        clientX: drag.x,
        clientY: drag.y,
        screenX: drag.x + window.screenX,
        screenY: drag.y + window.screenY,
        button: 0,
        buttons: 1,
        ctrlKey: drag.keys.ctrlKey,
        shiftKey: drag.keys.shiftKey,
        altKey: drag.keys.altKey,
        metaKey: drag.keys.metaKey,
      }),
    )
  }

  /** A field or a note takes words of its own accord, where a list has to say it does. */
  function takesWords(element) {
    return (
      drag.transfer.types.includes('text/plain') &&
      !!element.closest('textarea, input, [contenteditable="true"], [contenteditable=""]')
    )
  }

  function cursor(effect) {
    const shown = { copy: 'copy', move: 'move', link: 'alias' }[effect] ?? 'no-drop'
    drag.style.textContent = `html, html * { cursor: ${shown} !important; user-select: none !important; }`
  }

  /** One step of the drag: the element under the pointer told, entered first if it is new. */
  function step() {
    say('drag', drag.source)
    const under = document.elementFromPoint(drag.x, drag.y)
    const allowed = drag.transfer.effectAllowed
    if (under !== drag.target) {
      const left = drag.target
      if (under) {
        drag.transfer.dropEffect = startingEffect(allowed)
        say('dragenter', under, left)
      }
      if (left) say('dragleave', left, under)
      drag.target = under
    }
    if (under) {
      drag.transfer.dropEffect = startingEffect(allowed)
      // `dispatchEvent` answers false for an event somebody prevented, which is taking it.
      const taken = !say('dragover', under)
      if (taken) drag.effect = effectOf(drag.transfer.dropEffect, allowed)
      else drag.effect = takesWords(under) ? startingEffect(allowed) : 'none'
    } else {
      drag.effect = 'none'
    }
    cursor(drag.effect)
    if (drag.image) drag.image.style.transform = `translate(${drag.x + 8}px, ${drag.y + 8}px)`
  }

  function swallow(event) {
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  function onPointer(event) {
    if (!drag) return
    swallow(event)
    drag.keys = event
    const moved = event.clientX !== drag.x || event.clientY !== drag.y
    drag.x = event.clientX
    drag.y = event.clientY
    if (event.type === 'pointerup') end(true)
    else if (event.type === 'pointercancel' || (event.type === 'pointermove' && !event.buttons)) {
      end(false)
    } else if (event.type === 'pointermove' && moved) step()
  }

  function onKey(event) {
    if (!drag) return
    swallow(event)
    drag.keys = event
    if (event.key === 'Escape') end(false)
  }

  /** Over: let go on something that took it, or given up. A click would come of the press
   *  and the release, which a drag's own loop never lets through. */
  function end(dropped) {
    const { target, source, effect, style, image, timer } = drag
    clearInterval(timer)
    for (const type of PRESS_EVENTS) window.removeEventListener(type, onPointer, true)
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('keyup', onKey, true)
    style.remove()
    image?.remove()
    if (dropped && target && effect !== 'none') {
      drag.transfer.dropEffect = effect
      say('drop', target)
    } else {
      drag.transfer.dropEffect = 'none'
      if (target) say('dragleave', target)
    }
    say('dragend', source)
    drag = null
    if (!dropped) return
    const noClick = (event) => {
      if (event.type === 'click') swallow(event)
      window.removeEventListener('click', noClick, true)
      window.removeEventListener('pointerdown', noClick, true)
    }
    window.addEventListener('click', noClick, true)
    window.addEventListener('pointerdown', noClick, true)
  }

  /** What is carried under the pointer: what the source asked for, else a copy of it. */
  function imageOf(element) {
    const box = element.getBoundingClientRect()
    const image = element.cloneNode(true)
    Object.assign(image.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: `${box.width}px`,
      height: `${box.height}px`,
      margin: '0',
      opacity: '0.7',
      pointerEvents: 'none',
      zIndex: '2147483647',
    })
    return image
  }

  window.addEventListener(
    'dragstart',
    (event) => {
      if (!event.isTrusted || drag) return
      swallow(event)
      const source = event.target.nodeType === 1 ? event.target : event.target.parentElement
      if (!source) return
      // A selection or a link starts out with what the engine put in, which a row does not.
      const transfer = new DataTransfer()
      for (const type of event.dataTransfer?.types ?? []) {
        if (type !== 'Files') transfer.setData(type, event.dataTransfer.getData(type))
      }
      let asked = null
      transfer.setDragImage = (element) => {
        asked = element
      }
      // A DataTransfer made by hand is a clipboard's to the engine, which then keeps neither
      // of a drag's two words; they are kept here, as a drag's would be.
      let allowed = 'uninitialized'
      let wanted = 'none'
      Object.defineProperties(transfer, {
        effectAllowed: {
          get: () => allowed,
          set: (value) => {
            allowed = value
          },
        },
        dropEffect: {
          get: () => wanted,
          set: (value) => {
            wanted = value
          },
        },
      })
      drag = {
        source,
        transfer,
        target: null,
        effect: 'none',
        x: event.clientX,
        y: event.clientY,
        keys: event,
        style: null,
        image: null,
        timer: 0,
      }
      if (!say('dragstart', source)) {
        drag = null
        return
      }
      // What the engine says of the pointer as its drag takes it; a press held on a row
      // for its menu lets go of that here.
      source.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }))
      for (const type of PRESS_EVENTS) window.addEventListener(type, onPointer, true)
      window.addEventListener('keydown', onKey, true)
      window.addEventListener('keyup', onKey, true)
      drag.style = document.head.appendChild(document.createElement('style'))
      drag.image = document.documentElement.appendChild(imageOf(asked ?? source))
      drag.timer = setInterval(step, AT_REST)
      step()
    },
    true,
  )
})()
