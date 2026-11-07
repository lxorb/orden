import type { FieldRole, FormKind } from './channel'

export interface FillChoice {
  id: string
  title: string
  subtitle: string
}

export type PassBubble =
  | {
      kind: 'choose'
      tab: string
      site: string
      formKind: FormKind
      logins: FillChoice[]
      cards: FillChoice[]
      identities: FillChoice[]
      generate: boolean
      alias: boolean
      fields: FieldRole[]
    }
  | { kind: 'unlock'; tab: string }
  | { kind: 'save'; tab: string; site: string; username: string | null; update: boolean }
  | { kind: 'signing'; tab: string; name: string }
