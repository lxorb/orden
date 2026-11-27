export interface Kept {
  token: string
  id: string
  user: string
}
export interface PushWorld {
  app: string
  token: () => Promise<string>
  me: () => { user: string; session: string } | null
  kept: () => Kept | null
  keep: (kept: Kept | null) => void
  register: (session: string, body: Record<string, string>) => Promise<string | null>
  remove: (session: string, id: string) => Promise<void>
  zone: () => string
}
export function registrar(world: PushWorld): { settle: () => Promise<void> } {
  let running: Promise<void> = Promise.resolve()
  let fresh = true
  async function once(): Promise<void> {
    const me = world.me()
    const kept = world.kept()
    if (!me) {
      if (kept) world.keep(null)
      fresh = true
      return
    }
    const token = await world.token()
    if (!token) return
    const mine = kept?.user === me.user ? kept : null
    if (mine?.token === token && !fresh) return
    if (mine && mine.token !== token) await world.remove(me.session, mine.id).catch(() => undefined)
    const zone = world.zone()
    const id = await world
      .register(me.session, { kind: 'fcm', token, app: world.app, ...(zone ? { zone } : {}) })
      .catch(() => null)
    if (world.me()?.session !== me.session) return
    if (id === null) {
      if (kept && !mine) world.keep(null)
      return
    }
    fresh = false
    world.keep({ token, id, user: me.user })
  }
  return {
    settle: () => {
      running = running.then(once, once)
      return running
    },
  }
}
