import { history, undo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorState, type StateCommand } from '@codemirror/state'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { editLink, linkPartsAt, removeLink } from './link-edit'
import { nibMarkdownExtensions } from './markdown/extensions'
import { parsed } from '../test/parsed'

function state(doc: string, readOnly = false) {
  return parsed(
    EditorState.create({
      doc,
      extensions: [
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
        EditorState.readOnly.of(readOnly),
      ],
    }),
  )
}

/** What a command leaves: the text, and what is selected in it. */
function after(doc: string, command: StateCommand, readOnly = false) {
  let current = state(doc, readOnly)
  const ran = command({
    state: current,
    dispatch: (transaction) => (current = transaction.state),
  })
  const { from, to } = current.selection.main
  return { ran, doc: current.doc.toString(), selected: current.doc.sliceString(from, to) }
}

/** The position inside the first occurrence of `words`. */
const inside = (doc: string, words: string) => doc.indexOf(words) + 1

describe('the link a press landed on', () => {
  test.each([
    ['see [the *docs*](https://x.dev "t") now', 'docs', 'https://x.dev', 'the *docs*'],
    ['see <https://x.dev> now', 'x.dev', 'https://x.dev', null],
    ['see www.x.dev now', 'x.dev', 'www.x.dev', null],
    ['see [[Plan#Today|the plan]] now', 'plan', 'Plan#Today', 'the plan'],
    ['see [[Plan]] now', 'Plan', 'Plan', 'Plan'],
    ['see [words][ref] now\n\n[ref]: https://r.dev', 'words', 'ref', 'words'],
    ['see [words][] now\n\n[words]: https://r.dev', 'words', '', 'words'],
    ['see [words] now\n\n[words]: https://r.dev', 'words', '', 'words'],
    ['see [words]() now', 'words', '', 'words'],
  ])('%s', (doc, at, target, words) => {
    const parts = linkPartsAt(state(doc), inside(doc, at))
    expect(parts && doc.slice(parts.target.from, parts.target.to)).toBe(target)
    expect(parts?.words).toBe(words)
  })

  test('is found from its address as well as from its words', () => {
    const doc = 'see [docs](https://x.dev) now'
    expect(linkPartsAt(state(doc), inside(doc, 'x.dev'))?.words).toBe('docs')
  })

  test('is no picture and no embed, which have menus of their own', () => {
    for (const doc of ['![shot](https://x.dev/a.png)', '![[shot.png]]', 'plain words']) {
      expect(linkPartsAt(state(doc), 4), doc).toBeNull()
    }
  })
})

describe('editing it', () => {
  test('selects where it points, so the next thing typed is the new address', () => {
    const doc = 'see [docs](https://x.dev) now'
    const done = after(doc, editLink(inside(doc, 'docs')))
    expect(done).toEqual({ ran: true, doc, selected: 'https://x.dev' })
  })

  test('selects the note of a link with words of its own, not the words', () => {
    const doc = 'see [[Plan|the plan]] now'
    expect(after(doc, editLink(inside(doc, 'the plan'))).selected).toBe('Plan')
  })
})

describe('editing a link by its label', () => {
  /** What typing an address over the selection leaves, which has to be a link to it. */
  function typed(doc: string) {
    let current = state(doc)
    editLink(inside(doc, 'words'))({
      state: current,
      dispatch: (transaction) => (current = transaction.state),
    })
    return current
      .update(
        current.changeByRange((range) => ({
          range,
          changes: { from: range.from, to: range.to, insert: 'https://new.dev' },
        })),
      )
      .state.doc.toString()
  }

  test.each([
    ['[words][ref]\n\n[ref]: https://r.dev', '[words][ref]\n\n[ref]: https://new.dev'],
    ['[words][REF]\n\n[ref]: https://r.dev', '[words][REF]\n\n[ref]: https://new.dev'],
    ['[words][]\n\n[words]: https://r.dev', '[words][]\n\n[words]: https://new.dev'],
    ['[words]\n\n[words]: https://r.dev', '[words]\n\n[words]: https://new.dev'],
    ['> [words][ref]\n>\n> [ref]: https://r.dev', '> [words][ref]\n>\n> [ref]: https://new.dev'],
  ])('%s changes the address its definition holds', (doc, left) => {
    expect(typed(doc)).toBe(left)
  })

  test.each([
    ['[words][ref] now', '[words](https://new.dev) now'],
    ['[words][] now', '[words](https://new.dev) now'],
    ['[words] now', '[words](https://new.dev) now'],
  ])('%s with no definition becomes a link to what is typed', (doc, left) => {
    expect(typed(doc)).toBe(left)
  })

  test('selects a label nothing defines, written where an address goes', () => {
    const done = after('[words][ref] now', editLink(1))
    expect(done).toEqual({ ran: true, doc: '[words](ref) now', selected: 'ref' })
  })

  test('takes the first of two definitions, as a reader does', () => {
    expect(typed('[words][a]\n\n[a]: https://one.dev\n[a]: https://two.dev')).toBe(
      '[words][a]\n\n[a]: https://new.dev\n[a]: https://two.dev',
    )
  })
})

