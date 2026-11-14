import { blank } from '@orden/pass/envelope'
import { DEFAULT_RANDOM, randomPassword } from '@orden/pass/generate'
import type { LoginItem } from '@orden/pass/monitor'
import { isLoginItem } from '@orden/pass/monitor'
import { code, totpIn } from '@orden/pass/totp'
import type { Content, Item, Login } from '@orden/pass/types'
import { hostOf, isSecurePage, normalizeUrl, rank, siteOf } from '@orden/pass/urls'
import type {
  FillTarget,
  FormKind,
  PassForm,
  PassForms,
  PassFrame,
  PassMark,
  PassSubmitted,
} from './channel'
import { fill, onForms, onMark, onSubmitted } from './channel'
import type { FillChoice } from './fill-bubble'
import { passBubbles } from './fill-bubbles.svelte'
import {
  aliasValues,
  cardValues,
  generatedValues,
  identityValues,
  loginValues,
} from './fill-values'
import { subtitleOf } from './list'
import { newAlias } from './new-alias'
import type { Pause, Paused } from './settings'
import { PAUSES } from './settings'
import { savingOf } from './saving'
import type { Flow, Step } from './sign-in-flow'
import { FLOW_WINDOW, flowGoes, isSignInKind, pageOf } from './sign-in-flow'
import type { PassStore } from './store.svelte'
import { pass } from './store.svelte'
import { passOn } from '../../settings.svelte'

const STEP_PAUSE = 700
const SIGNING_SHOWN = 4000
const TYPED_KEPT = FLOW_WINDOW

const LOGIN_FORMS: ReadonlySet<FormKind> = new Set([
  'login',
  'username',
  'password',
  'totp',
  'signup',
  'change',
])

interface Held {
  frame: PassFrame
  forms: PassForm[]
}

interface Offer {
  frame: PassFrame
  form: PassForm
}

interface PendingSave {
  origin: string
  username: string | null
  password: string
  update: string | null
}

interface Typed {
  origin: string
  username: string
  at: number
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

function placed(frame: PassFrame): boolean {
  return frame.secure && isSecurePage(frame.origin) && originOf(frame.url) === frame.origin
}

function namesOrigin(item: LoginItem, origin: string): boolean {
  return item.content.websites.some(
    (website) => website.match !== 'never' && originOf(normalizeUrl(website.url) ?? '') === origin,
  )
}

const HOST_RANK = 2

function namesHost(item: LoginItem, url: string): boolean {
  return item.content.websites.some((website) => rank(website, url) >= HOST_RANK)
}

function choiceOf(item: Item): FillChoice {
  return { id: item.id, title: item.content.title, subtitle: subtitleOf(item) }
}

function shownName(login: Login): string {
  return login.username || login.email || login.title
}

function targetOf(frame: PassFrame, form: PassForm): FillTarget {
  return { tab: frame.tab, frame: frame.frame, origin: frame.origin, form: form.form }
}

function titleOf(origin: string): string {
  return (hostOf(origin) ?? origin).replace(/^www\./, '')
}

const NOTHING_PAUSED = Object.fromEntries(PAUSES.map((one) => [one, false])) as Paused

export class Autofill {
  private readonly frames = new Map<string, Map<string, Held>>()
  private readonly offers = new Map<string, Offer>()
  private readonly saves = new Map<string, PendingSave>()
  private readonly flows = new Map<string, Flow>()
  private readonly typed = new Map<string, Typed>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private listening: Promise<void> | null = null
  private opened: Promise<void> | null = null
  private readonly store: PassStore
  private readonly now: () => number
  private readonly pause: number

  constructor(store: PassStore, now: () => number = Date.now, pause = STEP_PAUSE) {
    this.store = store
    this.now = now
    this.pause = pause
  }

  start(): Promise<void> {
    this.listening ??= this.listen()
    return this.listening
  }

  async choose(tab: string, id: string): Promise<void> {
    const offer = this.offers.get(tab)
    this.offers.delete(tab)
    passBubbles.clear(tab, 'choose')
    const item = this.store.items.find((one) => one.id === id)
    if (!offer || item?.trashed !== null) return
    if (isLoginItem(item) && !this.loginsFor(offer.frame).some((one) => one.id === id)) return
    const values = await this.valuesOf(offer.form, item.content, offer.frame.origin)
    if (Object.keys(values).length === 0) return
    if (!(await fill(targetOf(offer.frame, offer.form), values, false))) return
    await this.store.used(id)
    if (isLoginItem(item) && this.store.settings.copyTotpAfterFill) {
      const now = await this.totpOf(item.content)
      if (now !== null) await this.store.copy(now)
    }
  }

