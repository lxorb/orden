import { type ChangeSpec, EditorSelection, type StateCommand } from '@codemirror/state'

/** Wraps the selection, or unwraps it when the markers are already there -
 *  so the same shortcut turns emphasis on and off. */
export function toggleWrap(before: string, after = before): StateCommand {
  return ({ state, dispatch }) => {
    const update = state.changeByRange((range) => {
      const { from, to } = range
      const doc = state.doc

      const leading = doc.sliceString(Math.max(0, from - before.length), from)
      const trailing = doc.sliceString(to, Math.min(doc.length, to + after.length))

      // Markers sit just outside the selection.
      if (leading === before && trailing === after) {
        return {
          changes: [
            { from: from - before.length, to: from },
            { from: to, to: to + after.length },
          ],
          range: EditorSelection.range(from - before.length, to - before.length),
        }
      }

      const text = doc.sliceString(from, to)

      // Markers are part of the selection.
      if (
        text.length >= before.length + after.length &&
        text.startsWith(before) &&
        text.endsWith(after)
      ) {
        return {
          changes: { from, to, insert: text.slice(before.length, text.length - after.length) },
          range: EditorSelection.range(from, to - before.length - after.length),
        }
      }

      return {
        changes: { from, to, insert: before + text + after },
        range: EditorSelection.range(from + before.length, to + before.length),
      }
    })

    dispatch(state.update(update, { scrollIntoView: true, userEvent: 'input' }))
    return true
  }
}

function selectedLines(state: Parameters<StateCommand>[0]['state']) {
  const numbers = new Set<number>()

  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let line = first; line <= last; line++) numbers.add(line)
  }

  return [...numbers].map((number) => state.doc.line(number))
}

const HEADING = /^(#{1,6})\s+/

/** Level 0 turns the line back into a paragraph. */
export function setHeading(level: number): StateCommand {
  return ({ state, dispatch }) => {
    const changes: ChangeSpec[] = selectedLines(state).map((line) => {
      const existing = HEADING.exec(line.text)
      return {
        from: line.from,
        to: line.from + (existing ? existing[0].length : 0),
        insert: level ? `${'#'.repeat(level)} ` : '',
      }
    })

    dispatch(state.update({ changes, userEvent: 'input' }))
    return true
  }
}

export function shiftHeading(delta: number): StateCommand {
  return ({ state, dispatch }) => {
    const changes: ChangeSpec[] = selectedLines(state).map((line) => {
      const existing = HEADING.exec(line.text)
      const current = existing ? existing[1].length : 0
      const next = Math.min(6, Math.max(0, current + delta))

      return {
        from: line.from,
        to: line.from + (existing ? existing[0].length : 0),
        insert: next ? `${'#'.repeat(next)} ` : '',
      }
    })

    dispatch(state.update({ changes, userEvent: 'input' }))
    return true
  }
}

/** Adds the prefix to every selected line, or strips it if all lines have it. */
export function toggleLinePrefix(prefix: string, pattern: RegExp): StateCommand {
  return ({ state, dispatch }) => {
    const lines = selectedLines(state)
    const allPrefixed = lines.every((line) => pattern.test(line.text))

    const changes: ChangeSpec[] = lines.map((line) => {
      const existing = pattern.exec(line.text)

      if (allPrefixed && existing) {
        return { from: line.from, to: line.from + existing[0].length, insert: '' }
      }
      return { from: line.from, to: line.from + (existing?.[0].length ?? 0), insert: prefix }
    })

    dispatch(state.update({ changes, userEvent: 'input' }))
    return true
  }
}

export const toggleQuote = toggleLinePrefix('> ', /^>\s?/)
export const toggleBulletList = toggleLinePrefix('- ', /^\s*[-*+]\s+/)
export const toggleTaskList = toggleLinePrefix('- [ ] ', /^\s*[-*+]\s+\[[ xX]\]\s+/)

export const toggleOrderedList: StateCommand = ({ state, dispatch }) => {
  const lines = selectedLines(state)
  const pattern = /^\s*\d+[.)]\s+/
  const allNumbered = lines.every((line) => pattern.test(line.text))

  const changes: ChangeSpec[] = lines.map((line, index) => {
    const existing = pattern.exec(line.text)
    return {
      from: line.from,
      to: line.from + (existing?.[0].length ?? 0),
      insert: allNumbered ? '' : `${index + 1}. `,
    }
  })

  dispatch(state.update({ changes, userEvent: 'input' }))
  return true
}

/** Inserts a block on its own lines, leaving the caret where you type next. */
function insertBlock(build: (indent: string) => { text: string; caret: number }): StateCommand {
  return ({ state, dispatch }) => {
    const range = state.selection.main
    const line = state.doc.lineAt(range.from)
    const atLineStart = range.from === line.from && range.empty

    const { text, caret } = build('')
    const prefix = atLineStart || !line.text ? '' : '\n'
    const insert = prefix + text

    dispatch(
      state.update({
        changes: { from: range.from, to: range.to, insert },
        selection: { anchor: range.from + prefix.length + caret },
        scrollIntoView: true,
        userEvent: 'input',
      }),
    )
    return true
  }
}

