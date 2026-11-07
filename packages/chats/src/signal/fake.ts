import type { Stream } from '../provider'

type Params = Record<string, unknown>

export interface Call {
  method: string
  params: Params
}

export interface FakeContact {
  uuid: string
  number?: string
  name?: string
}

export interface FakeGroup {
  id: string
  name: string
  description?: string
  members: { uuid: string; number?: string; isAdmin?: boolean }[]
  permissionSendMessage?: string
}

const ENCODER = new TextEncoder()

export class FakeSignalCli {
  readonly calls: Call[] = []
  readonly lines: string[] = []
  accounts: { number: string | null; aci: string }[] = []
  contacts: FakeContact[] = []
  groups: FakeGroup[] = []
  files = new Map<string, Uint8Array>()
  stickers: { packId: string; title: string; stickers: { id: number; emoji: string }[] }[] = []
  linking: { number: string; aci: string } | null = null
  refuse = new Map<string, string>()
  started = 0
  chunk = 0
  private clock = 1_700_000_000_000
  private subscriptions = new Map<number, string>()
  private nextSubscription = 0
  private hear: ((bytes: Uint8Array) => void) | null = null
  private end: ((reason?: string) => void) | null = null
  private pending = ''
  private early: Uint8Array[] = []
  private stopped: string | null = null
  private scanned: (() => void) | null = null

  program(): Stream {
    this.started += 1
    this.stopped = null
    this.subscriptions.clear()
    return {
      write: (bytes) => {
        if (this.stopped !== null) return Promise.reject(new Error('signal-cli has stopped'))
        this.pending += new TextDecoder().decode(bytes)
        let at = this.pending.indexOf('\n')
        while (at !== -1) {
          const line = this.pending.slice(0, at)
          this.pending = this.pending.slice(at + 1)
          this.lines.push(line)
          void this.request(line)
          at = this.pending.indexOf('\n')
        }
        return Promise.resolve()
      },
      read: (hear, end) => {
        this.hear = hear
        this.end = end
        for (const one of this.early.splice(0)) hear(one)
        return () => {
          this.hear = null
          this.end = null
        }
      },
      close: () => {
        this.stop('closed')
        return Promise.resolve()
      },
    }
  }

  stop(reason = 'signal-cli stopped'): void {
    if (this.stopped !== null) return
    this.stopped = reason
    this.end?.(reason)
  }

  scan(): void {
    this.scanned?.()
  }

  stamp(): number {
    this.clock += 1000
    return this.clock
  }

  private out(value: unknown): void {
    const bytes = ENCODER.encode(`${JSON.stringify(value)}\n`)
    const pieces: Uint8Array[] = []
    if (this.chunk > 0)
      for (let at = 0; at < bytes.length; at += this.chunk)
        pieces.push(bytes.subarray(at, at + this.chunk))
    else pieces.push(bytes)
    for (const piece of pieces) {
      if (this.hear) this.hear(piece)
      else this.early.push(piece)
    }
  }

  deliver(account: string, envelope: Record<string, unknown>): void {
    for (const [subscription, who] of this.subscriptions)
      if (who === account)
        this.out({
          jsonrpc: '2.0',
          method: 'receive',
          params: { subscription, result: { account, envelope } },
        })
  }

