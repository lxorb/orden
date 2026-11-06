export type Unit = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'

export interface Grammar {
  lang: string

  today: readonly string[]
  tomorrow: readonly string[]
  dayAfter: readonly (readonly string[])[]
  yesterday: readonly string[]

  weekdays: Readonly<Record<string, number>>
  shortDays: ReadonlySet<string>
  context: ReadonlySet<string>

  months: Readonly<Record<string, number>>

  next: ReadonlySet<string>
  coming: ReadonlySet<string>
  week: ReadonlySet<string>
  month: ReadonlySet<string>
  year: ReadonlySet<string>
  endOfMonth: readonly (readonly string[])[]
  weekend: readonly (readonly string[])[]

  within: ReadonlySet<string>
  units: Readonly<Record<string, Unit>>
  numbers: Readonly<Record<string, number>>

  dayWords: ReadonlySet<string>
  timeWords: ReadonlySet<string>
  meridiem: Readonly<Record<string, 'am' | 'pm'>>
  oclock: ReadonlySet<string>
  times: Readonly<Record<string, string>>
  dayTimes: readonly { words: readonly string[]; day: 'today' | 'tomorrow'; time: string }[]
  partsOfDay: Readonly<Record<string, string>>

  every: ReadonlySet<string>
  everyDone: ReadonlySet<string>
  other: ReadonlySet<string>
  last: ReadonlySet<string>
  rules: Readonly<Record<string, string>>
  starting: ReadonlySet<string>
  until: ReadonlySet<string>
  workdays: ReadonlySet<string>
  weekends: ReadonlySet<string>

  lasting: ReadonlySet<string>
  bareDuration: boolean

  ordinal: RegExp
  ordinals: Readonly<Record<string, number>>
  articles: ReadonlySet<string>
  monthFirst: boolean
}