  async generate(tab: string): Promise<void> {
    const offer = this.offers.get(tab)
    this.offers.delete(tab)
    passBubbles.clear(tab, 'choose')
    if (!offer) return
    const values = generatedValues(offer.form, randomPassword(DEFAULT_RANDOM))
    if (Object.keys(values).length === 0) return
    await fill(targetOf(offer.frame, offer.form), values, false)
  }

  async alias(tab: string): Promise<void> {
    const offer = this.offers.get(tab)
    this.offers.delete(tab)
    passBubbles.clear(tab, 'choose')
    if (!offer) return
    const made = await newAlias(undefined, hostOf(offer.frame.origin) ?? undefined)
    if (made?.content.kind !== 'alias') return
    const values = aliasValues(offer.form, made.content.address)
    if (Object.keys(values).length === 0) return
    await fill(targetOf(offer.frame, offer.form), values, false)
  }

  reoffer(tab: string): void {
    const offer = this.offers.get(tab)
    if (!offer || this.store.state !== 'open') return
    this.offer(offer.frame, offer.form)
  }

  async save(tab: string): Promise<void> {
    const pending = this.saves.get(tab)
    this.saves.delete(tab)
    passBubbles.clear(tab, 'save')
    if (!pending || this.store.state !== 'open') return
    if (pending.update !== null) {
      const item = this.store.items.find((one) => one.id === pending.update)
      if (!item || !isLoginItem(item)) return
      await this.store.update(item.id, { ...item.content, password: pending.password })
      return
    }
    const vault = this.vaultForSaving()
    if (vault === null) return
    const username = pending.username ?? ''
    const asUsername = this.store.settings.showUsernameField && !username.includes('@')
    const content: Login = {
      ...blank('login'),
      title: titleOf(pending.origin),
      email: asUsername ? '' : username,
      username: asUsername ? username : '',
      password: pending.password,
      websites: [{ url: normalizeUrl(pending.origin) ?? pending.origin, match: 'domain' }],
    }
    await this.store.create(vault, content)
  }

  never(tab: string): void {
    const pending = this.saves.get(tab)
    this.saves.delete(tab)
    passBubbles.clear(tab, 'save')
    const host = pending ? hostOf(pending.origin) : null
    if (host === null) return
    const paused = this.store.settings.paused
    this.store.setSetting('paused', {
      ...paused,
      [host]: { ...(paused[host] ?? NOTHING_PAUSED), save: true },
    })
  }

  stop(tab: string): void {
    this.ended(tab, this.flows.get(tab))
  }

  dismiss(tab: string): void {
    const shown = passBubbles.of(tab)
    if (shown?.kind === 'signing') {
      this.stop(tab)
      return
    }
    this.offers.delete(tab)
    this.saves.delete(tab)
    passBubbles.clear(tab)
  }

  quiet(): void {
    const tabs = [
      ...this.frames.keys(),
      ...this.offers.keys(),
      ...this.saves.keys(),
      ...this.flows.keys(),
      ...this.timers.keys(),
    ]
    for (const tab of new Set(tabs)) this.forget(tab)
  }

  forget(tab: string): void {
    this.stop(tab)
    this.frames.delete(tab)
    this.offers.delete(tab)
    this.saves.delete(tab)
    this.flows.delete(tab)
    this.typed.delete(tab)
    passBubbles.clear(tab)
  }

  async heardForms(said: PassForms): Promise<void> {
    if (!placed(said)) return
    const held = this.frames.get(said.tab) ?? new Map<string, Held>()
    this.frames.set(said.tab, held)
    if (said.forms.length === 0) held.delete(said.frame)
    else held.set(said.frame, { frame: said, forms: said.forms })
    await this.signIn(said)
  }

