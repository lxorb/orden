;(function () {
  if (window.top !== window) return

  const AT_REST = 350
  const PRESS_EVENTS = ['pointermove', 'pointerup', 'pointercancel', 'mousemove', 'mouseup']
  const KEPT_FROM_THE_PAGE = ['mousedown', 'contextmenu']
  const SAME_PLACE = 2

  let drag = null
  let pressed = 0

  function effectOf(wanted, allowed) {
    if (wanted === 'none') return 'none'
    if (allowed === 'uninitialized' || allowed === 'all') return wanted
    return allowed.toLowerCase().includes(wanted) ? wanted : 'none'
  }

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

  function takesWords(element) {
    return (
      drag.transfer.types.includes('text/plain') &&
      !!element.closest('[contenteditable="true"], [contenteditable=""]')
    )
  }

  function cursor(effect) {
    const shown = { copy: 'copy', move: 'move', link: 'alias' }[effect] ?? 'no-drop'
    drag.style.textContent = `html, html * { cursor: ${shown} !important; user-select: none !important; }`
  }

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
    const away = Math.max(Math.abs(event.clientX - drag.x), Math.abs(event.clientY - drag.y))
    if (event.type === 'pointerup') {
      if (event.button !== 0 && event.buttons & 1) return
      end(event.button === 0 && !(event.buttons & 1) && away <= SAME_PLACE)
    } else if (
      event.type === 'pointercancel' ||
      (event.type === 'pointermove' && !(event.buttons & 1))
    ) {
      end(false)
    } else if (event.type === 'pointermove' && away > 0) {
      drag.x = event.clientX
      drag.y = event.clientY
      step()
    }
  }

  function onNewPress(event) {
    pressed = event.pointerId
    if (drag) end(false)
  }

  function onGone() {
    if (drag && (document.visibilityState === 'hidden' || !document.hasFocus())) end(false)
  }

  function onKey(event) {
    if (!drag) return
    swallow(event)
    drag.keys = event
    if (event.key === 'Escape') end(false)
  }

  function end(dropped) {
    const { target, source, effect, style, image, timer } = drag
    clearInterval(timer)
    for (const type of PRESS_EVENTS) window.removeEventListener(type, onPointer, true)
    for (const type of KEPT_FROM_THE_PAGE) window.removeEventListener(type, swallow, true)
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

  function imageOf(element) {
    const box = element.getBoundingClientRect()
    const image = element.cloneNode(true)
    image.removeAttribute('id')
    for (const inner of image.querySelectorAll('[id]')) inner.removeAttribute('id')
    for (const inner of image.querySelectorAll('iframe, video, audio, object, embed'))
      inner.remove()
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

  window.addEventListener('pointerdown', onNewPress, true)
  window.addEventListener('blur', onGone)
  document.addEventListener('visibilitychange', onGone)
  window.addEventListener(
    'dragstart',
    (event) => {
      if (!event.isTrusted) return
      if (drag) end(false)
      swallow(event)
      const source = event.target.nodeType === 1 ? event.target : event.target.parentElement
      if (!source) return
      const transfer = new DataTransfer()
      for (const type of event.dataTransfer?.types ?? []) {
        if (type !== 'Files') transfer.setData(type, event.dataTransfer.getData(type))
      }
      let asked = null
      transfer.setDragImage = (element) => {
        asked = element
      }
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
      source.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: pressed }))
      for (const type of PRESS_EVENTS) window.addEventListener(type, onPointer, true)
      for (const type of KEPT_FROM_THE_PAGE) window.addEventListener(type, swallow, true)
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
