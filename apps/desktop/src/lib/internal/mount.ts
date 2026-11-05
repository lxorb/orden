/** A space Orden keeps itself, mounted on a desktop (#1068, step 4c): its folder
 *  opened, its rows mounted where the browser build's commands find them, and its root
 *  told to `invoke`, so every file command for a path in it is answered from the folder
 *  and none reaches the crate. Each is mounted as internal/spaces.ts finds or makes it
 *  (step 4d). */

import { readsAsText } from '../web/commands'
import { mountRows } from '../web/store'
import { folderBytes } from './bytes'
import { type InternalBytes, InternalFolder, type InternalWorld } from './folder'
import { mountRoot } from './roots'
import { internalRows } from './rows'

/** How many have been mounted, which names each one's address for the browser's
 *  commands: an address, never a name anybody reads. */
let count = 0

/** The world a desktop's folders live in: its clock and randomness, a Web Lock and a
 *  channel shared with the app's other windows, and the platform's way with names. */
function desktopWorld(foldsCase: boolean): InternalWorld {
  const world: InternalWorld = { now: () => Date.now(), key: () => crypto.randomUUID(), foldsCase }
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (locks) {
    world.exclusive = <T>(name: string, then: () => Promise<T>): Promise<T> =>
      locks.request(name, then) as Promise<T>
  }
  if (typeof BroadcastChannel === 'function') {
    world.channel = (name, heard) => {
      const channel = new BroadcastChannel(name)
      channel.onmessage = (event: MessageEvent<unknown>) => {
        heard(event.data)
      }
      return {
        post: (message) => {
          channel.postMessage(message)
        },
        close: () => {
          channel.close()
        },
      }
    }
  }
  return world
}

/** The space at `root`, kept in the folder `folder`. Answers how to let it go again. */
export async function mountInternal(
  root: string,
  folder: string,
  how: { foldsCase: boolean; world?: InternalWorld; bytes?: InternalBytes },
): Promise<() => void> {
  const opened = await InternalFolder.open(
    folder,
    how.bytes ?? folderBytes(folder),
    how.world ?? desktopWorld(how.foldsCase),
  )
  count += 1
  const web = `/internal-${String(count)}`
  const unmount = mountRows(web, internalRows(opened, web, readsAsText))
  const unroot = mountRoot({ root, web, folder: opened })
  return () => {
    unroot()
    unmount()
    void opened.flush().finally(() => {
      opened.close()
    })
  }
}
