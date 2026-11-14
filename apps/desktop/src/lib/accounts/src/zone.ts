export function zoneOffset(zone: string, at: number): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    }).formatToParts(at)
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((one) => one.type === type)?.value ?? 0)
    const wall = Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
    )
    return Math.round((wall - Math.floor(at / 60_000) * 60_000) / 60_000)
  } catch {
    return null
  }
}

export function farApart(zone: string, here: string, at: number): boolean {
  const theirs = zoneOffset(zone, at)
  const ours = zoneOffset(here, at)
  return theirs !== null && ours !== null && Math.abs(theirs - ours) >= 60
}
