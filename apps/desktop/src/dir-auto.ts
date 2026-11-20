const read = new WeakMap<HTMLElement, string>()
export function dirAuto(node: HTMLElement): void {
  const text = node.textContent
  const was = read.get(node)
  read.set(node, text)
  if (was === undefined || was === text) return
  const dir = node.dir
  node.dir = dir
}
