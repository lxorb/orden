/** How many characters of note words a browser keeps, where it keeps only those it uses
 *  (keeping.ts, #1126).
 *
 *  A note kept here is held three times over - the document, what Orden last wrote, and
 *  the file's row, which IndexedDB keeps as UTF-16 - so a character costs some six bytes
 *  of the browser's storage. The budget is a share of what the browser says this site
 *  may keep, between a floor that holds a few hundred ordinary notes and a ceiling past
 *  which keeping more is a mirror again; and while the storage is nearly full, half of
 *  that, so the browser never has to throw anything of this site's away itself. */

/** Bytes of storage one character of a kept note costs, about. */
const BYTES_PER_CHARACTER = 6

/** The share of the site's quota the words may take. */
const SHARE = 0.2

const FLOOR = 4_000_000
const CEILING = 48_000_000

/** Past this much of the quota in use, the budget is halved. */
const TIGHT = 0.8

/** How long after the words kept last grew they are brought back within the budget. */
export const TRIM_AFTER = 5_000

/** The budget now, in characters. */
export async function keptBudget(): Promise<number> {
  // Only where the page may ask: a page served without TLS has no `storage`.
  const estimate =
    'storage' in navigator ? await navigator.storage.estimate().catch(() => null) : null
  const quota = estimate?.quota ?? 0
  if (!quota) return FLOOR
  const budget = Math.min(CEILING, Math.max(FLOOR, (quota * SHARE) / BYTES_PER_CHARACTER))
  const used = estimate?.usage ?? 0
  return used / quota > TIGHT ? Math.round(budget / 2) : Math.round(budget)
}
