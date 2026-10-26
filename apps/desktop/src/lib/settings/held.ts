/** What the stores ask of a settings file's hold before it is fetched (#673); the
 *  hold itself is hold.ts. */

/** The properties held, by store, each with what puts it back. */
export const holds = new Map<object, Map<string, unknown>>()

let declaring = false

/** Whether a settings file is being put in force: what a store would tell the account
 *  then is this machine's configuration, for nobody else to take. */
export function isDeclaring(): boolean {
  return declaring
}

export function setDeclaring(on: boolean): void {
  declaring = on
}

/** The properties of `on` that are held. */
export function heldOn(on: object): ReadonlySet<string> {
  return new Set(holds.get(on)?.keys())
}
