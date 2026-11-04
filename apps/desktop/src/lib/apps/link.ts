/** An application's socket (docs/apps.md): the account's `AppRelay` for it, which keeps
 *  the online terminal's lock between the reader's devices and passes signalling to the
 *  device it runs on. Everything a socket does besides its frames is `Channel`'s, the
 *  online terminal's link, so it comes back, beats and is looked at the same way. */

import {
  appSocketPath,
  type RelayToViewer,
  toViewerOf,
  type View,
  type ViewerFrame,
} from '@orden/online/apps'
import { Channel, type LinkWorld, type Opened } from '../online/link'

export type AppHeard = RelayToViewer | Opened

export class AppLink extends Channel<RelayToViewer, ViewerFrame> {
  constructor(
    app: string,
    world: LinkWorld,
    heard: (what: AppHeard) => void,
    private view: View,
  ) {
    super(app, world, heard)
  }

  protected path(app: string): string {
    return appSocketPath(app)
  }

  /** That it takes part in the lock, and the tab's view the host is made to fit. */
  protected helloFrame(): ViewerFrame {
    return { t: 'hello', hold: true, view: this.view }
  }

  protected read(data: string | ArrayBuffer): RelayToViewer | null {
    return typeof data === 'string' ? toViewerOf(data) : null
  }

  protected final(frame: RelayToViewer): boolean {
    return frame.t === 'refused' && frame.error === 'gone'
  }

  /** The tab's view, said now and with every hello after. */
  resize(view: View): void {
    const was = this.view
    if (was.width === view.width && was.height === view.height && was.dpr === view.dpr) {
      if (was.hz === view.hz) return
    }
    this.view = view
    this.say({ t: 'view', view })
  }
}
