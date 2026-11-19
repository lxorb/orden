export function autoDir(node: HTMLElement, _shown: string) {
  node.dir = 'auto'
  return {
    update() {
      node.dir = 'auto'
    },
  }
}
