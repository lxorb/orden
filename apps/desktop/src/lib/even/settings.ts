import { COMPACTIONS, DEFAULT_COMPACTION, type Marks } from '@orden/glasses/choices'
import { modes } from '../modes.svelte'
import type { Field, Group } from '../preferences'
import { resetFields } from '../reset-fields'
import { commandWords, DEFAULT_WORDS } from './commands'

export interface Setting {
  id: string
  group: string
  field: Field
  onGlasses: boolean
}

const COMPACTION_WORDS: Record<string, string> = {
  none: 'Every line break',
  collapse: 'One break between blocks',
  aggressive: 'As little as possible',
}

const MARK_WORDS: { id: keyof Marks; label: string }[] = [
  { id: 'fence', label: 'Code fences' },
  { id: 'code', label: 'Inline code' },
  { id: 'heading', label: 'Heading hashes' },
  { id: 'link', label: 'Links' },
  { id: 'bold', label: 'Bold' },
  { id: 'italic', label: 'Italic' },
  { id: 'strike', label: 'Strikethrough' },
  { id: 'highlight', label: 'Highlight' },
]

function chooser(
  label: string,
  hint: string,
  values: readonly string[],
  words: Record<string, string>,
  initial: string,
  get: () => string,
  set: (value: string) => void,
): Field {
  return {
    kind: 'select',
    label,
    hint,
    options: values.map((value) => ({ value, label: words[value] ?? value })),
    initial,
    get,
    set,
  }
}

export function glassesSettings(): Setting[] {
  const reading = 'Reading'
  const marked = 'Markdown on the panel'
  const voice = 'Voice'

  return [
    {
      id: 'break',
      group: reading,
      onGlasses: true,
      field: {
        kind: 'select',
        label: 'New page at',
        hint: 'Which headings start a new page on the glasses.',
        options: [
          { value: '1', label: 'H1' },
          { value: '2', label: 'H2 and above' },
          { value: '3', label: 'H3 and above' },
          { value: '4', label: 'H4 and above' },
          { value: '5', label: 'H5 and above' },
          { value: '6', label: 'Every heading' },
          { value: '0', label: 'Never' },
        ],
        initial: '2',
        get: () => String(modes.glassesBreak),
        set: (value) => modes.setGlassesBreak(value),
      },
    },
    {
      id: 'lineNumbers',
      group: reading,
      onGlasses: true,
      field: {
        kind: 'switch',
        label: 'Line numbers',
        hint: 'Shows line numbers on the glasses.',
        initial: true,
        get: () => modes.glassesLineNumbers,
        set: (on) => modes.setGlassesLineNumbers(on),
      },
    },
    {
      id: 'compaction',
      group: reading,
      onGlasses: true,
      field: chooser(
        'Blank lines',
        'How many blank lines the glasses keep between blocks.',
        COMPACTIONS,
        COMPACTION_WORDS,
        DEFAULT_COMPACTION,
        () => modes.glassesCompaction,
        (value) => modes.setGlassesCompaction(value),
      ),
    },
    ...MARK_WORDS.map((one): Setting => ({
      id: `mark.${one.id}`,
      group: marked,
      onGlasses: true,
      field: {
        kind: 'switch',
        label: one.label,
        hint: 'Shows this markdown mark on the glasses rather than hiding it.',
        initial: MARKS_INITIAL[one.id],
        get: () => modes.glassesMarks[one.id],
        set: (on) => modes.setGlassesMark(one.id, on),
      },
    })),

    {
      id: 'voice',
      group: voice,
      onGlasses: true,
      field: {
        kind: 'switch',
        label: 'Voice commands',
        hint: 'Lets you run commands on the glasses by speaking.',
        initial: false,
        get: () => modes.glassesVoice,
        set: (on) => modes.setGlassesVoice(on),
      },
    },
  ]
}

const MARKS_INITIAL: Marks = {
  heading: false,
  bold: false,
  italic: false,
  strike: false,
  highlight: false,
  code: true,
  fence: true,
  link: false,
}

export function glassesGroups(): Group[] {
  const out: Group[] = []
  for (const setting of glassesSettings()) {
    const last = out.at(-1)
    if (last?.title === setting.group) last.fields.push(setting.field)
    else out.push({ title: setting.group, fields: [setting.field] })
  }

  return out
}

export function wordFields(): Field[] {
  return commandWords().map((one): Field => ({
    kind: 'text',
    label: one.label,
    hint: 'What you say to run this command; left empty, the phrase shown is used.',
    placeholder: one.said,
    initial: '',
    get: () => modes.glassesWords[one.id] ?? '',
    set: (value) => modes.setGlassesWord(one.id, value),
  }))
}

export function glassesStamp(): string {
  return glassesSettings()
    .map((one) => `${one.id}=${String(one.field.get())}`)
    .join('|')
}

export function resetGlasses(): void {
  resetFields(glassesSettings().map(({ field }) => field))

  for (const id of Object.keys(DEFAULT_WORDS)) modes.setGlassesWord(id, '')
}
