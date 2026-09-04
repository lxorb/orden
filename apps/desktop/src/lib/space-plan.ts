/** Deciding what syncing should do about spaces, with nothing else attached.
 *
 *  Spaces used to travel in one direction only: a folder here became a space in
 *  the account, but a space in the account never became a folder here. Two
 *  machines on the same account could sit there holding different lists
 *  indefinitely, which is not something syncing is allowed to do.
 *
 *  The decision is separated from the doing so it can be tested against a plain
 *  list of spaces, which is how that gap would have been caught.
 *
 *  Nothing here ever removes a folder. A space the account no longer has is
 *  uploaded again rather than deleted: the worst that costs is a redundant
 *  upload, where the other way round costs someone their writing. */

export interface LocalSpace {
  name: string
  root: string
}

export interface RemoteSpace {
  id: string
  name: string
}

export interface Pairing {
  root: string
  spaceId: string
}

export interface Plan {
  /** A folder and a space that already describe each other. */
  pair: Pairing[]
  /** Folders the account has never heard of. */
  upload: LocalSpace[]
  /** Spaces this machine has never heard of. */
  adopt: RemoteSpace[]
  /** Mirrors whose folder is gone from this machine. */
  drop: string[]
  /** Mirrors whose space is gone from the account. The folder is uploaded
   *  again on the next pass rather than being stranded here. */
  detach: string[]
}

export function planSpaces(input: {
  local: LocalSpace[]
  remote: RemoteSpace[]
  mirrors: Pairing[]
}): Plan {
  const { local, remote, mirrors } = input

  const mirrorByRoot = new Map(mirrors.map((one) => [one.root, one]))
  const remoteById = new Map(remote.map((one) => [one.id, one]))
  const remoteByName = new Map(remote.map((one) => [one.name, one]))
  const roots = new Set(local.map((one) => one.root))

  const plan: Plan = { pair: [], upload: [], adopt: [], drop: [], detach: [] }
  const spoken = new Set(
    mirrors.filter((one) => roots.has(one.root)).map((one) => one.spaceId),
  )

  for (const space of local) {
    if (mirrorByRoot.has(space.root)) continue

    const match = remoteByName.get(space.name)
    if (match && !spoken.has(match.id)) {
      plan.pair.push({ root: space.root, spaceId: match.id })
      spoken.add(match.id)
    } else if (!match) {
      plan.upload.push(space)
    }
  }

  for (const space of remote) {
    if (spoken.has(space.id)) continue
    // A folder of that name is about to be paired with it, or already is.
    if (local.some((one) => one.name === space.name)) continue

    plan.adopt.push(space)
    spoken.add(space.id)
  }

  for (const mirror of mirrors) {
    if (!roots.has(mirror.root)) plan.drop.push(mirror.root)
    else if (!remoteById.has(mirror.spaceId)) plan.detach.push(mirror.root)
  }

  return plan
}
