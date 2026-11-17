import { commandRowsLoaded } from '@orden/contracts'
import { held } from '../../ui-kit/src/api'

export const loadMenuBar = () => import('./native-menu-bar.svelte')

export const appMenuRows = held(async () => {
  const [{ appMenu }] = await Promise.all([import('./app-menu'), commandRowsLoaded()])
  return { default: appMenu }
})
