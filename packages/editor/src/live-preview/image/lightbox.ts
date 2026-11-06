import type { EditorView } from '@codemirror/view'

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
