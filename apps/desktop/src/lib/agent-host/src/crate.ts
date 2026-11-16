import { portOf, webPages } from '@orden/contracts'
import type { Said } from '../../automation/src/api'
import { said } from '../../automation/src/api'
import { READER } from '../../automation/src/api'
import type { StoreSaid } from '../../agent-protocol/src/api'
import { workingPath } from '../../web-backend/src/api'
import { placeFor } from '../../agent-verbs/src/api'
import { protection } from '../../protect/src/api'
import { lendTab, readerTabs } from './tabs'

async function storeFor(args: Said): Promise<StoreSaid> {
  const place = placeFor({ verb: 'agent.store_for', args, caller: READER }, said(args, 'space'))
  const lending = portOf('web.lending')
  return { space: place.space.name, store: lending.ok ? await lending.value.readerStore() : null }
}

async function markdown(args: Said): Promise<string> {
  const html = typeof args.html === 'string' ? args.html : ''
  if (!html.trim()) return ''

  const url = said(args, 'url') ?? ''
  const [read, { htmlToMarkdown }] = await Promise.all([
    webPages().articleOf({ url, title: '', html }),
    import('@orden/markdown/from-html'),
  ])
  return read.trim() ? htmlToMarkdown(read).trim() : ''
}

const words = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((one) => typeof one === 'string') ? value : null

async function programFree(args: Said): Promise<boolean> {
  const program = said(args, 'program')
  const given = words(args.args)
  const programs = words(args.programs)
  const cwd = said(args, 'cwd')
  const judge = portOf('terminal.judge')
  if (!program || !given || !programs || !cwd || !judge.ok) return false
  if (!protection.agentsMayWithin(cwd)) return false
  return judge.value.runsFree(program, given, programs).catch(() => false)
}

export async function answerTheCrate(name: string, args: Said): Promise<unknown> {
  switch (name) {
    case 'agent.reader_tabs':
      return readerTabs()
    case 'agent.lend':
      return lendTab(said(args, 'tab') ?? '')
    case 'agent.store_for':
      return storeFor(args)
    case 'agent.markdown':
      return markdown(args)
    case 'agent.may_hand': {
      const path = said(args, 'path')
      return path ? protection.agentsMay(path) : false
    }
    case 'agent.program_free':
      return programFree(args)
    case 'agent.working_folder': {
      if (__EVEN_PLUGIN__) return null
      const path = said(args, 'path')
      return path ? await workingPath(path) : null
    }
    default:
      throw new Error(`there is no verb called ${name}`)
  }
}
