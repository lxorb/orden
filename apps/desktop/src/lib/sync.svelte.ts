/** The syncing loop: when to look, what to do about spaces that are on one
 *  side and not the other, and what the light in the corner says.
 *
 *  Moving the notes of one space is next door, in sync/mirror.ts. */

import { api } from './api'
import { without } from './records'
import { isRecord, parsed } from './stored'
import { NUDGE_DELAY, pollDelay, RECONCILE_INTERVAL } from './backoff'
import { planSpaces } from './space-plan'
import { account } from './account.svelte'
import { t } from './i18n.svelte'
import { type Mirror, newMirror, pull, push, readMirror } from './sync/mirror'
import { workspace } from './workspace.svelte'

const STORAGE_KEY = 'nib:mirrors'

export type Status = 'off' | 'idle' | 'syncing' | 'error'

class Sync {
  status = $state<Status>('off')
  lastError = $state<string | null>(null)
  lastSyncedAt = $state<number | null>(null)

  private mirrors: Record<string, Mirror> = {}
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  /** Passes in a row that found nothing. Each one waits longer than the last. */
  private quiet = 0
  private reconciledAt = 0

  /** Which run of the loop this is. Bumped by every start and every stop, so a
   *  pass still in flight when syncing was turned off can tell that what it is
   *  about to say is out of date. Signing out is the case that matters: the
   *  pass finishes, and without this it would put the light back to "synced"
   *  and set the next timer for an account that is no longer there. */
  private generation = 0

  start() {
    this.generation++
    this.mirrors = this.load()
    this.quiet = 0
    this.reconciledAt = 0

    document.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('focus', this.onReturn)

    this.schedule(0)
  }

  stop() {
    this.generation++
    if (this.timer) clearTimeout(this.timer)
    this.timer = null

    document.removeEventListener('visibilitychange', this.onVisibility)
    window.removeEventListener('focus', this.onReturn)

    this.status = 'off'
  }

  /** The folder moved. The account's copy follows it rather than the next pass
   *  deciding this is a brand new space and uploading a second one. */
  async renamed(from: string, to: string, name: string) {
    const mirror = this.mirrors[from]
    if (!mirror) return

    mirror.root = to
    this.mirrors = { ...without(this.mirrors, from), [to]: mirror }
    this.save()

    const token = account.token
    if (token) await api.renameSpace(token, mirror.spaceId, name).catch(() => undefined)
  }

  /** Deleting a space here deletes it from the account too. Anything less and
   *  the next pass downloads it straight back, on this machine and every
   *  other one. */
  async forget(root: string) {
    const mirror = this.mirrors[root]
    if (!mirror) return

    this.mirrors = without(this.mirrors, root)
    this.save()

    const token = account.token
    if (token) await api.deleteSpace(token, mirror.spaceId).catch(() => undefined)
  }

  /** An icon chosen here, sent up so every other machine shows it too. */
  async pushIcon(root: string, icon: string | null) {
    const token = account.token
    const mirror = this.mirrors[root]
    if (!token || !mirror) return

    await api.setSpaceIcon(token, mirror.spaceId, icon).catch(() => undefined)
    await account.loadSpaces().catch(() => undefined)
  }

  /** The space's bookmarks as they now stand. Signed out, or in a space the
   *  account has never heard of, they stay on this machine and the next pass
   *  that pairs the space carries them up. */
  async pushBookmarks(root: string) {
    const token = account.token
    const mirror = this.mirrors[root]
    if (!token || !mirror) return

    await api
      .saveBookmarks(token, mirror.spaceId, workspace.bookmarks.of(root))
      .catch(() => undefined)
  }

  /** Something changed here, so the next pass should not wait out whatever slow
   *  interval the loop had settled into. */
  nudge() {
    if (!this.timer) return

    this.quiet = 0
    this.schedule(NUDGE_DELAY)
  }

  /** Hiding the window re-plans the pending pass at the longer interval;
   *  showing it again syncs at once, so what you look at is never stale. */
  private readonly onVisibility = () => {
    if (document.hidden) this.schedule()
    else this.onReturn()
  }

  private readonly onReturn = () => {
    if (!this.timer) return

    this.quiet = 0
    // Spaces now travel both ways, so coming back to the window is the moment
    // to ask whether the account has any this machine has not seen. One extra
    // request, and only when someone is actually looking.
    this.reconciledAt = 0
    this.schedule(0)
  }

