import { registerPaletteKind } from '@orden/contracts'

registerPaletteKind('settings', () => import('./palette-rows').then((one) => one.paletteSettings))
