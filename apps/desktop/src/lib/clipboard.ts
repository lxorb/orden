export function copySelection(): void {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- the Clipboard API cannot read the focused element's selection
  document.execCommand('copy')
}

export function cutSelection(): void {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- nothing in the Clipboard API removes the selection it copied
  document.execCommand('cut')
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    // Fall through to the selection below.
  }

  const scratch = document.createElement('textarea')
  scratch.value = text
  scratch.setAttribute('readonly', '')
  scratch.style.position = 'fixed'
  scratch.style.opacity = '0'
  document.body.append(scratch)
  scratch.select()
  copySelection()
  scratch.remove()
}
