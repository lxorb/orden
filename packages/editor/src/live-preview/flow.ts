import { safeHref } from '@orden/markdown/html'

export function flowSource(code: string): string {
  return code.replace(/:\$[^\n]*/g, '')
}

export function keepSafeLinks(root: Element): void {
  for (const node of root.querySelectorAll('*')) {
    for (const attribute of [...node.attributes]) {
      if (attribute.localName === 'href' && !safeHref(attribute.value)) {
        node.removeAttributeNode(attribute)
      }
    }
  }
}
