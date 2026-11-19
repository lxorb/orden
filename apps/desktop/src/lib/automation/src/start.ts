import { portOf, startHearings } from '@orden/contracts'
import { busy } from '../../ui-kit/src/api'
import { log, invoke, isDesktop, isNative, openExternal, isRecord } from '../../platform/src/api'
import { hearHere } from '../../windows/src/api'
import { callerOf } from './caller'
import { dueWithin } from './due'
import { callbackKind, isFileUri, readUri, withOutcome } from './uri'
import { dispatch, isVerb, linkHearsFrom, verbForAction } from './verbs'

const QUERY = 'orden'
const MOST_LINKS = 1
export async function startAutomation(): Promise<() => void> {
  if (!isNative) {
    const here = new URL(window.location.href)
    const asked = here.searchParams.get(QUERY)
    if (asked === null) return () => undefined
    here.searchParams.delete(QUERY)
    window.history.replaceState(null, '', `${here.pathname}${here.search}${here.hash}`)
    await follow(asked)
    return () => undefined
  }
  const stopping: (() => void)[] = []
  const takeStartup = async () => {
    for (const uri of await invoke<string[]>('take_startup_uris').catch(() => [])) await follow(uri)
  }
  if (isDesktop) stopping.push(...(await startHearings()))
  await takeStartup()
  stopping.push(
    await hearHere<string[]>('orden://open-url', (event) => {
      void (async () => {
        for (const uri of event.payload) await follow(uri)
      })()
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
    await takeStartup()
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
  within_ms?: unknown
}
async function answer(id: number, asked: Request) {
  const due = dueWithin(asked.within_ms)
  try {
    if ((await invoke('automation_claim', { id }).catch(() => false)) !== true) return
    const verb = typeof asked.verb === 'string' ? asked.verb : ''
    const args = isRecord(asked.args) ? asked.args : {}
    const rest = Array.isArray(asked.rest) ? asked.rest.filter((one): one is string => typeof one === 'string') : []
    const caller = callerOf(asked.agent, asked.thread)
    const result = await Promise.race([dispatch(verb, args, rest, 'here', caller, due.deadline), due.late])
    await invoke('automation_result', { id, result }).catch(() => undefined)
  } finally {
    due.end()
  }
}
async function follow(uri: string, depth = 0): Promise<void> {
  if (isFileUri(uri)) return
  if (/^orden:\/\/chat\//i.test(uri.trim())) {
    const chats = portOf('chats')
    if (chats.ok) await chats.value.openLink(uri.trim())
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
  return Object.fromEntries(
    Object.entries(isRecord(value) ? value : {})
      .filter(([, held]) => ['string', 'number', 'boolean'].includes(typeof held))
      .map(([name, held]) => [name, String(held)]),
  )
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
