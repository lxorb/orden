import {
  BODY_INNER,
  BODY_ROWS,
  fit,
  pageOfLine,
  ruleOf,
  HEAD_INNER,
  spread,
  width,
  wrap,
} from '@orden/glasses'
import type { Session } from './session'

export interface Row {
  label: string
  depth: number
  folder: boolean
  open: boolean
  pick: boolean
  id: string
}

export interface World {
  space: () => string
  contents: () => Row[]
  spaces: () => Row[]
  tree: () => Row[]
  open: (id: string) => void
  fold: (id: string) => void
  enter: (id: string) => void
  listen: (on: boolean) => void
  listening: () => boolean
  atSpace: () => string
  atNote: () => string
  today: () => Row[]
  freshToday: () => void
  tick: (id: string) => void
}

export interface Settings {
  rows: () => SettingRow[]
  tap: (id: string) => readonly Option[] | null
  pick: (id: string, value: string) => void
  reset: () => void
}

export interface SettingRow {
  id: string
  label: string
  value: string
}

export interface Option {
  value: string
  label: string
}

export interface Words {
  spaces: string
  notes: string
  switchSpace: string
  changeNote: string
  voiceOn: string
  voiceOff: string
  thinking: string
  nothingHere: string
  noAnswer: string
  settings: string
  reset: string
  done: string
  today: string
}

export type Screen =
  | { kind: 'note' }
  | { kind: 'sidebar'; at: number }
  | { kind: 'modal'; at: number }
  | { kind: 'spaces'; at: number }
  | { kind: 'tree'; at: number }
  | { kind: 'settings'; at: number }
  | { kind: 'today'; at: number }
  | { kind: 'choice'; id: string; title: string; rows: readonly Option[]; at: number }
  | { kind: 'asking'; question: string }
  | { kind: 'answer'; question: string; rows: readonly string[]; at: number }

export interface View {
  head: string
  rule: string
  body: string
  nums: string
  mic: string
}

const CHOICES = ['space', 'note', 'voice', 'settings', 'today'] as const
type Choice = (typeof CHOICES)[number]

type Listed = 'sidebar' | 'modal' | 'spaces' | 'tree' | 'settings' | 'today'

export type Gesture = 'tap' | 'double' | 'hold' | 'up' | 'down'

export type Wish = 'none' | 'leave' | 'draw'

const RESET = 'reset:action'

const CURSOR = '▶ '
const NOWHERE = '  '
const OPEN = '▼ '
const SHUT = '▶ '
const STEP = '  '

const SHOWN = BODY_ROWS

function windowOf(at: number, count: number): number {
  if (count <= SHOWN) return 0
  return Math.min(Math.max(0, at - Math.floor(SHOWN / 2)), count - SHOWN)
}

function clamp(at: number, count: number): number {
  return Math.min(Math.max(0, at), Math.max(0, count - 1))
}

function nextPick(rows: readonly Row[], at: number, by: number): number {
  for (let to = at + by; to >= 0 && to < rows.length; to += by) {
    if (rows[to]?.pick) return to
  }

  return at
}

function optionRows(options: readonly Option[]): Row[] {
  return options.map((one) => ({
    label: one.label,
    depth: 0,
    folder: false,
    open: false,
    pick: true,
    id: one.value,
  }))
}

function firstPick(rows: readonly Row[]): number {
  const at = rows.findIndex((row) => row.pick)
  return at < 0 ? 0 : at
}

function startAt(rows: readonly Row[], id: string): number {
  const at = rows.findIndex((row) => row.pick && row.id === id)
  return at < 0 ? firstPick(rows) : at
}

export class Shell {
  private stack: Screen[] = [{ kind: 'note' }]
  private flashed = ''

  constructor(
    private readonly world: World,
    private readonly saying: () => Words,
    private readonly session: Session,
    private readonly settings: Settings,
  ) {}

  private get words(): Words {
    return this.saying()
  }

  get screen(): Screen {
    return this.stack.at(-1) ?? { kind: 'note' }
  }

  get open(): boolean {
    return this.stack.length > 1
  }

  get answerRows(): number {
    const screen = this.screen
    return screen.kind === 'answer' ? screen.rows.length : 0
  }

  handle(gesture: Gesture): Wish {
    switch (gesture) {
      case 'hold':
        return this.show('modal')

      case 'double':
        return this.back()

      case 'tap':
        return this.choose()

      case 'up':
        return this.move(-1)

      case 'down':
        return this.move(1)
    }
  }

  back(): Wish {
    if (this.stack.length > 1) {
      this.stack.pop()
      return 'draw'
    }

    return 'leave'
  }

  show(kind: Listed): Wish {
    if (kind === 'today') this.world.freshToday()
    this.stack = [{ kind: 'note' }, { kind, at: this.opensAt(kind) }]
    return 'draw'
  }

