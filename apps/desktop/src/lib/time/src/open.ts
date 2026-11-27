import { showTime } from '@orden/contracts'
import { timeOn } from '../../gates/src/api'
import { type Spec, writeSpec } from './spec'

export function openTime(
  spec: Spec = { range: 'day', from: null, to: null, untracked: true, day: null, timeline: false },
): boolean {
  return timeOn() && showTime(writeSpec(spec))
}
