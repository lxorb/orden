import { locksHere, locksWork } from '../../locks'

const LEADER = 'orden-sync'
const FORMER_LEADER = 'nib-sync'

export interface Leadership {
  release(): void
}

export async function leadSync(signal?: AbortSignal, account = ''): Promise<Leadership | null> {
  const nobody = { release: () => undefined }
  const locks = locksHere()
  if (!locks || !(await locksWork(locks))) return nobody
  if (signal?.aborted) return null

  return new Promise((resolve) => {
    let release: () => void = () => undefined
    const held = new Promise<void>((done) => {
      release = done
    })

    const options: LockOptions = signal ? { signal } : {}
    const refused = () => resolve(signal?.aborted ? null : nobody)
    try {
      locks
        .request(`${LEADER}:${account}`, options, () =>
          locks
            .request(`${FORMER_LEADER}:${account}`, options, () => {
              resolve({ release })
              return held
            })
            .catch(refused),
        )
        .catch(refused)
    } catch {
      refused()
    }
  })
}
