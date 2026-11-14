import { pageBytes, invoke, isDesktop, platform } from '../../platform/src/api'

export interface PaperInches {
  width: number
  height: number
  margin: number
  landscape: boolean
}

export function printsInFrame(): boolean {
  return !(isDesktop && platform() === 'macos')
}

export function printInFrame(html: string | Blob, page?: PaperInches): Promise<void> {
  if (!printsInFrame()) {
    return pageBytes(html)
      .then((bytes) => invoke('print_page', { bytes, page: page ?? null }))
      .then(
        () => undefined,
        () => undefined,
      )
  }

  return new Promise((resolve) => {
    const from = document.activeElement

    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;'

    const link = typeof html === 'string' ? null : URL.createObjectURL(html)

    let done = false
    const finish = () => {
      if (done) return
      done = true

      const ours = document.activeElement === frame
      frame.remove()
      if (link) URL.revokeObjectURL(link)
      if (ours && from instanceof HTMLElement && from.isConnected) from.focus()

      resolve()
    }

    const show = async () => {
      const inner = frame.contentWindow
      if (!inner) {
        finish()
        return
      }

      await inner.document.fonts.ready.catch(() => undefined)
      inner.addEventListener('afterprint', finish, { once: true })
      inner.focus()
      inner.print()
      window.setTimeout(finish, 5 * 60 * 1000)
    }

    frame.addEventListener('load', () => void show().catch(finish))

    if (link) frame.src = link
    else if (typeof html === 'string') frame.srcdoc = html
    document.body.append(frame)
  })
}
