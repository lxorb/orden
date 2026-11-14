import { prompt } from '../../ui-kit/src/api'
import { shortcuts } from '../../shortcuts.svelte'
import { BY_ID } from '../../shortcuts/registry'
import { shells, type Way } from './shells.svelte'

export function bothName(command: string): string {
  return `${shortcuts.hint(command) ?? ''} in a terminal`
}

export async function whichWay(command: string): Promise<Way | null> {
  const answer = await prompt.chooseTicking({
    title: bothName(command),
    options: [
      { id: 'shell', label: 'Terminal' },
      { id: 'app', label: BY_ID.get(command)?.label() ?? command, primary: true },
    ],
    tick: 'Always ask',
  })
  if (answer === null) return null

  const way: Way = answer.id === 'app' ? 'app' : 'shell'
  if (!answer.ticked) shells.setWay(command, way)
  return way
}