  private async request(line: string): Promise<void> {
    const asked = JSON.parse(line) as { id: string; method: string; params?: Params }
    const params = asked.params ?? {}
    this.calls.push({ method: asked.method, params })
    const refused = this.refuse.get(asked.method)
    if (refused) {
      this.out({ jsonrpc: '2.0', id: asked.id, error: { code: -1, message: refused } })
      return
    }
    try {
      const result = await this.answer(asked.method, params)
      this.out({ jsonrpc: '2.0', id: asked.id, result })
    } catch (error) {
      this.out({
        jsonrpc: '2.0',
        id: asked.id,
        error: { code: -1, message: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  private needsAccount(params: Params): string {
    const account = typeof params.account === 'string' ? params.account : ''
    if (!this.accounts.some((one) => one.number === account || one.aci === account))
      throw new Error('Specified account does not exist')
    return account
  }

  private sent(): unknown {
    return {
      timestamp: this.stamp(),
      results: [{ type: 'SUCCESS', recipientAddress: { uuid: 'x' } }],
    }
  }

  private async answer(method: string, params: Params): Promise<unknown> {
    switch (method) {
      case 'listAccounts':
        return this.accounts
      case 'startLink':
        return { deviceLinkUri: 'sgnl://linkdevice?uuid=fake&pub_key=fake' }
      case 'finishLink': {
        await new Promise<void>((done) => (this.scanned = done))
        const linked = this.linking
        if (!linked) throw new Error('Link request error: timeout')
        this.accounts.push(linked)
        return { number: linked.number, aci: linked.aci }
      }
    }
    const account = this.needsAccount(params)
    switch (method) {
      case 'subscribeReceive': {
        const id = this.nextSubscription++
        this.subscriptions.set(id, account)
        return id
      }
      case 'unsubscribeReceive':
        this.subscriptions.delete(Number(params.subscription))
        return null
      case 'listContacts':
        return this.contacts.map((one) => ({
          number: one.number ?? null,
          uuid: one.uuid,
          name: one.name ?? '',
          profile: { givenName: null },
        }))
      case 'listGroups': {
        const only = Array.isArray(params.groupId) ? params.groupId : null
        return this.groups
          .filter((one) => !only || only.includes(one.id))
          .map((one) => ({
            id: one.id,
            name: one.name,
            description: one.description ?? '',
            isMember: true,
            isBlocked: false,
            members: one.members.map((it) => ({
              number: it.number ?? null,
              uuid: it.uuid,
              isAdmin: it.isAdmin === true,
            })),
            permissionSendMessage: one.permissionSendMessage ?? 'EVERY_MEMBER',
          }))
      }
      case 'getAttachment':
      case 'getAvatar': {
        const key = String(params.id ?? params.groupId ?? params.contact ?? params.profile)
        const bytes = this.files.get(key)
        if (!bytes) throw new Error('Unable to find attachment')
        let plain = ''
        for (const one of bytes) plain += String.fromCharCode(one)
        return { data: btoa(plain) }
      }
      case 'getSticker':
        return { data: btoa(`sticker ${String(params.packId)} ${String(params.stickerId)}`) }
      case 'listStickerPacks':
        return this.stickers.map((one) => ({
          packId: one.packId,
          installed: true,
          title: one.title,
          stickers: one.stickers.map((it) => ({
            id: it.id,
            emoji: it.emoji,
            contentType: 'image/webp',
          })),
        }))
      case 'getUserStatus':
        return (Array.isArray(params.recipient) ? (params.recipient as unknown[]) : []).map(
          (number) => {
            const found = this.contacts.find((one) => one.number === number)
            return { recipient: number, number, uuid: found?.uuid ?? null, isRegistered: !!found }
          },
        )
      case 'updateGroup': {
        if (typeof params.groupId === 'string') return { timestamp: this.stamp() }
        const id = `group${this.groups.length + 1}=`
        this.groups.push({
          id,
          name: String(params.name),
          members: [
            { uuid: this.accounts[0]?.aci ?? '', isAdmin: true },
            ...(Array.isArray(params.member) ? params.member : []).map((uuid) => ({
              uuid: String(uuid),
            })),
          ],
        })
        return { groupId: id, timestamp: this.stamp() }
      }
      case 'send':
      case 'sendPollCreate':
      case 'remoteDelete':
      case 'sendAdminDelete':
      case 'sendReaction':
      case 'sendPinMessage':
      case 'sendUnpinMessage':
      case 'sendPollVote':
        return this.sent()
      case 'sendTyping':
      case 'sendReceipt':
      case 'sendSyncRequest':
      case 'quitGroup':
      case 'unregister':
        return {}
      case 'deleteLocalAccountData':
        this.accounts = this.accounts.filter((one) => one.number !== account && one.aci !== account)
        return {}
    }
    throw new Error(`Method not implemented: ${method}`)
  }
}
