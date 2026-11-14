<script lang="ts">
  import { documentOf, parsedOnScreen } from '@orden/editor'
  import { firstScreen, type Kept, sameNote } from './first-screen/src/api'
  import { mark } from './trace'
  import { views } from './views.svelte'
  import { workspace } from './workspace.svelte'

  const kept = $derived(firstScreen.showing)

  const MOST_FRAMES = 60

  function drawn(node: HTMLElement, what: Kept) {
    const area = node.parentElement
    if (!area) return

    const style = document.createElement('style')
    style.textContent = what.css
    document.head.prepend(style)

    const [surface, editor, scroller, content] = what.levels.map((one) => {
      const element = document.createElement(one.tag)
      element.className = one.className
      if (one.style) element.setAttribute('style', one.style)
      return element
    })
    if (!surface || !editor || !scroller || !content) return

    const spacer = document.createElement('div')
    spacer.style.height = `${String(what.inset)}px`
    content.style.transform = `translateY(${String(what.shift)}px)`
    content.innerHTML = what.lines
    content.prepend(spacer)
    scroller.append(content)
    editor.append(scroller)
    surface.append(editor)
    surface.style.height = '100%'
    node.append(surface)

    const now = getComputedStyle(content)
    const same =
      Math.abs(area.clientWidth - what.area.width) < 1 &&
      Math.abs(area.clientHeight - what.area.height) < 1 &&
      Object.entries(what.look).every(([name, value]) =>
        name === 'left'
          ? `${String(Math.round(content.getBoundingClientRect().left - surface.getBoundingClientRect().left))}px` ===
            value
          : now.getPropertyValue(name) === value,
      )
    if (!same) {
      style.remove()
      firstScreen.drop()
      return
    }

    if (firstScreen.rise()) surface.classList.add('rise')
    mark('first screen drawn')

    const resized = new ResizeObserver(() => {
      if (
        Math.abs(area.clientWidth - what.area.width) >= 1 ||
        Math.abs(area.clientHeight - what.area.height) >= 1
      ) {
        firstScreen.drop()
      }
    })
    resized.observe(area)

    return {
      destroy() {
        resized.disconnect()
        style.remove()
      },
    }
  }

  $effect(() => {
    const what = firstScreen.showing
    if (!what) return

    const active = workspace.active
    if (!active) {
      if (workspace.restored) firstScreen.drop()
      return
    }
    if (!sameNote(active.path, what.path) || active.kind !== 'note' || active.reading) {
      firstScreen.drop()
      return
    }

    const view = views.of(workspace.panes.focusedId)
    if (!view || documentOf(view) !== active.note.live) return

    let frame = 0
    let waited = 0
    const settle = () => {
      frame = requestAnimationFrame(() => {
        if (!parsedOnScreen(view) && ++waited < MOST_FRAMES) {
          settle()
          return
        }
        frame = requestAnimationFrame(() => {
          firstScreen.lineUp(view, what)
          frame = requestAnimationFrame(() => firstScreen.handTo(view))
        })
      })
    }
    frame = requestAnimationFrame(settle)
    return () => cancelAnimationFrame(frame)
  })

  function typing(event: KeyboardEvent) {
    if (!firstScreen.showing || event.target !== document.body) return
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return

    const typed = event.key === 'Enter' ? '\n' : event.key.length === 1 ? event.key : null
    if (typed === null) return

    event.preventDefault()
    event.stopPropagation()
    firstScreen.typed += typed
  }
</script>

<svelte:window onkeydowncapture={typing} />

{#if kept}
  <div
    class="first"
    aria-hidden="true"
    style:left="{kept.box.left}px"
    style:top="{kept.box.top}px"
    style:width="{kept.box.width}px"
    style:height="{kept.box.height}px"
    use:drawn={kept}
    onpointerdown={(event: PointerEvent) => {
      event.preventDefault()
      firstScreen.pressed = { x: event.clientX, y: event.clientY }
    }}
  ></div>
{/if}

<style>
  .first {
    position: absolute;
    z-index: var(--z-raised);
    overflow: hidden;
    background: var(--bg);
  }
</style>
