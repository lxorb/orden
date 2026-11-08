export interface Avatar {
  s: string
  l: string
}

export interface Status {
  emoji: string
  text: string
  until: number | null
  quiet: boolean
}

export type Presence = 'active' | 'away' | 'offline'

export interface Face {
  name: string
  avatar?: Avatar | null
  key?: string
}
