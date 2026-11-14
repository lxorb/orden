export const STOPPING_KINDS = ['terminal', 'thread'] as const

export type StoppingKind = (typeof STOPPING_KINDS)[number]

export interface RunningProgram {
  readonly name: string | null
  readonly program: string | null
  readonly host: string | null
  readonly colour: string | null
}

export interface Stopping {
  readonly window: string
  readonly kind: StoppingKind
  readonly id: string
  readonly name: string
  readonly busy: boolean
  readonly doc?: string
  readonly running?: RunningProgram | null
}

export interface StoppingPort {
  rows(window: string, idle: boolean): Promise<readonly Stopping[]>
  show(row: Stopping): Promise<void>
}

export type QuittingPorts = {
  readonly [Kind in StoppingKind as `quit.${Kind}`]: StoppingPort
}
