import { readsAsText } from '../web/commands'
import { mountRows } from '../web/store'
import { folderBytes } from './bytes'
import { type InternalBytes, InternalFolder, type InternalWorld } from './folder'
import { mountRoot } from './roots'
import { internalRows } from './rows'

let count = 0

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
