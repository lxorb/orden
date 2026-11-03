/** Where iCloud's placeholder for a file would be: `Plan.md` becomes `.Plan.md.icloud`, as
 *  `placeholder_of` in src-tauri/src/notes/icloud.rs has it. */
export function placeholderOf(path: string): string {
  const at = path.lastIndexOf('/') + 1
  return `${path.slice(0, at)}.${path.slice(at)}.icloud`
}
