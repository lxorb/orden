import type { Said } from '../../automation/args'
import { said } from '../../automation/args'
import { READER } from '../../automation/caller'
import { articleOf } from '../../web-tab/note'
import type { StoreSaid } from '../verbs'
import { placeFor } from './spaces'
import { lendTab, readerTabs } from './tabs'

async function storeFor(args: Said): Promise<StoreSaid> {
  const place = placeFor({ verb: 'agent.store_for', args, caller: READER }, said(args, 'space'))
  const { webData } = await import('../../web-tab/web-data.svelte')

  return { space: place.space.name, store: await webData.store(null) }
}

async function markdown(args: Said): Promise<string> {
  const html = typeof args.html === 'string' ? args.html : ''
  if (!html.trim()) return ''

  const url = said(args, 'url') ?? ''
  const [read, { htmlToMarkdown }] = await Promise.all([
    articleOf({ url, title: '', html }),
    import('@orden/markdown/from-html'),
  ])
  return read.html.trim() ? htmlToMarkdown(read.html).trim() : ''
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
    case 'agent.working_folder': {
      if (__EVEN_PLUGIN__) return null
      const { workingPath } = await import('../../internal/work')
      const path = said(args, 'path')
      return path ? await workingPath(path) : null
    }
    default:
      throw new Error(`there is no verb called ${name}`)
  }
}
