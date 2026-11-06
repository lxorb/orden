import { door as fetched } from '@orden/markdown/door'

type Commands = typeof import('./line-commands')

let loaded: Commands | null = null

export const loadLineCommands: () => Promise<Commands> = fetched(() =>
  import('./line-commands').then((module) => (loaded = module)),
)

function door<Target>(
  pick: (commands: Commands) => (target: Target) => boolean,
): (target: Target) => boolean {
  return (target) => {
    if (loaded) return pick(loaded)(target)
    void loadLineCommands().then((commands) => pick(commands)(target))

    return true
  }
}

export const deleteLine = door((commands) => commands.deleteLine)
export const joinLines = door((commands) => commands.joinLines)
export const sortLines = door((commands) => commands.sortLines)
export const reverseLines = door((commands) => commands.reverseLines)
export const insertLineAbove = door((commands) => commands.insertLineAbove)
export const upperCase = door((commands) => commands.upperCase)
export const lowerCase = door((commands) => commands.lowerCase)
export const titleCase = door((commands) => commands.titleCase)
export const expandSelection = door((commands) => commands.expandSelection)
export const shrinkSelection = door((commands) => commands.shrinkSelection)
export const duplicateBlock = door((commands) => commands.duplicateBlock)
export const moveBlockUp = door((commands) => commands.moveBlockUp)
export const moveBlockDown = door((commands) => commands.moveBlockDown)

const writable =
  <Target extends { state: { readOnly: boolean } }>(
    run: (target: Target) => boolean,
  ): ((target: Target) => boolean) =>
  (target) =>
    !target.state.readOnly && run(target)

export const indentItems = writable(door((commands) => commands.indentItems))
export const outdentItems = writable(door((commands) => commands.outdentItems))
const moveDown = door((commands) => commands.moveLineOver(1))
const moveUp = door((commands) => commands.moveLineOver(-1))
export const moveLineOver = (delta: -1 | 1) => writable(delta < 0 ? moveUp : moveDown)

export const clearFormatting = door((commands) => commands.clearFormatting)

export const marksAcross = (mark: string) => door((commands) => commands.marksAcross(mark))