  async heardMark(said: PassMark): Promise<void> {
    if (!placed(said)) return
    const form = this.frames
      .get(said.tab)
      ?.get(said.frame)
      ?.forms.find((one) => one.form === said.form)
    if (!form || !this.fillsOn(said.origin, form.kind)) return
    await this.ready()
    this.offers.set(said.tab, { frame: said, form })
    if (this.store.state !== 'open') {
      passBubbles.show({ kind: 'unlock', tab: said.tab })
      return
    }
    this.offer(said, form)
  }

  async heardSubmitted(said: PassSubmitted): Promise<void> {
    if (!placed(said)) return
    const now = this.now()
    if (said.username) {
      this.typed.set(said.tab, { origin: said.origin, username: said.username, at: now })
    }
    const password = said.newPassword ?? said.password
    if (!password) return
    await this.ready()
    const settings = this.store.settings
    if (this.store.state !== 'open' || !settings.autosave || this.paused(said.origin, 'save'))
      return
    const username = said.username ?? this.typedOn(said.tab, said.origin, now)
    const old = said.newPassword === null ? null : said.password
    const saving = savingOf(this.loginsFor(said), username, password, old)
    if (saving.do === 'none') return
    const update = saving.do === 'update' ? saving.id : null
    this.saves.set(said.tab, { origin: said.origin, username, password, update })
    passBubbles.show({
      kind: 'save',
      tab: said.tab,
      site: titleOf(said.origin),
      username,
      update: update !== null,
    })
  }

  private async listen(): Promise<void> {
    await Promise.all([
      onForms((said) => {
        if (passOn()) void this.heardForms(said)
      }),
      onMark((said) => {
        if (passOn()) void this.heardMark(said)
      }),
      onSubmitted((said) => {
        if (passOn()) void this.heardSubmitted(said)
      }),
    ])
  }

  private ready(): Promise<void> {
    if (this.store.state !== 'loading') return Promise.resolve()
    this.opened ??= this.store.start()
    return this.opened
  }

  private paused(origin: string, pause: Pause): boolean {
    const all = this.store.settings.paused
    const host = hostOf(origin)
    const site = siteOf(origin)
    const found = (host === null ? undefined : all[host]) ?? (site === null ? undefined : all[site])
    return found?.[pause] === true
  }

  private fillsOn(origin: string, kind: FormKind): boolean {
    const settings = this.store.settings
    if (!settings.autofill || this.paused(origin, 'autofill')) return false
    return kind !== 'totp' || (settings.autofillTotp && !this.paused(origin, 'totp'))
  }

  private typedOn(tab: string, origin: string, now: number): string | null {
    const typed = this.typed.get(tab)
    if (!typed || now - typed.at > TYPED_KEPT || siteOf(typed.origin) !== siteOf(origin)) {
      return null
    }
    return typed.username
  }

  private loginsFor(frame: PassFrame): LoginItem[] {
    const found = this.store.matching(frame.url).filter(isLoginItem)
    return frame.top ? found : found.filter((one) => namesOrigin(one, frame.origin))
  }

  private active(kind: 'card' | 'identity'): Item[] {
    return this.store.items.filter((one) => one.trashed === null && one.content.kind === kind)
  }

  private offer(frame: PassFrame, form: PassForm): void {
    const kind = form.kind
    const logins = LOGIN_FORMS.has(kind)
      ? this.loginsFor(frame).filter((one) => kind !== 'totp' || one.content.totp !== '')
      : []
    const settings = this.store.settings
    const suggests = settings.suggest && !this.paused(frame.origin, 'suggest')
    this.offers.set(frame.tab, { frame, form })
    passBubbles.show({
      kind: 'choose',
      tab: frame.tab,
      site: titleOf(frame.origin),
      formKind: kind,
      logins: logins.map(choiceOf),
      cards: kind === 'card' ? this.active('card').map(choiceOf) : [],
      identities: kind === 'identity' ? this.active('identity').map(choiceOf) : [],
      generate: suggests && (kind === 'signup' || kind === 'change'),
      alias: suggests && kind === 'signup',
      fields:
        kind === 'card' || kind === 'identity'
          ? form.fields
              .filter((one) => one.visible && one.role !== 'unknown')
              .map((one) => one.role)
          : [],
    })
  }

  private vaultForSaving(): string | null {
    const writable = this.store.vaults.filter((one) => one.role !== 'viewer')
    const chosen = this.store.settings.defaultVault
    return (writable.find((one) => one.id === chosen) ?? writable[0])?.id ?? null
  }

