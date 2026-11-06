import { COMPACTIONS, DEFAULT_COMPACTION, type Marks } from '@orden/glasses/choices'
import { key, t } from '../i18n.svelte'
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
  none: key('Every line break'),
  collapse: key('One break between blocks'),
  aggressive: key('As little as possible'),
}

const MARK_WORDS: { id: keyof Marks; label: string }[] = [
  { id: 'fence', label: key('Code fences') },
  { id: 'code', label: key('Inline code') },
  { id: 'heading', label: key('Heading hashes') },
  { id: 'link', label: key('Links') },
  { id: 'bold', label: key('Bold') },
  { id: 'italic', label: key('Italic') },
  { id: 'strike', label: key('Strikethrough') },
  { id: 'highlight', label: key('Highlight') },
]

type Say = (text: string) => string

function chooser(
  say: Say,
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
    options: values.map((value) => ({ value, label: say(words[value] ?? value) })),
    initial,
    get,
    set,
  }
}

export function glassesSettings(say: Say = t): Setting[] {
  const reading = say('Reading')
  const marked = say('Markdown on the panel')
  const voice = say('Voice')

  return [
    {
      id: 'break',
      group: reading,
      onGlasses: true,
      field: {
        kind: 'select',
        label: say('New page at'),
        hint: t('Which headings start a new page on the glasses.'),
        options: [
          { value: '1', label: say('H1') },
          { value: '2', label: say('H2 and above') },
          { value: '3', label: say('H3 and above') },
          { value: '4', label: say('H4 and above') },
          { value: '5', label: say('H5 and above') },
          { value: '6', label: say('Every heading') },
          { value: '0', label: say('Never') },
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
        label: say('Line numbers'),
        hint: t('Shows line numbers on the glasses.'),
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
        say,
        say('Blank lines'),
        t('How many blank lines the glasses keep between blocks.'),
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
        label: say(one.label),
        hint: t('Shows this markdown mark on the glasses rather than hiding it.'),
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
        label: say('Voice commands'),
        hint: t('Lets you run commands on the glasses by speaking.'),
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
    label: t(one.label),
    hint: t('What you say to run this command; left empty, the phrase shown is used.'),
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
