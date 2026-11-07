import { invoke, isDesktop } from '../tauri'

export type FormKind =
  'login' | 'username' | 'password' | 'totp' | 'signup' | 'change' | 'card' | 'identity'

export type FieldRole =
  | 'username'
  | 'email'
  | 'password'
  | 'new-password'
  | 'totp'
  | 'cc-name'
  | 'cc-number'
  | 'cc-exp'
  | 'cc-exp-month'
  | 'cc-exp-year'
  | 'cc-csc'
  | 'given-name'
  | 'additional-name'
  | 'family-name'
  | 'name'
  | 'tel'
  | 'street-address'
  | 'address-line2'
  | 'postal-code'
  | 'address-level2'
  | 'address-level1'
  | 'country'
  | 'organization'
  | 'bday'
  | 'unknown'

export interface PassFrame {
  tab: string
  frame: string
  origin: string
  url: string
  secure: boolean
  top: boolean
}

interface PassField {
  field: string
  role: FieldRole
  visible: boolean
}

export interface PassForm {
  form: string
  kind: FormKind
  fields: PassField[]
}

export interface PassForms extends PassFrame {
  forms: PassForm[]
}

export interface PassMark extends PassFrame {
  form: string
  field: string
}

export interface PassSubmitted extends PassFrame {
  form: string
  kind: FormKind
  username: string | null
  password: string | null
  newPassword: string | null
}

export interface FillTarget {
  tab: string
  frame: string
  origin: string
  form: string
}

type Unlisten = () => void

let ownWindow: Promise<typeof import('../own-window')> | undefined

async function heard(event: string, then: (said: unknown) => void): Promise<Unlisten> {
  if (!isDesktop) return () => undefined
  ownWindow ??= import('../own-window')
  const { hearHere } = await ownWindow
  return hearHere(event, (said) => then(said.payload))
}

export function onForms(then: (said: PassForms) => void): Promise<Unlisten> {
  return heard('orden://pass-forms', (said) => then(said as PassForms))
}

export function onMark(then: (said: PassMark) => void): Promise<Unlisten> {
  return heard('orden://pass-mark', (said) => then(said as PassMark))
}

export function onSubmitted(then: (said: PassSubmitted) => void): Promise<Unlisten> {
  return heard('orden://pass-submitted', (said) => then(said as PassSubmitted))
}

export function fill(
  target: FillTarget,
  values: Record<string, string>,
  submit: boolean,
): Promise<boolean> {
  return invoke<boolean>('web_pass_fill', { ...target, values, submit })
}
