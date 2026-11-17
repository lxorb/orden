import { workspace } from '../../workspace/src/api'

export function openPrivate(): void {
  workspace.openWebsite(true)
}
