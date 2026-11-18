globalThis.ordenAgentOf = (describe, base) => {
  const ids = new WeakMap()
  const nodes = new Map()
  let next = base

  const idOf = (node) => {
    let id = ids.get(node)
    if (!id) {
      id = next++
      ids.set(node, id)
      nodes.set(id, node)
    }
    return id
  }

  const byId = (id) => {
    const node = nodes.get(Number(id))
    return node && node.isConnected ? node : null
  }

  const prune = () => {
    for (const [id, node] of nodes) if (!node.isConnected) nodes.delete(id)
  }

  const flat = (words) =>
    String(words || '')
      .replace(/\s+/g, ' ')
      .trim()

  const hidden = (el) => {
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return true
    const tag = el.localName
    if (['script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'title'].includes(tag))
      return true
    if (tag === 'input' && String(el.type).toLowerCase() === 'hidden') return true
    try {
      const style = el.ownerDocument.defaultView.getComputedStyle(el)
      if (style.display === 'none') return true
      if (style.visibility === 'hidden' || style.visibility === 'collapse') return 'self'
    } catch {
      // Another site's, or nothing to read.
    }
    return false
  }

  const kinds = {
    button: 'button',
    submit: 'button',
    reset: 'button',
    image: 'button',
    file: 'button',
    checkbox: 'checkbox',
    radio: 'radio',
    range: 'slider',
    number: 'spinbutton',
    search: 'searchbox',
    date: 'date',
    'datetime-local': 'dateTime',
    time: 'inputTime',
    month: 'dateTime',
    week: 'dateTime',
    color: 'colorWell',
  }

  const roleOf = (el) => {
    const given = flat(el.getAttribute('role')).split(' ')[0].toLowerCase()
    if (given === 'none' || given === 'presentation') return 'none'
    if (given) return given
    const tag = el.localName
    switch (tag) {
      case 'a':
      case 'area':
        return el.hasAttribute('href') ? 'link' : 'generic'
      case 'article':
        return 'article'
      case 'aside':
        return 'complementary'
      case 'button':
        return 'button'
      case 'dialog':
        return 'dialog'
      case 'fieldset':
      case 'details':
      case 'optgroup':
        return 'group'
      case 'figure':
        return 'figure'
      case 'footer':
        return el.closest('article, aside, main, nav, section') ? 'generic' : 'contentinfo'
      case 'header':
        return el.closest('article, aside, main, nav, section') ? 'generic' : 'banner'
      case 'form':
        return 'form'
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        return 'heading'
      case 'hr':
        return 'separator'
      case 'img':
        return el.getAttribute('alt') === '' ? 'none' : 'image'
      case 'svg':
        return el.querySelector('title') || el.getAttribute('aria-label') ? 'image' : 'generic'
      case 'input': {
        const type = String(el.type || 'text').toLowerCase()
        if (kinds[type]) return kinds[type]
        return el.hasAttribute('list') ? 'combobox' : 'textbox'
      }
      case 'label':
        return 'generic'
      case 'legend':
        return 'legend'
      case 'li':
        return 'listitem'
      case 'main':
        return 'main'
      case 'nav':
        return 'navigation'
      case 'ol':
      case 'ul':
      case 'menu':
        return 'list'
      case 'dl':
        return 'list'
      case 'option':
        return 'option'
      case 'p':
        return 'paragraph'
      case 'progress':
        return 'progressbar'
      case 'meter':
        return 'meter'
      case 'section':
        return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')
          ? 'region'
          : 'generic'
      case 'select':
        return el.multiple || el.size > 1 ? 'listBox' : 'combobox'
      case 'table':
        return 'table'
      case 'caption':
        return 'caption'
      case 'thead':
      case 'tbody':
      case 'tfoot':
        return 'rowgroup'
      case 'tr':
        return 'row'
      case 'td':
        return 'cell'
      case 'th':
        return el.closest('thead') || el.getAttribute('scope') === 'col'
          ? 'columnheader'
          : 'rowheader'
      case 'textarea':
        return 'textbox'
      case 'iframe':
      case 'frame':
        return 'Iframe'
      case 'summary':
        return 'DisclosureTriangle'
      case 'blockquote':
        return 'blockquote'
      case 'code':
        return 'code'
      case 'strong':
        return 'strong'
      case 'em':
        return 'emphasis'
      default:
        return 'generic'
    }
  }

  const fromContents = new Set([
    'button',
    'link',
    'heading',
    'checkbox',
    'radio',
    'switch',
    'option',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'tab',
    'treeitem',
    'cell',
    'columnheader',
    'rowheader',
    'row',
    'tooltip',
    'LabelText',
    'legend',
    'caption',
    'DisclosureTriangle',
    'code',
    'strong',
    'emphasis',
  ])

  const contents = (el, skip = null, depth = 0) => {
    if (depth > 20) return ''
    let words = ''
    for (const child of el.childNodes) {
      if (child === skip) continue
      if (child.nodeType === 3) words += child.data
      else if (child.nodeType === 1) {
        if (hidden(child) === true) continue
        const tag = child.localName
        const type = String(child.type || '').toLowerCase()
        if (tag === 'img' || tag === 'area') words += ' ' + (child.getAttribute('alt') || '') + ' '
        else if (child.getAttribute('aria-label'))
          words += ' ' + child.getAttribute('aria-label') + ' '
        else if (tag === 'select')
          words += ' ' + [...child.selectedOptions].map((one) => one.label).join(' ') + ' '
        else if (tag === 'textarea') words += ' ' + child.value + ' '
        else if (tag === 'input')
          words += ['checkbox', 'radio', 'file', 'hidden', 'password'].includes(type)
            ? ' '
            : ' ' + child.value + ' '
        else {
          const block = ['div', 'p', 'br', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(
            tag,
          )
          words += (block ? ' ' : '') + contents(child, skip, depth + 1) + (block ? ' ' : '')
        }
      }
    }
    return words
  }

  const byIds = (el, list) =>
    flat(
      list
        .split(/\s+/)
        .map((id) => el.ownerDocument.getElementById(id))
        .filter(Boolean)
        .map((one) => one.getAttribute('aria-label') || contents(one))
        .join(' '),
    )

  const nameOf = (el, role) => {
    const by = el.getAttribute('aria-labelledby')
    if (by) {
      const named = byIds(el, by)
      if (named) return named
    }
    const label = flat(el.getAttribute('aria-label'))
    if (label) return label
    const tag = el.localName
    if (
      tag === 'input' ||
      tag === 'select' ||
      tag === 'textarea' ||
      tag === 'meter' ||
      tag === 'progress'
    ) {
      const type = String(el.type || '').toLowerCase()
      if (tag === 'input' && ['button', 'submit', 'reset'].includes(type))
        return flat(el.value) || (type === 'submit' ? 'Submit' : type === 'reset' ? 'Reset' : '')
      if (tag === 'input' && type === 'image')
        return flat(el.getAttribute('alt') || el.value || 'Submit')
      const labels = el.labels ? [...el.labels].map((one) => contents(one, el)).join(' ') : ''
      if (flat(labels)) return flat(labels)
      return flat(el.getAttribute('title') || el.getAttribute('placeholder'))
    }
    if (tag === 'img' || tag === 'area')
      return flat(el.getAttribute('alt') || el.getAttribute('title'))
    if (tag === 'svg') return flat(el.querySelector('title')?.textContent || '')
    if (tag === 'fieldset') {
      const legend = el.querySelector(':scope > legend')
      if (legend) return flat(contents(legend))
    }
    if (tag === 'table') {
      const caption = el.querySelector(':scope > caption')
      if (caption) return flat(contents(caption))
    }
    if (tag === 'figure') {
      const caption = el.querySelector(':scope > figcaption')
      if (caption) return flat(contents(caption))
    }
    if (tag === 'iframe' || tag === 'frame') return flat(el.getAttribute('title'))
    if (fromContents.has(role)) {
      const words = flat(contents(el))
      if (words) return words
    }
    return flat(el.getAttribute('title'))
  }

  const SECRET_FILLS = /^(cc-.+|one-time-code|current-password|new-password)$/
  const SECRET_NAMES =
    /\b(card ?(number|no|num)|cc ?(number|num|no)|ccnum|cardnum|credit ?card|cvc2?|cvv2?|csc|cvn|security ?code|otp|totp|2fa|mfa|one ?time ?(code|password)|verification ?code|auth(entication|enticator)? ?code|passcode|pin)(?![a-z0-9])/

  const secretField = (el, type) => {
    if (type === 'password') return true
    const tokens = String(el.getAttribute('autocomplete') || '')
      .toLowerCase()
      .split(/\s+/)
    if (tokens.some((one) => SECRET_FILLS.test(one))) return true
    const words = [el.name, el.id, el.getAttribute('aria-label'), el.getAttribute('placeholder')]
      .filter(Boolean)
      .join(' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .replace(/[_.-]+/g, ' ')
    return SECRET_NAMES.test(words)
  }

  const fieldValue = (el, role) => {
    const tag = el.localName
    if (tag === 'select') return [...el.selectedOptions].map((one) => flat(one.label)).join(', ')
    if (tag === 'textarea') return el.value
    if (tag === 'input') {
      const type = String(el.type || 'text').toLowerCase()
      if (['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file'].includes(type))
        return null
      if (secretField(el, type)) return el.value === '' ? '' : '•'
      return el.value
    }
    if (el.isContentEditable && role === 'textbox') return el.innerText
    const now = el.getAttribute('aria-valuenow')
    if (now !== null) return now
    return null
  }

  const property = (name, value) => ({ name, value: { value } })

  const propertiesOf = (el, role, doc) => {
    const out = []
    if (doc.activeElement === el) out.push(property('focused', true))
    const disabled =
      el.disabled ||
      el.getAttribute('aria-disabled') === 'true' ||
      !!el.closest('fieldset[disabled]')
    if (disabled) out.push(property('disabled', true))
    const tag = el.localName
    const type = String(el.type || '').toLowerCase()
    if (tag === 'input' && (type === 'checkbox' || type === 'radio'))
      out.push(property('checked', el.indeterminate ? 'mixed' : String(el.checked)))
    else if (el.hasAttribute('aria-checked'))
      out.push(property('checked', el.getAttribute('aria-checked')))
    if (el.hasAttribute('aria-pressed'))
      out.push(property('pressed', el.getAttribute('aria-pressed')))
    if (el.hasAttribute('aria-expanded'))
      out.push(property('expanded', el.getAttribute('aria-expanded') === 'true'))
    else if (tag === 'summary' && el.parentElement?.localName === 'details')
      out.push(property('expanded', el.parentElement.open))
    else if (role === 'combobox' && tag === 'select') out.push(property('expanded', false))
    if ((tag === 'option' && el.selected) || el.getAttribute('aria-selected') === 'true')
      out.push(property('selected', true))
    if (el.required || el.getAttribute('aria-required') === 'true')
      out.push(property('required', true))
    if (el.readOnly && (tag === 'input' || tag === 'textarea')) out.push(property('readonly', true))
    if (el.hasAttribute('aria-invalid') && el.getAttribute('aria-invalid') !== 'false')
      out.push(property('invalid', el.getAttribute('aria-invalid')))
    if (role === 'heading') {
      const level =
        Number(el.getAttribute('aria-level')) || Number(/^h([1-6])$/.exec(tag)?.[1]) || 2
      out.push(property('level', level))
    }
    if (role === 'link' && el.href) out.push(property('url', String(el.href)))
    return out
  }

  const tree = (most) => {
    prune()
    const out = []
    const fields = []
    const add = (node, parent) => {
      if (out.length >= most) return null
      const id = idOf(node)
      const entry = { nodeId: String(id), backendDOMNodeId: id, childIds: [], ignored: false }
      if (parent) entry.parentId = parent.nodeId
      out.push(entry)
      if (parent) parent.childIds.push(entry.nodeId)
      return entry
    }
    const walk = (node, parent, doc) => {
      if (out.length >= most) return
      if (node.nodeType === 3) {
        const words = node.data.replace(/\s+/g, ' ')
        if (!words.trim()) return
        const entry = add(node, parent)
        if (!entry) return
        entry.role = { value: 'StaticText' }
        entry.name = { value: words.trim() }
        return
      }
      if (node.nodeType !== 1) return
      const el = node
      const gone = hidden(el)
      if (gone === true) return
      const tag = el.localName
      if (tag === 'input' || tag === 'textarea') {
        fields.push(
          Object.assign(describe(el), { id: idOf(el), filled: String(el.value || '') !== '' }),
        )
      }
      let here = parent
      if (gone !== 'self') {
        const role = roleOf(el)
        const entry = add(el, parent)
        if (!entry) return
        entry.role = { value: role }
        entry.name = { value: nameOf(el, role) }
        const value = fieldValue(el, role)
        if (value !== null && value !== undefined) entry.value = { value: String(value) }
        entry.properties = propertiesOf(el, role, doc)
        here = entry
      }
      if (tag === 'iframe' || tag === 'frame') {
        let inner = null
        try {
          inner = el.contentDocument
        } catch {
          // Another site's, or nothing to read.
        }
        if (inner && inner.body) {
          const root = add(inner, here)
          if (root) {
            root.role = { value: 'RootWebArea' }
            root.name = { value: flat(inner.title) }
            walk(inner.body, root, inner)
          }
        }
        return
      }
      if (tag === 'select') {
        for (const option of el.options) walk(option, here, doc)
        return
      }
      for (const child of el.shadowRoot ? el.shadowRoot.childNodes : el.childNodes)
        walk(child, here, doc)
    }
    const root = add(document, null)
    root.role = { value: 'RootWebArea' }
    root.name = { value: flat(document.title) }
    if (document.body) walk(document.body, root, document)
    return { nodes: out, fields }
  }

  const on = (id, body, args) => {
    const node = byId(id)
    if (!node) return { gone: true }
    const run = new Function(`return (${body})`)()
    return { value: run.apply(node, args || []) }
  }

  const box = (id, scroll) => {
    const node = byId(id)
    if (!node) return { gone: true }
    const el = node.nodeType === 1 ? node : node.parentElement
    if (!el) return { gone: true }
    if (scroll) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
    let rect = el.getBoundingClientRect()
    if (node.nodeType === 3) {
      const range = document.createRange()
      range.selectNodeContents(node)
      rect = range.getBoundingClientRect()
    }
    let x = rect.left
    let y = rect.top
    for (let view = el.ownerDocument.defaultView; view && view !== window; view = view.parent) {
      const frame = view.frameElement
      if (!frame) break
      const outer = frame.getBoundingClientRect()
      x += outer.left + frame.clientLeft
      y += outer.top + frame.clientTop
    }
    return { x, y, width: rect.width, height: rect.height }
  }

  const at = (x, y) => {
    let doc = document
    let el = doc.elementFromPoint(x, y)
    while (el && (el.localName === 'iframe' || el.localName === 'frame')) {
      let inner = null
      try {
        inner = el.contentDocument
      } catch {
        // Another site's, or nothing to read.
      }
      if (!inner) break
      const outer = el.getBoundingClientRect()
      x -= outer.left + el.clientLeft
      y -= outer.top + el.clientTop
      doc = inner
      el = doc.elementFromPoint(x, y)
    }
    return el ? idOf(el) : null
  }

  const active = () => {
    let el = document.activeElement
    try {
      while (el && el.contentDocument && el.contentDocument.activeElement)
        el = el.contentDocument.activeElement
    } catch {
      // Another site's, or nothing to read.
    }
    return el ? idOf(el) : null
  }

  return { idOf, byId, tree, on, box, at, active }
}
