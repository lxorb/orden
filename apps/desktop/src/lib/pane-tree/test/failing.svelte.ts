import { workspace } from '../../workspace/src/api'

export const failing = { before: false, after: false }
export function failingRoot(): () => void {
  return $effect.root(() => {
    $effect.pre(() => {
      const front = workspace.activeTabId
      if (front && failing.before) throw new Error('a store failed before the pane was drawn')
    })
    $effect(() => {
      const front = workspace.activeTabId
      if (front && failing.after) throw new Error('a store failed after the pane was drawn')
    })
  })
}
