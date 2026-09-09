/** What somebody is choosing an icon for.
 *
 *  One picker for the whole app: the same set of icons, the same search field,
 *  the same sheet, whether what wears the icon is a space in the switcher or a note
 *  in the file list. The two are far apart in the page - and the file list is one
 *  component per folder, so there is no one place a note's row could reach a
 *  picker of its own - so what is being chosen for is state rather than a prop,
 *  the way the context menu is. Whoever opens it names the target, and
 *  IconPicker.svelte is mounted once, over everything. */

/** A space keeps its icon on this device, under its id; a note keeps its own in
 *  its front matter, under its path. See note-icon.ts and workspace.setIcon. */
type IconTarget = { kind: 'space'; id: string } | { kind: 'note'; path: string }

class IconChoice {
  /** What an icon is being chosen for, or null while the sheet is shut. */
  target = $state<IconTarget | null>(null)

  space(id: string) {
    this.target = { kind: 'space', id }
  }

  note(path: string) {
    this.target = { kind: 'note', path }
  }

  close() {
    this.target = null
  }
}

export const iconChoice = new IconChoice()
