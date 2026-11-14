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
  const stops: (() => void)[] = []
  for (const load of [...loads]) stops.push(await (await load())())
  return stops
}
