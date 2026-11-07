import { t } from '../i18n.svelte'
import { notify } from '../notify'
import { keepJson, stored } from '../stored'
import { counted } from './counted'
import { lasting, MINUTE } from './days'
import { timeOn } from '../settings.svelte'
import { dueOf } from './goals'
import { time } from './time.svelte'

const TOLD = 'orden:time-told'

const KEPT = 100

const told = new Set<string>(
  (Array.isArray(stored(TOLD)) ? (stored(TOLD) as unknown[]) : []).filter(
    (one): one is string => typeof one === 'string',
  ),
)

function look(): void {
  if (!time.ready || !time.reminding || !timeOn()) return
  const due = dueOf(time.goals, counted(time.spans, time.rules), Date.now(), told)
  for (const one of due) {
    told.add(one.key)
    const name = time.activity(one.activity)?.name ?? t('No activity')
    notify(
      name,
      one.kind === 'goal'
        ? t('Goal reached')
        : t('The timer has run for {time}', { time: lasting(one.ms) }),
      `time-${one.key}`,
    )
  }
  if (due.length) keepJson(TOLD, [...told].slice(-KEPT))
}

setInterval(look, MINUTE)