  private opensAt(kind: Listed): number {
    const rows = this.rowsFor(kind)
    switch (kind) {
      case 'spaces':
        return startAt(rows, this.world.atSpace())
      case 'sidebar':
      case 'tree':
        return startAt(rows, this.world.atNote())
      case 'modal':
      case 'settings':
      case 'today':
        return firstPick(rows)
    }
  }

  private rowsFor(kind: Listed): Row[] {
    switch (kind) {
      case 'sidebar':
        return this.world.contents()
      case 'spaces':
        return this.world.spaces()
      case 'tree':
        return this.world.tree()
      case 'modal':
        return this.choices()
      case 'settings':
        return this.settingRows()
      case 'today':
        return this.world.today()
    }
  }

  private settingRows(): Row[] {
    const rows: Row[] = this.settings.rows().map((one) => ({
      label: one.value ? spread(one.label, one.value, BODY_INNER - width(CURSOR)) : one.label,
      depth: 0,
      folder: false,
      open: false,
      pick: true,
      id: one.id,
    }))

    rows.push({
      label: this.words.reset,
      depth: 0,
      folder: false,
      open: false,
      pick: true,
      id: RESET,
    })

    return rows
  }

  close(): Wish {
    this.stack = [{ kind: 'note' }]
    return 'draw'
  }

  asking(question: string): Wish {
    this.stack = [{ kind: 'note' }, { kind: 'asking', question }]
    return 'draw'
  }

  answered(question: string, answer: string): Wish {
    const rows = answer.split(/\n\s*\n/u).flatMap((part, at) => {
      const flowed = part.replace(/\s*\n\s*/gu, ' ').trim()
      const wrapped = flowed === '' ? [] : [...wrap(flowed, BODY_INNER)]
      return at === 0 ? wrapped : ['', ...wrapped]
    })
    const said = rows.some((row) => row !== '') ? rows : [this.words.noAnswer]

    this.stack = [{ kind: 'note' }, { kind: 'answer', question, rows: said, at: 0 }]
    return 'draw'
  }

  flash(said: string): void {
    this.flashed = said
  }

  clearFlash(): void {
    this.flashed = ''
  }

  turn(by: number): Wish {
    this.session.turn(by)
    return 'draw'
  }

  goToPage(page: number): Wish {
    this.session.goTo(page - 1)
    return 'draw'
  }

  goToLine(line: number): Wish {
    const pages = this.session.pages
    if (!pages.length) return 'none'

    this.session.goTo(pageOfLine(pages, line))
    return 'draw'
  }

  private move(by: number): Wish {
    const screen = this.screen
    switch (screen.kind) {
      case 'note':
        return this.turn(by)

      case 'sidebar':
        return this.step(screen, this.world.contents(), by)

      case 'spaces':
        return this.step(screen, this.world.spaces(), by)

      case 'tree':
        return this.step(screen, this.world.tree(), by)

      case 'modal':
        return this.step(screen, this.choices(), by)

      case 'settings':
        return this.step(screen, this.settingRows(), by)

      case 'today':
        return this.step(screen, this.world.today(), by)

      case 'choice':
        return this.step(screen, optionRows(screen.rows), by)

      case 'answer': {
        const most = Math.max(0, screen.rows.length - SHOWN)
        const at = Math.min(Math.max(0, screen.at + by), most)
        if (at === screen.at) return 'none'

        screen.at = at
        return 'draw'
      }

      case 'asking':
        return 'none'
    }
  }

  private step(screen: { at: number }, rows: readonly Row[], by: number): Wish {
    const at = nextPick(rows, clamp(screen.at, rows.length), by)
    if (at === screen.at) return 'none'

    screen.at = at
    return 'draw'
  }

  private choose(): Wish {
    const screen = this.screen
    switch (screen.kind) {
      case 'note':
        return this.show('sidebar')

      case 'sidebar': {
        const row = this.world.contents()[screen.at]
        if (!row?.pick) return 'none'

        this.world.open(row.id)
        return this.close()
      }

      case 'spaces': {
        const row = this.world.spaces()[screen.at]
        if (!row) return 'none'

        this.world.enter(row.id)
        this.stack = [{ kind: 'note' }, { kind: 'tree', at: this.opensAt('tree') }]
        return 'draw'
      }

      case 'tree': {
        const row = this.world.tree()[screen.at]
        if (!row) return 'none'

        if (row.folder) {
          this.world.fold(row.id)
          return 'draw'
        }

        this.world.open(row.id)
        return this.close()
      }

      case 'modal':
        return this.take(CHOICES[clamp(screen.at, CHOICES.length)] ?? 'space')

      case 'settings': {
        const row = this.settingRows()[screen.at]
        if (!row) return 'none'

        if (row.id === RESET) {
          this.settings.reset()
          this.flash(this.words.done)
          return 'draw'
        }

        const options = this.settings.tap(row.id)
        if (!options) return 'draw'

        const label = this.settings.rows().find((one) => one.id === row.id)
        const at = options.findIndex((one) => one.label === label?.value)
        this.stack.push({
          kind: 'choice',
          id: row.id,
          title: label?.label ?? '',
          rows: options,
          at: at < 0 ? 0 : at,
        })
        return 'draw'
      }

      case 'today': {
        const row = this.world.today()[screen.at]
        if (!row?.pick) return 'none'

        this.world.tick(row.id)
        return 'draw'
      }

      case 'choice': {
        const option = screen.rows[clamp(screen.at, screen.rows.length)]
        if (!option) return 'none'

        this.settings.pick(screen.id, option.value)
        this.stack.pop()
        return 'draw'
      }

      case 'answer':
      case 'asking':
        return 'none'
    }
  }

