import { registerPaletteKind } from '@orden/contracts'

if (!__EVEN_PLUGIN__) {
  registerPaletteKind('hosts', () => import('./palette-hosts').then((one) => one.hosts))
}
