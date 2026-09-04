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
 *  A folder is only ever removed when the account says outright that the space
 *  was deleted. Merely missing is not enough: that is indistinguishable from
 *  never uploaded, and acting on it would cost someone their writing. */

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
  /** Mirrors whose space is missing from the account without a marker saying
   *  it was deleted. The folder is uploaded again rather than stranded. */
  detach: string[]
  /** Folders whose space the account says was deleted. These go. */
  remove: string[]
}

export function planSpaces(input: {
  local: LocalSpace[]
  remote: RemoteSpace[]
  mirrors: Pairing[]
  /** Ids the account says were deleted, which is a fact rather than a gap. */
  deleted?: string[]
}): Plan {
  const { local, remote, mirrors, deleted = [] } = input

  const mirrorByRoot = new Map(mirrors.map((one) => [one.root, one]))
  const remoteById = new Map(remote.map((one) => [one.id, one]))
  const remoteByName = new Map(remote.map((one) => [one.name, one]))
  const roots = new Set(local.map((one) => one.root))

  const plan: Plan = { pair: [], upload: [], adopt: [], drop: [], detach: [], remove: [] }
  const gone = new Set(deleted)

  // Worked out first, because a folder on its way out must not be paired with
  // anything, uploaded, or counted as already holding its name. Otherwise
  // deleting a space and making a new one of the same name leaves the new one
  // unadopted until some later pass.
  const removing = new Set(
    mirrors.filter((one) => roots.has(one.root) && gone.has(one.spaceId)).map((one) => one.root),
  )

  const spoken = new Set(
    mirrors
      .filter((one) => roots.has(one.root) && !removing.has(one.root))
      .map((one) => one.spaceId),
  )

  for (const space of local) {
    if (mirrorByRoot.has(space.root) || removing.has(space.root)) continue

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
    // A folder of that name is about to be paired with it, or already is -
    // unless that folder is the one being removed, in which case the name is
    // free and this space should take it.
    if (local.some((one) => one.name === space.name && !removing.has(one.root))) continue

    plan.adopt.push(space)
    spoken.add(space.id)
  }

  for (const mirror of mirrors) {
    if (!roots.has(mirror.root)) {
      plan.drop.push(mirror.root)
      continue
    }

    // Deleted on purpose, somewhere else. A marker is a fact, not the absence
    // of one, so it is safe to act on - which is what lets a deletion win
    // instead of being undone by whichever machine was offline at the time.
    if (gone.has(mirror.spaceId)) plan.remove.push(mirror.root)
    else if (!remoteById.has(mirror.spaceId)) plan.detach.push(mirror.root)
  }

  return plan
}