  private take(choice: Choice): Wish {
    switch (choice) {
      case 'space':
        this.stack.push({ kind: 'spaces', at: this.opensAt('spaces') })
        return 'draw'

      case 'note':
        this.stack.push({ kind: 'tree', at: this.opensAt('tree') })
        return 'draw'

      case 'settings':
        this.stack.push({ kind: 'settings', at: this.opensAt('settings') })
        return 'draw'

      case 'today':
        this.world.freshToday()
        this.stack.push({ kind: 'today', at: this.opensAt('today') })
        return 'draw'

      case 'voice': {
        this.world.listen(!this.world.listening())
        return this.close()
      }
    }
  }

  view(): View {
    const mic = this.world.listening() ? '●' : ' '
    const screen = this.screen

    switch (screen.kind) {
      case 'note':
        return { ...this.note(), mic }

      case 'sidebar':
        return { ...this.list(this.world.space(), this.world.contents(), screen.at), mic }

      case 'spaces':
        return { ...this.list(this.words.spaces, this.world.spaces(), screen.at), mic }

      case 'tree':
        return { ...this.list(this.words.notes, this.world.tree(), screen.at), mic }

      case 'modal':
        return { ...this.modal(screen.at), mic }

      case 'settings':
        return { ...this.list(this.words.settings, this.settingRows(), screen.at), mic }

      case 'today':
        return { ...this.list(this.words.today, this.world.today(), screen.at), mic }

      case 'choice':
        return { ...this.list(screen.title, optionRows(screen.rows), screen.at), mic }

      case 'asking':
        return {
          head: this.top(screen.question, ''),
          rule: ruleOf('─', BODY_INNER),
          body: this.words.thinking,
          nums: '',
          mic,
        }

      case 'answer': {
        const from = Math.min(screen.at, Math.max(0, screen.rows.length - SHOWN))
        const shown = screen.rows.slice(from, from + SHOWN)
        const more = screen.rows.length > SHOWN
        return {
          head: this.top(
            screen.question,
            more ? `${String(from + shown.length)}/${String(screen.rows.length)}` : '',
          ),
          rule: ruleOf('─', BODY_INNER),
          body: shown.join('\n'),
          nums: '',
          mic,
        }
      }
    }
  }

  private note(): View {
    const page = this.session.page
    const showing = this.session.showing
    if (!page || !showing) {
      return { head: fit(this.flashed, HEAD_INNER), rule: '', body: '', nums: '', mic: '' }
    }

    const where = page.section === '' ? showing.name : page.section
    return {
      head: this.top(this.flashed || where, this.place(showing)),
      rule: ruleOf(page.rule, BODY_INNER),
      body: this.session.words,
      nums: this.session.numbers,
      mic: '',
    }
  }

  private place(showing: { page: number; count: number }): string {
    return `${String(showing.page + 1)}/${String(showing.count)}`
  }

  private top(said: string, where: string): string {
    if (!where) return fit(said, HEAD_INNER)
    return spread(said, where, HEAD_INNER)
  }

  private list(title: string, rows: readonly Row[], at: number): View {
    const from = windowOf(at, rows.length)
    const shown = rows.slice(from, from + SHOWN)
    const body = shown.map((row, index) => {
      const mark = from + index === at ? CURSOR : NOWHERE
      const lead = row.folder ? (row.open ? OPEN : SHUT) : ''
      return fit(`${mark}${STEP.repeat(row.depth)}${lead}${row.label}`, BODY_INNER)
    })

    return {
      head: this.top(title, rows.length ? `${String(at + 1)}/${String(rows.length)}` : ''),
      rule: ruleOf('─', BODY_INNER),
      body: (rows.length ? body : [this.words.nothingHere]).join('\n'),
      nums: '',
      mic: '',
    }
  }

  private modal(at: number): View {
    return this.list(this.world.space(), this.choices(), at)
  }

  private choices(): Row[] {
    const said: Record<Choice, string> = {
      space: this.words.switchSpace,
      note: this.words.changeNote,
      voice: this.world.listening() ? this.words.voiceOff : this.words.voiceOn,
      settings: this.words.settings,
      today: this.words.today,
    }

    return CHOICES.map((choice) => ({
      label: said[choice],
      depth: 0,
      folder: false,
      open: false,
      pick: true,
      id: choice,
    }))
  }
}