describe('editing a link by a label, in a long note', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const body = 'some words and a [link](https://x.dev) with *marks*\n\n'.repeat(2000)
  const long = `[words][ref]\n\n${body}[ref]: https://r.dev\n`
  /** Not run through `parsed`: as the note stands before the parser has reached its end. */
  const unparsed = () =>
    EditorState.create({
      doc: long,
      extensions: [markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions })],
    })

  test('finds a definition the parser had not reached, however late the hour', () => {
    let current = unparsed()
    expect(syntaxTree(current).length).toBeLessThan(long.length)
    // Every read of the clock is past any budget, so nothing here depends on a machine.
    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 300))
    const ran = editLink(1)({
      state: current,
      dispatch: (transaction) => (current = transaction.state),
    })
    const { from, to } = current.selection.main
    expect(ran).toBe(true)
    expect(current.doc.toString()).toBe(long)
    expect(current.doc.sliceString(from, to)).toBe('https://r.dev')
  })

  test('building the menu parses nothing', () => {
    const current = unparsed()
    const before = syntaxTree(current).length
    expect(linkPartsAt(current, 1)?.words).toBe('words')
    expect(syntaxTree(current).length).toBe(before)
  })
})

describe('what counts as a label being defined', () => {
  test.each([
    ['[words][STRASSE]\n\n[Straße]: https://r.dev', 'https://r.dev'],
    ['[words][Straße]\n\n[STRASSE]: https://r.dev', 'https://r.dev'],
    ['[words][e]\n\n[e]: <>\n[e]: https://two.dev', '<>'],
    ['[words][a  b]\n\n[A\tB]: https://r.dev', 'https://r.dev'],
  ])('%s', (doc, selected) => {
    expect(after(doc, editLink(1))).toEqual({ ran: true, doc, selected })
  })

  test('a definition written in a code block defines nothing', () => {
    const doc = '[words][ref]\n\n```\n[ref]: https://r.dev\n```'
    expect(after(doc, editLink(1)).doc).toBe(doc.replace('[ref]', '(ref)'))
  })
})

describe('a label left behind by an edit nobody finished', () => {
  /** Whether the text reads as one link with an address of its own. */
  const linksOut = (doc: string) => {
    const parts = linkPartsAt(state(doc), 1)
    return parts?.to === doc.length && parts.label === undefined
  }

  test.each([
    ['[words][ref]', '[words](ref)', 'ref'],
    ['[words][Some  words]', '[words](<Some  words>)', '<Some  words>'],
    ['[words][a(b]', '[words](<a(b>)', '<a(b>'],
    ['[words][a<b]', '[words](<a%3Cb>)', '<a%3Cb>'],
    ['[words][a\\]b]', '[words](<a\\]b>)', '<a\\]b>'],
    ['[words][a\nb]', '[words](<a b>)', '<a b>'],
    ['[words][]', '[words]()', ''],
    ['[words]', '[words]()', ''],
  ])('%s stays a link', (doc, left, selected) => {
    expect(after(doc, editLink(1))).toEqual({ ran: true, doc: left, selected })
    expect(linksOut(left), left).toBe(true)
  })
})

describe('undoing an edit of a label', () => {
  function editing(doc: string) {
    let current = EditorState.create({
      doc,
      extensions: [
        markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
        history(),
      ],
    })
    const dispatch = (transaction: { state: EditorState }) => (current = transaction.state)
    const type = (insert: string, at = current.selection.main) =>
      (current = current.update({
        changes: { from: at.from, to: at.to, insert },
        selection: { anchor: at.from + insert.length },
        userEvent: 'input.type',
      }).state)
    return {
      edit: () => editLink(1)({ state: current, dispatch }),
      type,
      undo: () => undo({ state: current, dispatch }),
      text: () => current.doc.toString(),
    }
  }

  test('takes the swap back as one step of its own', () => {
    const note = editing('[words][ref] now')
    note.edit()
    expect(note.text()).toBe('[words](ref) now')
    note.undo()
    expect(note.text()).toBe('[words][ref] now')
  })

  test('takes what was typed first and the swap after it, however quickly it was typed', () => {
    const note = editing('[words][ref] now')
    note.edit()
    note.type('https://new.dev')
    expect(note.text()).toBe('[words](https://new.dev) now')
    note.undo()
    expect(note.text()).toBe('[words](ref) now')
    note.undo()
    expect(note.text()).toBe('[words][ref] now')
  })
})

describe('taking it away', () => {
  test.each([
    ['see [the *docs*](https://x.dev) now', 'docs', 'see the *docs* now'],
    ['see [[Plan#Today|the plan]] now', 'plan', 'see the plan now'],
    ['see [[Plan#Today]] now', 'Plan', 'see Plan#Today now'],
  ])('%s keeps its words', (doc, at, left) => {
    expect(after(doc, removeLink(inside(doc, at)))).toMatchObject({ ran: true, doc: left })
  })

  test('is nothing for an address written out, which would still be the link', () => {
    const doc = 'see <https://x.dev> now'
    expect(after(doc, removeLink(inside(doc, 'x.dev')))).toMatchObject({ ran: false, doc })
  })

  test('and nothing in a note nobody can write in', () => {
    const doc = 'see [docs](https://x.dev) now'
    expect(after(doc, removeLink(inside(doc, 'docs')), true)).toMatchObject({ ran: false, doc })
    expect(after(doc, editLink(inside(doc, 'docs')), true).ran).toBe(false)
  })
})
