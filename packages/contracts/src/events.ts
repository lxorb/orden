export const EVENT_PREFIX = 'orden://'

export type EventName = `${typeof EVENT_PREFIX}${string}`

export interface GlobalKeys {
  readonly reach: 'system' | 'portal' | 'none'
  readonly change: boolean
  readonly held: Readonly<Record<string, string>>
  readonly refused: readonly string[]
  readonly run: string
}

export interface EventMap {
  'orden://open-url': readonly string[]
  'orden://global-keys': GlobalKeys
  'orden://touchpad': { readonly fingers: number }
  'orden://automation': {
    readonly id?: unknown
    readonly verb?: unknown
    readonly args?: unknown
    readonly rest?: unknown
    readonly agent?: unknown
    readonly thread?: unknown
  }
  'orden://agent': unknown
  'orden://web-tab': unknown
  'orden://web-page': unknown
  'orden://crash-report': unknown
  'orden://reminder': null
  'orden://notice': unknown
  'orden://quit': null
  'orden://quit-ask': null
  'orden://update-settle': null
  'orden://extensions': null
  'orden://ai-accounts': null
  'orden://icloud': null
}

export type KnownEvent = keyof EventMap

export type EventPayload<Name extends KnownEvent> = EventMap[Name]

export type Unlisten = () => void

export interface EventBus {
  emit<Name extends KnownEvent>(name: Name, payload: EventPayload<Name>): void
  listen<Name extends KnownEvent>(
    name: Name,
    heard: (payload: EventPayload<Name>) => void,
  ): Promise<Unlisten>
}

export function isEventName(value: unknown): value is EventName {
  return (
    typeof value === 'string' &&
    value.startsWith(EVENT_PREFIX) &&
    value.length > EVENT_PREFIX.length
  )
}
