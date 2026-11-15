export interface Moment {
  native: boolean
  plugin: boolean
  restored: boolean
  spaces: number
  restoring: boolean
  signedIn: boolean
  invited: boolean
  tabs: number
}

export function startsFresh(now: Moment): boolean {
  if (now.plugin || !now.native) return false
  if (!now.restored || now.restoring) return false
  if (now.signedIn || now.invited) return false

  return now.spaces === 0 && now.tabs === 0
}
