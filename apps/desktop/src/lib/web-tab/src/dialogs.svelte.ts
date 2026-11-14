import { invoke, isDesktop, isRecord } from '../../platform/src/api'
import { plainOrigin } from '@orden/scan/web-address'

const KINDS = ['alert', 'confirm', 'prompt', 'leave'] as const

type Kind = (typeof KINDS)[number]

function isKind(value: string): value is Kind {
  return KINDS.some((one) => one === value)
}

export interface Dialog {
  id: number
  tab: string
  kind: Kind
  message: string
  text: string
  site: string
}

export function readDialog(value: unknown): Dialog | null {
  if (!isRecord(value)) return null

  const { tab, id, kind, message, text, origin } = value
  if (typeof tab !== 'string' || typeof id !== 'number') return null
  if (typeof kind !== 'string' || !isKind(kind)) return null
  if (typeof message !== 'string' || typeof text !== 'string' || typeof origin !== 'string') {
    return null
  }

  return { id, tab, kind, message, text, site: plainOrigin(origin) || origin }
}

class Dialogs {
  open = $state<Dialog[]>([])

  heard(one: Dialog) {
    this.open = [...this.open, one]
  }

  answer(one: Dialog, accept: boolean, text?: string) {
    this.open = this.open.filter((each) => each.id !== one.id)
    void this.tell(one.id, accept, one.kind === 'prompt' && accept ? (text ?? '') : null)
  }

  dropped(tab: string) {
    const gone = this.open.filter((one) => one.tab === tab)
    if (!gone.length) return

    this.open = this.open.filter((one) => one.tab !== tab)
    for (const one of gone) void this.tell(one.id, false, null)
  }

  refused(id: number) {
    void this.tell(id, false, null)
  }

  private async tell(id: number, accept: boolean, text: string | null): Promise<void> {
    if (!isDesktop) return
    await invoke('web_dialog_answer', { id, accept, text }).catch(() => undefined)
  }
}

export const dialogs = new Dialogs()
