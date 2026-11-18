// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { beforeAll, describe, expect, test } from 'vitest'
import { parsed } from '../../test/parsed'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { buildDecorations, loadTaskChips } from './decorate'
import { chipsOf, CommentChipsWidget, commentDrawing, TaskChipsWidget } from './task-chips'
import { dayWords } from '../task-days'

beforeAll(async () => {
  await loadTaskChips()
})

function stateOf(doc: string, cursor: number) {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
}

function hidden(state: EditorState): string[] {
  const out: string[] = []
  buildDecorations(state).atomic.between(0, state.doc.length, (from, to) => {
    out.push(state.doc.sliceString(from, to))
  })
  return out
}

function chipsDrawn(state: EditorState): boolean {
  let found = false
  buildDecorations(state).decorations.between(0, state.doc.length, (_from, _to, value) => {
    if (value.spec.widget instanceof TaskChipsWidget) found = true
  })
  return found
}

const LINE = '- [ ] Call the bank [time:: 16:00] #admin ⏫ 📅 2026-10-06'
const PARKED = `${LINE}\n\nwords`

describe("a task's fields", () => {
  test('are hidden like marks while the caret is elsewhere, the tag kept', () => {
    const shown = hidden(stateOf(PARKED, PARKED.length))
    expect(shown).toEqual(expect.arrayContaining([' [time:: 16:00]', ' ⏫', ' 📅 2026-10-06']))
    expect(shown.join('')).not.toContain('#admin')
    expect(chipsDrawn(stateOf(PARKED, PARKED.length))).toBe(true)
  })

  test('and are the source again with the caret on the line, with no chips', () => {
    const state = stateOf(PARKED, 10)
    expect(hidden(state).join('')).not.toContain('📅')
    expect(chipsDrawn(state)).toBe(false)
  })

  test("every task line but the caret's gets its own", () => {
    const two = '- [ ] Call mum tomorrow #family 🔺\n- [ ] Pay rent ⏫ 📅 2026-10-09\n'
    let drawn = 0
    const state = stateOf(two, 0)
    buildDecorations(state).decorations.between(0, state.doc.length, (_from, _to, value) => {
      if (value.spec.widget instanceof TaskChipsWidget) drawn++
    })
    expect(drawn).toBe(1)
    expect(hidden(state)).toEqual(expect.arrayContaining([' ⏫', ' 📅 2026-10-09']))
  })

  test('a task with no field draws nothing extra', () => {
    const plain = '- [ ] Water the plants\n\nwords'
    expect(chipsDrawn(stateOf(plain, plain.length))).toBe(false)
  })
})

describe('the chips', () => {
  test('say the day, the rule, the flag, the bell and the length, in that order', () => {
    const chips = chipsOf(
      {
        text: 'x',
        status: ' ',
        done: false,
        cancelled: false,
        due: '2026-10-06',
        time: '16:00',
        recurrence: 'every week',
        priority: 1,
        remind: [{ before: 15 }],
        duration: 90,
        tags: [],
        dependsOn: [],
        fields: {},
      },
      '2026-10-01',
    )
    expect(chips.map((chip) => chip.field)).toEqual([
      'date',
      'recurrence',
      'priority',
      'remind',
      'duration',
    ])
    expect(chips.find((chip) => chip.field === 'duration')?.text).toBe('⏱ 1h30m')
    expect(chips.find((chip) => chip.field === 'priority')?.tone).toBe('p1')
  })

  test('mark a deadline gone by as overdue, and not a done one, and never a start date', () => {
    const base = {
      text: 'x',
      status: ' ',
      done: false,
      cancelled: false,
      due: '2026-09-30',
      priority: 4 as const,
      remind: [],
      tags: [],
      dependsOn: [],
      fields: {},
    }
    expect(chipsOf(base, '2026-10-01')).toEqual([])
    expect(chipsOf(base, '2026-10-01', 'deadline')[0]).toMatchObject({
      field: 'deadline',
      tone: 'overdue',
    })
    expect(chipsOf({ ...base, done: true }, '2026-10-01', 'deadline')[0]?.tone).toBeUndefined()
    expect(chipsOf({ ...base, due: '2026-10-05' }, '2026-10-01')[0]).toEqual({
      field: 'date',
      text: expect.any(String) as string,
    })
  })
})

describe("a task's comment", () => {
  const NOTE = '- [ ] Call the bank\n  - Called again [at:: 2026-10-06T09:30] [by:: Lu]\n\nwords'

  test('hides its when and its who like marks, and says them as quiet chips', () => {
    const state = stateOf(NOTE, NOTE.length)
    expect(hidden(state)).toEqual(
      expect.arrayContaining([' [at:: 2026-10-06T09:30]', ' [by:: Lu]']),
    )
    let said: string[] = []
    buildDecorations(state).decorations.between(0, state.doc.length, (_from, _to, value) => {
      if (value.spec.widget instanceof CommentChipsWidget) said = [...value.spec.widget.chips]
    })
    expect(said).toHaveLength(2)
    expect(said[1]).toBe('Lu')
  })

  test('is the source again with the caret on its line', () => {
    const at = NOTE.indexOf('Called')
    expect(hidden(stateOf(NOTE, at)).join('')).not.toContain('[by:: Lu]')
  })

  test('reads its moment as a day and a time, and a task line draws none of it', () => {
    expect(commentDrawing('  - Done [at:: 2026-10-06T09:30]', '2026-10-06')?.chips).toEqual([
      dayWords('2026-10-06', '2026-10-06', '09:30'),
    ])
    expect(commentDrawing('- [ ] A task [at:: 2026-10-06]', '2026-10-06')).toBeNull()
    expect(commentDrawing('  - Nothing to say', '2026-10-06')).toBeNull()
  })
})