  private schedule(delay = this.delay()) {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.tick(), delay)
  }

  private delay(): number {
    return pollDelay(this.quiet, document.hidden)
  }

  private async tick() {
    const mine = this.generation
    const moved = await this.pass()

    // Syncing may have been turned off while that pass was in the air. Setting
    // the next timer here would restart a loop that was deliberately stopped.
    if (mine !== this.generation) return

    // Eight doublings is far past either cap; stopping there keeps the shift
    // from overflowing on a client left open for days.
    this.quiet = moved ? 0 : Math.min(this.quiet + 1, 8)
    this.schedule()
  }

  /** One pass: pairs every local space with a remote one, then syncs. What
   *  the loop does on every tick, on its own so it can be driven by hand. */
  async pass(): Promise<boolean> {
    await this.reconcile()
    return this.run()
  }

  private async reconcile() {
    const token = account.token
    if (!token) return

    // The space list changes when someone makes or deletes one, which is rare.
    // A local space with no mirror yet is the case that cannot wait.
    const missing = workspace.spaces.some((space) => !this.mirrors[space.root])
    const due = Date.now() - this.reconciledAt >= RECONCILE_INTERVAL

    if (!missing && !due) return

    try {
      await account.loadSpaces()
      this.reconciledAt = Date.now()
    } catch {
      return
    }

    // What should happen is worked out on its own, away from the doing, so it
    // can be tested against a plain pair of lists - see `space-plan.ts`.
    const plan = planSpaces({
      local: workspace.spaces.map((space) => ({ name: space.name, root: space.root })),
      remote: account.spaces.map((space) => ({ id: space.id, name: space.name })),
      mirrors: Object.values(this.mirrors).map((one) => ({
        root: one.root,
        spaceId: one.spaceId,
      })),
      deleted: account.deletedSpaces,
    })

    // Removals come first. Adopting runs after, and adopting reuses a folder
    // of the same name if it finds one - which would be the very folder about
    // to be deleted. Deleting a space and making a new one of the same name
    // has to settle in a single pass, not leave a gap.
    for (const root of plan.remove) {
      const space = workspace.spaces.find((one) => one.root === root)
      this.mirrors = without(this.mirrors, root)
      if (space) await workspace.deleteSpace(space.id)
    }

    // Missing without a marker: not uploaded yet as far as anyone can tell, so
    // the mirror goes and the next pass sends the folder up again.
    for (const root of [...plan.detach, ...plan.drop]) {
      this.mirrors = without(this.mirrors, root)
    }

    for (const { root, spaceId } of plan.pair) {
      this.mirrors[root] = newMirror(spaceId, root)
    }

    for (const space of plan.upload) {
      const { space: remote } = await api.createSpace(token, space.name)
      this.mirrors[space.root] = newMirror(remote.id, space.root)
    }

    for (const space of plan.adopt) {
      const root = await workspace.adoptSpace(space.name)
      if (root) this.mirrors[root] = newMirror(space.id, root)
    }

    // The icon and the bookmarks belong to the space, so they travel with it.
    // Whatever the account holds wins: it is the one copy every machine can
    // see. The exception is the first time an account meets a space on this
    // machine, where whatever was bookmarked here joins the account's list
    // instead of being replaced by it - and is sent straight back up.
    const accountId = account.user?.id ?? null
    for (const remote of account.spaces) {
      const mirror = Object.values(this.mirrors).find((one) => one.spaceId === remote.id)
      if (!mirror) continue

      workspace.applyIcon(mirror.root, remote.icon ?? null)

      if (accountId === null) continue
      const merged = workspace.bookmarks.adopt(mirror.root, remote.bookmarks, accountId)
      if (merged) await api.saveBookmarks(token, remote.id, merged).catch(() => undefined)
    }

    // The account already lists spaces in the order it holds them, so adopting
    // that order is what makes a second machine look like the first.
    workspace.applySpaceOrder(account.spaces.map((space) => space.name))

    this.save()
  }

  /** Sends the rail order up. Local spaces the account has never heard of are
   *  simply left out; the server keeps them where they were. */
  async pushSpaceOrder() {
    const token = account.token
    if (!token) return

    const order = workspace.spaces
      .map((space) => this.mirrors[space.root]?.spaceId)
      .filter((id): id is string => !!id)

    if (!order.length) return

    try {
      await api.reorderSpaces(token, order)
      await account.loadSpaces()
    } catch {
      // The next reconcile will notice; an order is not worth an error banner.
    }
  }

  /** The remote space a local folder mirrors, if any. Publishing needs it. */
  remoteIdFor(root: string): string | null {
    return this.mirrors[root]?.spaceId ?? null
  }

  /** One full pass: take what the server has, then offer what we have. */
  /** One full pass: take what the server has, then offer what we have.
   *  Answers whether anything actually moved, which is what paces the loop. */
  async run(): Promise<boolean> {
    if (this.running || !account.token) return false

    const token = account.token
    const mine = this.generation
    this.running = true
    this.status = 'syncing'
    this.lastError = null
    let moved = false
    /** Whether something landed in the space on screen. */
    let shown = false

    try {
      for (const mirror of Object.values(this.mirrors)) {
        // A folder the workspace no longer lists is left alone until the next
        // reconcile decides what becomes of its mirror. Syncing it would read
        // every note as deleted here, and delete them from the account.
        if (!workspace.spaces.some((space) => space.root === mirror.root)) continue

        if (await pull(mirror, token)) {
          moved = true
          if (mirror.root === workspace.activeSpace?.root) shown = true
        }
        if (await push(mirror, token)) moved = true
      }

      // Nothing else re-reads the folder for notes that arrived from another
      // machine, so they would otherwise sit there unseen until the next save.
      if (shown) await workspace.loadTree()

      // A browser opens the welcome note because on a first visit there is
      // nothing else to read. Once an account has brought its own notes down
      // there is, and leaving somebody looking at "Welcome to Nib" beside their
      // own writing is the app failing to notice it has been introduced.
      if (moved) await workspace.leaveTheWelcomeNote()

      this.save()
      // Syncing may have been turned off while the pass was running, and the
      // light is already saying so. What it found is still worth writing down;
      // what it thinks the state is no longer is.
      if (mine !== this.generation) return moved

      this.lastSyncedAt = Date.now()
      this.status = Object.keys(this.mirrors).length ? 'idle' : 'off'
    } catch (error) {
      if (mine !== this.generation) return moved

      this.status = 'error'
      this.lastError = error instanceof Error ? error.message : t('sync failed')
    } finally {
      this.running = false
    }

    return moved
  }

  private load(): Record<string, Mirror> {
    const saved = parsed(localStorage.getItem(STORAGE_KEY))
    if (!isRecord(saved)) return {}

    // An older version wrapped the mirrors in an object of their own.
    const held = isRecord(saved.mirrors) ? saved.mirrors : saved

    const out: Record<string, Mirror> = {}
    for (const [root, one] of Object.entries(held)) {
      const mirror = readMirror(root, one)
      if (mirror) out[root] = mirror
    }

    return out
  }

  private save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.mirrors))
  }
}

export const sync = new Sync()
