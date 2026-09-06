import type { EditorView } from '@codemirror/view'

/** The full-window preview a double click opens.
 *
 *  Built and torn down on its own rather than being a widget: it belongs to the
 *  window, not to a place in the document, and it must outlive the frame that
 *  opened it - a picture whose widget is rebuilt while the lightbox is up should
 *  not close it. So it hangs off the body, keeps the one listener it needs, and
 *  hands focus back to the editor on the way out. */

/** Full-window preview. Escape or a click outside closes it; a click on a
 *  picture larger than the window toggles it between fitting and actual
 *  size. Focus goes back to the editor afterwards. */
export function openLightbox(view: EditorView, src: string, alt: string) {
  const backdrop = document.createElement('div')
  backdrop.className = 'nib-lightbox'

  const figure = document.createElement('figure')
  figure.className = 'nib-lightbox-figure'
  backdrop.append(figure)

  const image = document.createElement('img')
  image.src = src
  image.alt = alt
  image.draggable = false
  figure.append(image)

  if (alt) {
    const caption = document.createElement('figcaption')
    caption.textContent = alt
    figure.append(caption)
  }

  let closing = false
  const close = () => {
    if (closing) return
    closing = true
    document.removeEventListener('keydown', onKey, true)
    backdrop.classList.add('is-closing')
    // The fade-out is short; if motion is off it is instant, and the timer
    // is there for either case.
    const done = () => backdrop.remove()
    backdrop.addEventListener('animationend', done, { once: true })
    window.setTimeout(done, 300)
    view.focus()
  }

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    close()
  }

  const fits = () =>
    image.naturalWidth <= image.clientWidth + 1 && image.naturalHeight <= image.clientHeight + 1

  image.addEventListener('load', () => backdrop.classList.toggle('can-zoom', !fits()))
  image.addEventListener('click', (event) => {
    event.stopPropagation()
    if (backdrop.classList.contains('is-actual')) {
      backdrop.classList.remove('is-actual')
      backdrop.classList.toggle('can-zoom', !fits())
    } else if (!fits()) {
      backdrop.classList.add('is-actual')
    } else {
      close()
    }
  })

  backdrop.addEventListener('click', close)
  document.addEventListener('keydown', onKey, true)
  document.body.append(backdrop)
}
