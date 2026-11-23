import { providePort } from '@orden/contracts'

providePort('canvas.pictures', {
  svg: (plane) => import('./plane/src/api').then((one) => one.planeSvg(plane)),
})
providePort('export.notePicture', {
  png: (note, width) => import('./export/src/api').then((one) => one.notePicture(note, width)),
})