export const insertCodeFence = insertBlock(() => ({ text: '```\n\n```', caret: 3 }))

/** A fence line: up to three spaces, then three or more backticks or tildes,
 *  then whatever names the language. A backtick fence may not have backticks
 *  in that part, or it would be inline code. */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/

function fenceOf(text: string): { mark: string; info: string } | null {
  const match = FENCE.exec(text)
  if (!match) return null
  if (match[1][0] === '`' && match[2].includes('`')) return null
  return { mark: match[1], info: match[2].trim() }
}

/** Whether a line closes a fence opened with `mark`: the same character, at
 *  least as many of them, and nothing else. */
function closes(text: string, mark: string): boolean {
  const found = fenceOf(text)
  return (
    !!found && found.mark[0] === mark[0] && found.mark.length >= mark.length && !found.info
  )
}

/** Enter at the end of an opening fence closes the fence as well, with the
 *  caret on the blank line between. The parser treats a fence nothing closes
 *  as plain text (see `FencedCode` in markdown/extensions.ts), so this is
 *  what turns a typed ``` into a code block: typing it does nothing, Enter
 *  makes the block. Only a fence nothing later closes gets this; Enter on a
 *  closed one, or on the closing line of a block, is left to the ordinary
 *  handler. This reads the lines, not the tree, so it does not wait on a
 *  parse. */
export const closeFence: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main
  if (!range.empty) return false

  const line = state.doc.lineAt(range.head)
  if (range.head !== line.to) return false

  const fence = fenceOf(line.text)
  if (!fence) return false

  // Whether this line opens a block or ends one depends on everything above.
  let open: string | null = null
  for (let number = 1; number < line.number; number++) {
    const text = state.doc.line(number).text
    if (open) {
      if (closes(text, open)) open = null
    } else {
      open = fenceOf(text)?.mark ?? null
    }
  }
  if (open) return false

  for (let number = line.number + 1; number <= state.doc.lines; number++) {
    if (closes(state.doc.line(number).text, fence.mark)) return false
  }

  dispatch(
    state.update({
      changes: { from: line.to, insert: `\n\n${fence.mark}` },
      selection: { anchor: line.to + 1 },
      scrollIntoView: true,
      userEvent: 'input',
    }),
  )
  return true
}
export const insertMathBlock = insertBlock(() => ({ text: '$$\n\n$$', caret: 3 }))
export const insertHorizontalRule = insertBlock(() => ({ text: '---\n', caret: 4 }))

/** Markdown has no page break, so this is the HTML every exporter understands. */
export const insertPageBreak = insertBlock(() => ({
  text: '<div style="page-break-after: always;"></div>\n',
  caret: 45,
}))

export function insertTable(rows = 2, columns = 2): StateCommand {
  const header = `| ${Array.from({ length: columns }, (_, i) => `Column ${i + 1}`).join(' | ')} |`
  const divider = `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`
  const body = Array.from(
    { length: rows },
    () => `| ${Array.from({ length: columns }, () => '   ').join(' | ')} |`,
  )

  return insertBlock(() => ({ text: [header, divider, ...body].join('\n'), caret: 2 }))
}

const INLINE_MARKERS = /(\*\*|__|\*|_|~~|==|`)/g

/** Strips inline markers from the selection - Typora's Clear Format. */
export const clearFormatting: StateCommand = ({ state, dispatch }) => {
  const update = state.changeByRange((range) => {
    if (range.empty) return { range }

    const text = state.doc.sliceString(range.from, range.to).replace(INLINE_MARKERS, '')
    return {
      changes: { from: range.from, to: range.to, insert: text },
      range: EditorSelection.range(range.from, range.from + text.length),
    }
  })

  dispatch(state.update(update, { userEvent: 'input' }))
  return true
}

/** Wraps the selection as a link, putting the caret in the empty target. */
export const insertLink: StateCommand = ({ state, dispatch }) => {
  const update = state.changeByRange((range) => {
    const label = state.doc.sliceString(range.from, range.to)
    const insert = `[${label}]()`
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + insert.length - 1),
    }
  })

  dispatch(state.update(update, { scrollIntoView: true, userEvent: 'input' }))
  return true
}

export const insertImage: StateCommand = ({ state, dispatch }) => {
  const update = state.changeByRange((range) => {
    const label = state.doc.sliceString(range.from, range.to)
    const insert = `![${label}]()`
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + insert.length - 1),
    }
  })

  dispatch(state.update(update, { scrollIntoView: true, userEvent: 'input' }))
  return true
}

// Re-exported through here so the app can offer them in a menu without taking
// a direct dependency on CodeMirror's own packages.
export { redo as redoEdit, undo as undoEdit } from '@codemirror/commands'
export { openSearchPanel as openFind } from '@codemirror/search'