  private async totpOf(login: Login): Promise<string | null> {
    const totp = login.totp === '' ? null : totpIn(login.totp)
    return totp ? (await code(totp, this.now())).code : null
  }

  private async valuesOf(
    form: PassForm,
    content: Content,
    origin: string,
  ): Promise<Record<string, string>> {
    switch (content.kind) {
      case 'login': {
        const wantsCode =
          form.fields.some((one) => one.role === 'totp') && this.fillsOn(origin, 'totp')
        const now = wantsCode ? await this.totpOf(content) : null
        return loginValues(form, { login: content, code: now, fresh: null })
      }
      case 'card':
        return cardValues(form, content)
      case 'identity':
        return identityValues(form, content)
      case 'alias':
      case 'note':
      case 'custom':
      case 'ssh':
      case 'wifi':
        return {}
    }
  }

  private schedule(tab: string, after: number, then: () => void): void {
    this.unschedule(tab)
    this.timers.set(
      tab,
      setTimeout(() => {
        this.timers.delete(tab)
        then()
      }, after),
    )
  }

  private unschedule(tab: string): void {
    const timer = this.timers.get(tab)
    if (timer !== undefined) clearTimeout(timer)
    this.timers.delete(tab)
  }

  private signInForm(frame: PassForms): PassForm | null {
    return (
      frame.forms.find(
        (one) => isSignInKind(one.kind) && one.fields.some((field) => field.visible),
      ) ?? null
    )
  }

  private ended(tab: string, flow: Flow | undefined): void {
    if (flow) this.flows.set(tab, { ...flow, ended: true })
    this.unschedule(tab)
    passBubbles.clear(tab, 'signing')
  }

  private async signIn(frame: PassForms): Promise<void> {
    const form = this.signInForm(frame)
    if (!form || !isSignInKind(form.kind)) return
    await this.ready()
    const settings = this.store.settings
    if (this.store.state !== 'open' || !settings.autoLogin) return
    if (this.paused(frame.origin, 'autoLogin') || !this.fillsOn(frame.origin, form.kind)) return
    const tab = frame.tab
    const logins = this.loginsFor(frame)
    const known = this.flows.get(tab) ?? null
    const flow = known && logins.some((one) => one.id === known.item) ? known : null
    const step: Step = { page: pageOf(frame.url), kind: form.kind }
    const now = this.now()
    const go = flowGoes(flow, step, now)
    if (go === 'none') return
    if (go === 'stop') {
      if (flow) this.ended(tab, flow)
      return
    }
    const usable = (
      go === 'continue' && flow ? logins.filter((one) => one.id === flow.item) : logins
    ).filter((one) => form.kind !== 'totp' || one.content.totp !== '')
    const only = usable.length === 1 ? usable[0] : undefined
    if (usable.length > 1 || (only && !namesHost(only, frame.url))) {
      if (passBubbles.of(tab) === null) this.offer(frame, form)
      return
    }
    const login = only
    if (!login) {
      if (flow && go === 'continue') this.ended(tab, flow)
      return
    }
    const next: Flow =
      go === 'continue' && flow
        ? { ...flow, steps: [...flow.steps, step] }
        : { item: login.id, started: now, steps: [step], ended: false }
    this.flows.set(tab, next)
    passBubbles.show({ kind: 'signing', tab, name: shownName(login.content) })
    this.schedule(tab, this.pause, () => void this.stepTaken(next, frame, form))
  }

  private async stepTaken(flow: Flow, frame: PassFrame, form: PassForm): Promise<void> {
    const tab = frame.tab
    if (this.flows.get(tab) !== flow) return
    const item = this.store.items.find((one) => one.id === flow.item)
    if (!item || !isLoginItem(item) || this.now() - flow.started > FLOW_WINDOW) {
      this.ended(tab, flow)
      return
    }
    const values = await this.valuesOf(form, item.content, frame.origin)
    const sent = Object.keys(values).length > 0 && (await fill(targetOf(frame, form), values, true))
    if (!sent) {
      this.ended(tab, flow)
      return
    }
    void this.store.used(item.id)
    this.schedule(tab, SIGNING_SHOWN, () => passBubbles.clear(tab, 'signing'))
  }
}

export const autofill = new Autofill(pass)
