export { answered, asked, readersOwn } from './asks'
export {
  type Call,
  count,
  done,
  flag,
  inTime,
  maybe,
  need,
  needScope,
  ranOut,
  short,
  sourceOf,
  text,
  writerOf,
} from './call'
export { asksFront, openedBy } from './front'
export { answerOf, Refused } from './problem'
export {
  docSource,
  judged,
  judgedForWriting,
  onDisk,
  type Place,
  placeFor,
  placeOf,
  reachable,
  reachesSpace,
  sharedSource,
  tabsInReach,
  writableAt,
} from './spaces'
export { readerPort, stopRefused, stopSignal, stopWatch } from './stopping'
export { namedTab, tabsOwnSpace, tabWithId } from './tab-target'
export { gatedBy, type Verb, verbsOf } from './table'
export { onViewSlip } from './view'
