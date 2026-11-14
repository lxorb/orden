import { samePath } from './platform/src/api'

export interface LocalSpace {
  name: string
  root: string
}

export interface RemoteSpace {
  id: string
  name: string
  shared?: boolean
}

export interface Pairing {
  root: string
  spaceId: string
  shared?: boolean
}

export interface Plan {
  pair: Pairing[]
  upload: LocalSpace[]
  adopt: RemoteSpace[]
  drop: string[]
  detach: string[]
  remove: string[]
  discard: string[]
}

export function planSpaces(input: {
  local: LocalSpace[]
  remote: RemoteSpace[]
  mirrors: Pairing[]
  deleted?: string[]
  untouched?: string | null
}): Plan {
  const { local, remote, deleted = [] } = input
  const spelled = (root: string) => local.find((one) => samePath(one.root, root))?.root ?? root
  const mirrors = input.mirrors.map((one) => ({ ...one, root: spelled(one.root) }))
  const untouched = input.untouched == null ? null : spelled(input.untouched)

  const mirrorByRoot = new Map(mirrors.map((one) => [one.root, one]))
  const remoteById = new Map(remote.map((one) => [one.id, one]))
  const remoteByName = new Map(remote.filter((one) => !one.shared).map((one) => [one.name, one]))
  const roots = new Set(local.map((one) => one.root))

  const plan: Plan = {
    pair: [],
    upload: [],
    adopt: [],
    drop: [],
    detach: [],
    remove: [],
    discard: [],
  }
  const gone = new Set(deleted)

  const discarding =
    untouched !== null &&
    roots.has(untouched) &&
    !mirrorByRoot.has(untouched) &&
    remote.some((one) => !one.shared)
      ? untouched
      : null
  if (discarding !== null) plan.discard.push(discarding)

  const removing = new Set(
    mirrors.filter((one) => roots.has(one.root) && gone.has(one.spaceId)).map((one) => one.root),
  )

  const spoken = new Set(
    mirrors
      .filter((one) => roots.has(one.root) && !removing.has(one.root))
      .map((one) => one.spaceId),
  )

  for (const space of local) {
    if (mirrorByRoot.has(space.root) || removing.has(space.root) || space.root === discarding) {
      continue
    }

    const match = remoteByName.get(space.name)
    if (match && !spoken.has(match.id)) {
      plan.pair.push({ root: space.root, spaceId: match.id })
      spoken.add(match.id)
    } else if (!match) {
      plan.upload.push(space)
    }
  }

  const claimed = new Set([
    ...mirrors.filter((one) => roots.has(one.root)).map((one) => one.root),
    ...plan.pair.map((one) => one.root),
  ])

  for (const space of remote) {
    if (spoken.has(space.id)) continue
    if (
      !space.shared &&
      local.some(
        (one) =>
          one.name === space.name &&
          !removing.has(one.root) &&
          one.root !== discarding &&
          !claimed.has(one.root),
      )
    ) {
      continue
    }

    plan.adopt.push(space)
    spoken.add(space.id)
  }

  for (const mirror of mirrors) {
    if (!roots.has(mirror.root)) {
      plan.drop.push(mirror.root)
      continue
    }

    if (gone.has(mirror.spaceId)) plan.remove.push(mirror.root)
    else if (!remoteById.has(mirror.spaceId)) {
      if (mirror.shared) plan.remove.push(mirror.root)
      else plan.detach.push(mirror.root)
    }
  }

  return plan
}
