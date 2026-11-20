export function marked(node: HTMLElement, kind: string) {
  const holder = node.parentElement
  const own = `orden-marked-${kind}`
  holder?.classList.add('orden-marked', own)
  return {
    destroy() {
      if (!holder) return
      const others = [...holder.children].filter((one) => one !== node)
      if (!others.some((one) => one.classList.contains('orden-mark'))) holder.classList.remove('orden-marked')
      if (!others.some((one) => one.classList.contains(`orden-${kind}`))) holder.classList.remove(own)
    },
  }
}
