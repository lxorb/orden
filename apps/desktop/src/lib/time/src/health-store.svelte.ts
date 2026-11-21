import { heldDatabase } from '../../held-database/src/api'
import { MEASURES, type Measure, type Reading, type Workout } from './health'

const READINGS = 'readings'
const WORKOUTS = 'workouts'
const held = heldDatabase('orden-health', 1, (request) => {
  const db = request.result
  if (!db.objectStoreNames.contains(READINGS)) db.createObjectStore(READINGS, { keyPath: ['kind', 'at'] })
  if (!db.objectStoreNames.contains(WORKOUTS)) db.createObjectStore(WORKOUTS, { keyPath: 'id' })
})
const settled = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('the health store refused'))
  })
const finished = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('the health store did not write'))
    tx.onabort = () => reject(tx.error ?? new Error('the health store did not write'))
  })
const readingOf = (value: unknown): Reading | null => {
  if (typeof value !== 'object' || value === null) return null
  const { kind, at, value: held } = value as Record<string, unknown>
  const measure = MEASURES.find((one) => one === kind)
  return measure && typeof at === 'number' && typeof held === 'number' && Number.isFinite(held)
    ? { kind: measure, at, value: held }
    : null
}
const workoutOf = (value: unknown): Workout | null => {
  if (typeof value !== 'object' || value === null) return null
  const one = value as Record<string, unknown>
  const count = (key: string) => (typeof one[key] === 'number' && Number.isFinite(one[key]) ? one[key] : null)
  const start = count('start')
  const end = count('end')
  if (typeof one.id !== 'string' || typeof one.sport !== 'string' || start === null || end === null) return null
  return {
    id: one.id,
    sport: one.sport,
    start,
    end,
    heart: count('heart'),
    peak: count('peak'),
    calories: count('calories'),
    meters: count('meters'),
  }
}
class HealthStore {
  changed = $state(0)
  async readings(from: number, to: number, kinds: readonly Measure[] = MEASURES): Promise<Reading[]> {
    const store = (await held.transaction(READINGS)).objectStore(READINGS)
    const all = await Promise.all(
      kinds.map((kind) => settled(store.getAll(IDBKeyRange.bound([kind, from], [kind, to], false, true)))),
    )
    return all
      .flat()
      .map(readingOf)
      .filter((one): one is Reading => one !== null)
  }
  async workouts(from: number, to: number): Promise<Workout[]> {
    const all = await settled((await held.transaction(WORKOUTS)).objectStore(WORKOUTS).getAll())
    return all
      .map(workoutOf)
      .filter((one): one is Workout => one !== null && one.end > from && one.start < to)
      .sort((one, other) => one.start - other.start)
  }
  async keep(readings: readonly Reading[], workouts: readonly Workout[] = []): Promise<void> {
    if (!readings.length && !workouts.length) return
    const tx = await held.transaction([READINGS, WORKOUTS], 'readwrite')
    for (const one of readings) tx.objectStore(READINGS).put(one)
    for (const one of workouts) tx.objectStore(WORKOUTS).put(one)
    await finished(tx)
    this.changed += 1
  }
}
export const healthStore = new HealthStore()
export function watchedHealth(range: () => readonly [number, number]): {
  readonly readings: Reading[]
  readonly workouts: Workout[]
} {
  let readings = $state.raw<Reading[]>([])
  let workouts = $state.raw<Workout[]>([])
  $effect(() => {
    const [from, to] = range()
    if (healthStore.changed < 0) return
    let gone = false
    void Promise.all([healthStore.readings(from, to), healthStore.workouts(from, to)])
      .then(([found, done]) => {
        if (gone) return
        readings = found
        workouts = done
      })
      .catch(() => undefined)
    return () => {
      gone = true
    }
  })
  return {
    get readings() {
      return readings
    },
    get workouts() {
      return workouts
    },
  }
}
