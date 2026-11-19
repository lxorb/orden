import { commandRowsLoaded, registered } from '@orden/contracts'
import { latched } from '../../ui-kit/src/api'

export const loadPalette = () => import('./Palette.svelte')
export const paletteDoor = latched(() =>
  Promise.all([loadPalette(), registered(), commandRowsLoaded()]).then(([one]) => one),
)
