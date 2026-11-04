/** What the overview keeps of a tab from one run to the next is kept under a name of the
 *  tab's own (issue #331).
 *
 *  A tab's id is handed out fresh on every run (workspace/session.ts), so a window put
 *  somewhere by hand, or the picture kept of it, would be lost to the next run under its
 *  id. What stays is what the tab shows: its kind and its file, or for one with no file
 *  its name, and which of the tabs showing the same that it is, counted along the
 *  workspace's one strip. A file renamed is a new name, which starts afresh. Pure. */

/** As much of a tab as its name is made of. */
export interface Keyed {
  id: string
  kind: string
  path: string | null
  shown: string
}

/** Each tab's name that lasts, by its id this run. */
export function lastingKeys(tabs: readonly Keyed[]): Map<string, string> {
  const seen = new Map<string, number>()
  const out = new Map<string, string>()
  for (const tab of tabs) {
    const base = `${tab.kind}:${tab.path ?? `~${tab.shown}`}`
    const nth = seen.get(base) ?? 0
    seen.set(base, nth + 1)
    out.set(tab.id, nth ? `${base}#${nth}` : base)
  }
  return out
}
