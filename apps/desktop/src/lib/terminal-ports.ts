import { providePort } from '@orden/contracts'

providePort('terminal.previews', {
  scrollback: (tab) => import('./terminal/src/api').then((one) => one.scrollbackOf(tab)),
})
