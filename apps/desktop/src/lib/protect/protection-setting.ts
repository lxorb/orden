import { plural, t } from '../i18n.svelte'
import { setWord } from '../kind-choice'
import { prompt } from '../prompt.svelte'
import { hiddenKinds } from '../settings.svelte'
import type { Store } from '../settings/hold'
import { NO_PROTECTION_WORD, PROTECTION_WORD, protectionIn, protectionOn } from './gate'
import { protection } from './protection.svelte'

const listOf = (whole: unknown): readonly string[] =>
  Array.isArray(whole) ? whole.filter((one): one is string => typeof one === 'string') : []

export function protectionStore(): Store {
  return {
    on: hiddenKinds,
    name: 'hidden',
    shared: 'hiddenKinds',
    take: (whole) => protectionIn(listOf(whole)),
    put: (whole, there) => [
      ...listOf(whole).filter((one) => one !== PROTECTION_WORD && one !== NO_PROTECTION_WORD),
      there ? PROTECTION_WORD : NO_PROTECTION_WORD,
    ],
  }
}

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
