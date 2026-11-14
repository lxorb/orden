import type { SettingsSectionId } from './shell'

export interface SettingOption {
  value: string
  label: string
  note?: string
}

export interface SettingCommon {
  label: string
  hint: string
  words?: string[]
  key?: string
  member?: string
  check?: (value: string) => string | null
  shown?: () => boolean
}

export type SettingControl =
  | {
      kind: 'switch'
      initial?: boolean
      locked?: () => boolean
      get(): boolean
      set(on: boolean): void
    }
  | {
      kind: 'select'
      options: SettingOption[]
      open?: boolean
      initial?: string
      get(): string
      set(value: string): void
    }
  | {
      kind: 'text'
      placeholder: string
      live?: boolean
      font?: { mono: boolean }
      initial?: string
      get(): string
      set(value: string): void
    }

export type SettingField = SettingCommon & SettingControl

export interface SettingFields {
  readonly section: SettingsSectionId
  readonly group: string
  load(): Promise<() => readonly SettingField[]>
}

export interface SettingsPartView {
  show(target: unknown): () => void
}

export interface SettingsPart {
  readonly section: SettingsSectionId
  readonly title: string
  shown(): boolean
  load(): Promise<SettingsPartView>
}

export interface PaletteVisit {
  readonly url: string
  readonly title: string
  readonly visits: number
  readonly typed: number
  readonly last: number
}

export interface PaletteVisits {
  list(): readonly PaletteVisit[]
  forget(url: string): void
  opened(tab: string, typed: string, url: string): void
}

export interface PaletteHost {
  readonly id: string
  readonly name: string
  readonly also: readonly string[]
  readonly detail: string | null
  readonly group: string | null
  readonly colour: string | null
}

export interface PaletteDestination {
  readonly user: string | null
  readonly hostname: string
  readonly port: number | null
}

export interface PaletteHosts {
  list(): Promise<readonly PaletteHost[]>
  wanted(term: string): { readonly wanted: PaletteDestination; readonly said: string } | null
  open(id: string): void
  openAll(ids: readonly string[]): void
  connect(wanted: PaletteDestination): void
}

export interface PaletteMessage {
  readonly chat: string
  readonly id: string
  readonly path: string
  readonly line: string
  readonly where: readonly string[]
}

export interface PaletteOpenHow {
  activate?: boolean
  preview?: boolean
  beside?: boolean
}

export interface PaletteMessages {
  hits(words: string): Promise<{ readonly rows: readonly PaletteMessage[]; readonly only: boolean }>
  open(path: string, message: string, how: PaletteOpenHow): void
}

export interface PaletteKinds {
  readonly visits: PaletteVisits
  readonly hosts: PaletteHosts
  readonly messages: PaletteMessages
}

export type PaletteKindId = keyof PaletteKinds

export const NO_VISITS: PaletteVisits = {
  list: () => [],
  forget: () => undefined,
  opened: () => undefined,
}

export const NO_HOSTS: PaletteHosts = {
  list: () => Promise.resolve([]),
  wanted: () => null,
  open: () => undefined,
  openAll: () => undefined,
  connect: () => undefined,
}

export const NO_MESSAGES: PaletteMessages = {
  hits: () => Promise.resolve({ rows: [], only: false }),
  open: () => undefined,
}

const NONE: PaletteKinds = { visits: NO_VISITS, hosts: NO_HOSTS, messages: NO_MESSAGES }

const kindLoads = new Map<PaletteKindId, () => Promise<PaletteKinds[PaletteKindId]>>()
const kindsLoaded = new Map<PaletteKindId, PaletteKinds[PaletteKindId]>()
const fieldSets = new Set<SettingFields>()
const fieldsLoaded = new Map<SettingFields, () => readonly SettingField[]>()
const parts = new Set<SettingsPart>()

export function registerPaletteKind<Id extends PaletteKindId>(
  id: Id,
  load: () => Promise<PaletteKinds[Id]>,
): () => void {
  kindLoads.set(id, load)
  kindsLoaded.delete(id)
  return () => {
    if (kindLoads.get(id) !== load) return
    kindLoads.delete(id)
    kindsLoaded.delete(id)
  }
}

export function paletteKind<Id extends PaletteKindId>(id: Id): PaletteKinds[Id] {
  return (kindsLoaded.get(id) as PaletteKinds[Id] | undefined) ?? NONE[id]
}

export function registerSettingFields(fields: SettingFields): () => void {
  fieldSets.add(fields)
  return () => {
    fieldSets.delete(fields)
    fieldsLoaded.delete(fields)
  }
}

export function settingFieldsIn(section: SettingsSectionId, group: string): SettingField[] {
  return [...fieldSets]
    .filter((one) => one.section === section && one.group === group)
    .flatMap((one) => [...(fieldsLoaded.get(one)?.() ?? [])])
}

export function registerSettingsPart(part: SettingsPart): () => void {
  parts.add(part)
  return () => void parts.delete(part)
}

export function settingsPartsIn(section: SettingsSectionId): SettingsPart[] {
  return [...parts].filter((one) => one.section === section)
}

export async function registered(): Promise<void> {
  await Promise.all([
    ...[...kindLoads].map(async ([id, load]) => {
      if (kindsLoaded.has(id)) return
      const kind = await load().catch(() => null)
      if (kind && kindLoads.get(id) === load) kindsLoaded.set(id, kind)
    }),
    ...[...fieldSets].map(async (fields) => {
      if (fieldsLoaded.has(fields)) return
      const read = await fields.load().catch(() => null)
      if (read && fieldSets.has(fields)) fieldsLoaded.set(fields, read)
    }),
  ])
}
