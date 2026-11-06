let handing: (() => void) | null = null

export function cardWriting(commit: (() => void) | null): void {
  handing = commit
}

export function flushCardEdits(): void {
  handing?.()
}
