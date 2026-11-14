import { pagesHanded } from '../web-tab/src/api'
import { busy } from '../ui-kit/src/api'
import { log, invoke, isDesktop, isNative, openExternal } from '../platform/src/api'
import { hearHere } from '../own-window'
import { callerOf } from './caller'
import { callbackKind, isFileUri, readUri, withOutcome } from './uri'
import { dispatch, isVerb, linkHearsFrom, verbForAction } from './verbs'

const QUERIES = ['orden', 'nib'] as const

const MOST_LINKS = 1

export async function startAutomation(): Promise<() => void> {
  if (!isNative) {
    const here = new URL(window.location.href)
    const query = QUERIES.find((one) => here.searchParams.has(one))
    const asked = query === undefined ? null : here.searchParams.get(query)
    if (query === undefined || asked === null) return () => undefined

    here.searchParams.delete(query)
    window.history.replaceState(null, '', `${here.pathname}${here.search}${here.hash}`)
    await follow(asked)

    return () => undefined
  }

  const stopping: (() => void)[] = []

  if (isDesktop) {
    const { hearPages } = await pagesHanded()
    stopping.push(await hearPages())
    const { hearPdfs } = await (await import('../pdf/src/api')).handed()
    stopping.push(await hearPdfs())
  }

  for (const uri of await invoke<string[]>('take_startup_uris').catch(() => [])) {
    await follow(uri)
  }

  stopping.push(
    await hearHere<string[]>('orden://open-url', (event) => {
      void followAll(event.payload)
    }),
  )

  if (isDesktop) {
    stopping.push(
      await hearHere<Request>('orden://automation', (event) => {
        const asked = event.payload
        if (typeof asked.id !== 'number') return

        void answer(asked.id, asked)
      }),
    )
    await invoke('automation_listening')
    for (const uri of await invoke<string[]>('take_startup_uris').catch(() => [])) {
      await follow(uri)
    }
  }

  return () => {
    for (const stop of stopping) stop()
  }
}

interface Request {
  id?: unknown
  verb?: unknown
  args?: unknown
  rest?: unknown
  agent?: unknown
  thread?: unknown
}

async function answer(id: number, asked: Request) {
  if ((await invoke('automation_claim', { id }).catch(() => false)) !== true) return

  const verb = typeof asked.verb === 'string' ? asked.verb : ''
  const args = isRecord(asked.args) ? asked.args : {}
  const rest = Array.isArray(asked.rest) ? asked.rest.filter(isText) : []

  const result = await dispatch(verb, args, rest, 'here', callerOf(asked.agent, asked.thread))
  await invoke('automation_result', { id, result }).catch(() => undefined)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown): value is string {
  return typeof value === 'string'
}

async function followAll(uris: readonly string[]) {
  for (const uri of uris) await follow(uri)
}

async function follow(uri: string, depth = 0): Promise<void> {
  if (isFileUri(uri)) return

  if (/^orden:\/\/chat\//i.test(uri.trim())) {
    const opening = __EVEN_PLUGIN__
      ? null
      : import('../chats-client/src/api').then((one) => one.chatOpening())
    await opening?.then(({ openChatLink }) => openChatLink(uri.trim()))
    return
  }

  const link = readUri(uri)
  if (!link) {
    refuse(uri, 'not a nib link')
    return
  }

  const verb = verbForAction(link.action)
  if (!verb) {
    const declined = isVerb(link.action)
    await went(declined ? link.callbacks.cancel : link.callbacks.error, depth, {
      error: declined ? 'not something a link may ask for' : `no action called ${link.action}`,
    })
    refuse(uri, declined ? 'declined' : 'unknown action')
    return
  }

  const result = await dispatch(verb, link.args, [], 'link')

  const heard = linkHearsFrom(verb)

  if (!result.ok) {
    if (heard) await went(link.callbacks.error, depth, { error: result.error })
    refuse(uri, result.error)
    return
  }

  if (heard) await went(link.callbacks.success, depth, plainly(result.value))
  else if (link.callbacks.success ?? link.callbacks.error) {
    log('warn', `automation: ${link.action} tells a link nothing back: ${uri}`)
  }
}

function plainly(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}

  const out: Record<string, string> = {}
  for (const [name, held] of Object.entries(value)) {
    if (typeof held === 'string' || typeof held === 'number' || typeof held === 'boolean') {
      out[name] = String(held)
    }
  }

  return out
}

async function went(url: string | null, depth: number, outcome: Record<string, string>) {
  const kind = callbackKind(url)
  if (url === null || kind === null) return

  if (kind === 'external') {
    await openExternal(withOutcome(url, outcome))
    return
  }

  if (depth >= MOST_LINKS) {
    log('warn', `automation: a chain of links went past ${MOST_LINKS} steps: ${url}`)
    return
  }

  await follow(url, depth + 1)
}

function refuse(uri: string, why: string) {
  log('warn', `automation: ${why}: ${uri}`)
  busy.failed('that link could not be followed')
}
