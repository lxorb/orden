/** Which rows of the file list are picked, and what a click does to that.
 *
 *  The rules are the ones every file list has: a plain click replaces, Ctrl
 *  adds or removes, Shift takes everything between the last plain click and
 *  here. "Between" means in the order the rows are shown, which is why this
 *  needs to be handed the rows rather than working them out - a folder's
 *  children are only between anything while the folder is open. */

export class Selection {
  /** The picked rows, as paths. */
  paths = $state<string[]>([])

  /** Where a Shift range starts: the last row clicked without Shift. */
  private anchor: string | null = null

  has(path: string): boolean {
    return this.paths.includes(path)
  }

  /** A plain click: that row alone. */
  select(path: string) {
    this.paths = [path]
    this.anchor = path
  }

  /** Ctrl-click: in or out, leaving the rest as it is. */
  toggle(path: string) {
    this.paths = this.has(path) ? this.paths.filter((one) => one !== path) : [...this.paths, path]
    this.anchor = path
  }

  /** Shift-click: from the anchor to here, in the order the rows are shown. */
  range(path: string, order: string[]) {
    const from = this.anchor === null ? -1 : order.indexOf(this.anchor)
    const to = order.indexOf(path)
    if (from < 0 || to < 0) {
      this.select(path)
      return
    }

    this.paths = order.slice(Math.min(from, to), Math.max(from, to) + 1)
  }

  all(order: string[]) {
    this.paths = order
    this.anchor = order[0] ?? null
  }

  clear() {
    this.paths = []
    this.anchor = null
  }

  /** Rows that have gone away take themselves out. */
  keepOnly(exists: (path: string) => boolean) {
    if (!this.paths.length) return
    this.paths = this.paths.filter(exists)
  }

  /** What a drag from `path` carries: the whole selection when the row is part
   *  of it, the row alone otherwise. */
  dragging(path: string): string[] {
    return this.has(path) && this.paths.length > 1 ? [...this.paths] : [path]
  }
}

/** The rows that are not inside another row of the same list: a folder takes
 *  what is in it along, so those need no move or deletion of their own. */
export function outermost(paths: string[]): string[] {
  return paths.filter(
    (path) => !paths.some((other) => other !== path && path.startsWith(`${other}/`)),
  )
}
