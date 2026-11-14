import { isMarkdownPath } from './platform/src/api'
import { workspace } from './workspace.svelte'

export function pickOne<T>(choices: readonly T[], roll: number): T | null {
  if (!choices.length) return null
  return choices[Math.min(Math.floor(roll * choices.length), choices.length - 1)] ?? null
}

export function randomChoices(): string[] {
  const open = workspace.active?.path
  return workspace.notes
    .map((one) => one.path)
    .filter(
      (path) =>
        path !== open &&
        isMarkdownPath(path) &&
        !workspace.excluded.has(path) &&
        !workspace.archive.has(path),
    )
}

export function openRandomNote(roll: number = Math.random()): void {
  const path = pickOne(randomChoices(), roll)
  if (path !== null) void workspace.open(path)
}
