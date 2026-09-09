/** What somebody is choosing an icon for.
 *
 *  One picker for the whole app: the same set of icons, the same search field,
 *  the same sheet, whether what wears the icon is a note, a canvas or a folder in
 *  the file list, or the space in the switcher that holds them. They are far apart
 *  in the page - and the file list is one component per folder, so there is no one
 *  place a row could reach a picker of its own - so what is being chosen for is
 *  state rather than a prop, the way the context menu is. Whoever opens it names the
 *  target, and
 *  IconPicker.svelte is mounted once, over everything. */

/** Where the icon will be kept, which is the only thing the three differ in.
 *
 *  A note and a canvas are one target and not two: both keep it in their own file,
 *  and which key it goes under is file-icon.ts's business rather than the picker's.
 *  A space keeps its icon on this device, and a folder in its space's own map,
 *  because neither is a file. See workspace.setIcon and
 *  workspace/folder-icons.svelte.ts. */
type IconTarget =
  { kind: 'space'; id: string } | { kind: 'file'; path: string } | { kind: 'folder'; path: string }

class IconChoice {
  /** What an icon is being chosen for, or null while the sheet is shut. */
  target = $state<IconTarget | null>(null)

  space(id: string) {
    this.target = { kind: 'space', id }
  }

  /** A note or a canvas, by its path. */
  file(path: string) {
    this.target = { kind: 'file', path }
  }

  folder(path: string) {
    this.target = { kind: 'folder', path }
  }

  close() {
    this.target = null
  }
}

export const iconChoice = new IconChoice()
