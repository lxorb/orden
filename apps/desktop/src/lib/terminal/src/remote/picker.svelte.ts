import { settings } from '../../../settings.svelte'
import { hostPickerDialog } from '../../../surfaces.svelte'
import { workspace } from '../../../workspace.svelte'
import { type Destination, groupHosts, type Host } from './hosts'
import { remote } from './hosts.svelte'
import { connectTo, openAll, openRemote } from './open'

class HostPicker {
  open = $state(false)

  private paneId: string | undefined

  show(paneId?: string): void {
    void hostPickerDialog.ask()
    void remote.refresh()
    this.paneId = paneId
    this.open = true
  }

  toggle(): void {
    if (this.open) this.dismiss()
    else this.show()
  }

  choose(host: Host): void {
    this.away()
    void openRemote(host.id)
  }

  chooseGroup(group: string): void {
    this.away()
    void openAll(groupHosts(remote.hosts, group).map((host) => host.id))
  }

  connect(wanted: Destination): void {
    this.away()
    void connectTo(wanted)
  }

  manage(): void {
    this.dismiss()
    settings.show('remote')
  }

  dismiss(): void {
    this.open = false
    workspace.forgetChoice()
  }

  private away() {
    this.open = false
    if (this.paneId !== undefined) workspace.focusPane(this.paneId)
  }
}

export const hostPicker = new HostPicker()
