import { providePort } from '@orden/contracts'

providePort('voice', {
  record: () => import('./dictation/src/api').then((one) => one.recordVoice()),
  wordsIn: (bytes) =>
    import('./dictation/src/api')
      .then((one) => one.transcriber())
      .then((one) => one.wordsInFile(bytes))
      .then((words) => words.text),
})
