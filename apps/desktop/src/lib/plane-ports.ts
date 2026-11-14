import { providePort } from '@orden/contracts'

providePort('canvas.pictures', {
  svg: (plane) => import('./plane/src/api').then((one) => one.planeSvg(plane)),
})
