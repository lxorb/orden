import {
  appSocketPath,
  type RelayToViewer,
  toViewerOf,
  type View,
  type ViewerFrame,
} from '@orden/online/apps'
import { Channel, type LinkWorld, type Opened } from '../../online-link/src/api'

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

  protected helloFrame(): ViewerFrame {
    return { t: 'hello', hold: true, view: this.view }
  }

  protected read(data: string | ArrayBuffer): RelayToViewer | null {
    return typeof data === 'string' ? toViewerOf(data) : null
  }

  protected final(frame: RelayToViewer): boolean {
    return frame.t === 'refused' && frame.error === 'gone'
  }

  resize(view: View): void {
    const was = this.view
    if (was.width === view.width && was.height === view.height && was.dpr === view.dpr) {
      if (was.hz === view.hz) return
    }
    this.view = view
    this.say({ t: 'view', view })
  }
}
