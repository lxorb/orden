import { safeHref } from '@orden/markdown/html'

export const flowSource = (code: string): string => code.replace(/:\$[^\n]*/g, '')

export function keepSafeLinks(root: Element): void {
  for (const node of root.querySelectorAll('*'))
    for (const attribute of [...node.attributes])
      if (attribute.localName === 'href' && !safeHref(attribute.value)) node.removeAttributeNode(attribute)
}
