export type MachineState = 'asleep' | 'starting' | 'awake' | 'stopping'

export type Typing = 'owner' | 'writers'

export interface Term {
  v: 1
  machine: string
  session: string
  icon?: string
  iconColor?: string
}

export interface Disk {
  used: number
  total: number
}

export interface Activity {
  at: number
  output: number
  cpu: number
  net: number
  homeBytes: number
  disk?: Disk
}

export interface Watcher {
  who: string
  device: string
  active: boolean
  onScreen: boolean
}

export interface Allowance {
  awakeS: number
  cpuS: number
  homeBytes: number
  egressBytes: number
}

export type SleepReason = 'idle' | 'allowance' | 'budget' | 'off'

export type AwakeAnswer = { stay: true } | { stay: false; reason: SleepReason }

export interface Typed {
  who: string
  at: number
  cols: number
  rows: number
}

export type SpaceRole = 'read' | 'write' | 'owner'

export type HostKind = 'cloudflare' | 'hetzner'

export interface MachineHost {
  start(id: string, image: string, env: Record<string, string>): Promise<void>
  stop(id: string, grace: number): Promise<void>
  running(id: string): Promise<boolean>
  link(id: string): Promise<WebSocket>
  snapshot(id: string): Promise<string>
  backup(id: string, dir: string): Promise<string>
  restore(id: string, from: { snapshot?: string; backup?: string }): Promise<void>
  usage(id: string, since: number): Promise<{ cpuS: number; egressBytes: number }>
  readonly alwaysOn?: boolean
  reboot?(id: string): Promise<void>
  remove?(id: string): Promise<void>
}
