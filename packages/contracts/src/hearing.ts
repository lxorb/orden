export type Hearing = () => Promise<() => void>

const loads: (() => Promise<Hearing>)[] = []

export function registerHearing(load: () => Promise<Hearing>): () => void {
  loads.push(load)
  return () => {
    const at = loads.indexOf(load)
    if (at >= 0) loads.splice(at, 1)
  }
}

export async function startHearings(): Promise<(() => void)[]> {
  const started = await Promise.allSettled([...loads].map(async (load) => (await load())()))
  return started.flatMap((one) => (one.status === 'fulfilled' ? [one.value] : []))
}
