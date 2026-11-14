import { setWord } from '../kind-choice'
import { prompt } from '../ui-kit/src/api'
import { NO_PROTECTION_WORD, PROTECTION_WORD, protectionOn } from './gate'
import { protection } from './protection.svelte'

function turned(on: boolean): void {
  setWord(on ? NO_PROTECTION_WORD : PROTECTION_WORD, false)
  setWord(on ? PROTECTION_WORD : NO_PROTECTION_WORD, true)
}

export async function turnProtection(on: boolean): Promise<void> {
  if (on === protectionOn()) return
  const count = protection.count
  if (!on && count > 0) {
    const sure = await prompt.confirm({
      title: 'Turn off protection?',
      detail:
        count === 1
          ? '1 item is still protected. It stays locked; unprotect it first to remove protection.'
          : `${count} items are still protected. They stay locked; unprotect them first to remove protection.`,
      confirmLabel: 'Turn off',
    })
    if (!sure) return
  }
  turned(on)
}
