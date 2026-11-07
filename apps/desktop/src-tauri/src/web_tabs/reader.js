;(() => {
  const wanted = '__SELECTION__' === 'yes'
  const longest = Number('__LONGEST__')
  const title = (document.title || '').trim()

  try {
    const picked = wanted ? window.getSelection() : null
    const chosen =
      picked !== null &&
      !picked.isCollapsed &&
      picked.rangeCount > 0 &&
      picked.toString().trim() !== ''

    const root = document.documentElement.cloneNode(false)
    const head = document.head ? document.head.cloneNode(true) : document.createElement('head')
    let body

    if (chosen) {
      body = document.createElement('body')
      for (let index = 0; index < picked.rangeCount; index += 1) {
        body.append(picked.getRangeAt(index).cloneContents())
      }
      root.setAttribute('data-orden-selection', '')
    } else {
      body = document.body ? document.body.cloneNode(true) : document.createElement('body')
    }

    /* __HIDE__ */
    for (const one of head.querySelectorAll('base')) one.remove()
    const base = document.createElement('base')
    base.setAttribute('href', document.baseURI)
    head.prepend(base)

    root.append(head, body)
    for (const one of root.querySelectorAll('script, style, link')) one.remove()
    for (const one of root.querySelectorAll('input[type=password]')) one.remove()
    for (const one of root.querySelectorAll('input[value]')) one.removeAttribute('value')

    const html = `<!DOCTYPE html>${root.outerHTML}`
    return { url: location.href, title, html: html.slice(0, longest) }
  } catch {
    return { url: location.href, title, html: '' }
  }
})()
