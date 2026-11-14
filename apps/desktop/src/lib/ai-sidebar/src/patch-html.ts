function isElement(node: Node): node is Element {
  return node.nodeType === 1
}

function sameShell(mine: Node, theirs: Node): boolean {
  if (!isElement(mine) || !isElement(theirs) || mine.tagName !== theirs.tagName) return false
  if (mine.attributes.length !== theirs.attributes.length) return false
  for (const one of mine.attributes) {
    if (theirs.getAttribute(one.name) !== one.value) return false
  }
  return true
}

function deepestLast(node: Node): Node {
  let last = node
  while (last.lastChild) last = last.lastChild
  return last
}

function endsAlike(mine: Node, theirs: Node): boolean {
  return deepestLast(mine).isEqualNode(deepestLast(theirs))
}

function patchChildren(old: Node, fresh: Node): void {
  let mine = old.firstChild
  let theirs = fresh.firstChild

  while (mine && theirs) {
    const next = theirs.nextSibling
    if (!sameShell(mine, theirs)) {
      if (!mine.isEqualNode(theirs)) {
        old.replaceChild(theirs, mine)
        mine = theirs
      }
    } else if (!endsAlike(mine, theirs) || !mine.isEqualNode(theirs)) {
      patchChildren(mine, theirs)
    }
    mine = mine.nextSibling
    theirs = next
  }

  while (mine) {
    const next: ChildNode | null = mine.nextSibling
    mine.remove()
    mine = next
  }
  while (theirs) {
    const next: ChildNode | null = theirs.nextSibling
    old.appendChild(theirs)
    theirs = next
  }
}

export function patchHtml(host: Element, html: string): void {
  const fresh = host.ownerDocument.createElement('template')
  fresh.innerHTML = html
  patchChildren(host, fresh.content)
}
