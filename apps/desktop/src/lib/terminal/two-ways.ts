import { key, t } from '../i18n.svelte'
import { prompt } from '../prompt.svelte'
import { shortcuts } from '../shortcuts.svelte'
import { BY_ID } from '../shortcuts/registry'
import { shells, type Way } from './shells.svelte'

export function bothName(command: string): string {
  return t('{key} in a terminal', { key: shortcuts.hint(command) ?? '' })
}

export async function whichWay(command: string): Promise<Way | null> {
  const answer = await prompt.chooseTicking({
    title: bothName(command),
    options: [
      { id: 'shell', label: key('Terminal') },
      { id: 'app', label: BY_ID.get(command)?.label() ?? command, primary: true },
    ],
    tick: t('Always ask'),
  })
  if (answer === null) return null

  const way: Way = answer.id === 'app' ? 'app' : 'shell'
  if (!answer.ticked) shells.setWay(command, way)
  return way
}
