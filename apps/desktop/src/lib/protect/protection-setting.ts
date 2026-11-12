import { plural, t } from '../i18n.svelte'
import { setWord } from '../kind-choice'
import { prompt } from '../prompt.svelte'
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
      title: t('Turn off protection?'),
      detail: plural(count, {
        one: '{count} item is still protected. It stays locked; unprotect it first to remove protection.',
        other:
          '{count} items are still protected. They stay locked; unprotect them first to remove protection.',
      }),
      confirmLabel: t('Turn off'),
    })
    if (!sure) return
  }
  turned(on)
}
