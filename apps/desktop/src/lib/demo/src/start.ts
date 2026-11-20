import { demoRun } from './api'

if (document.documentElement.dataset.demo)
  Object.assign(window, {
    ordenDemo: demoRun().then(async (run) => {
      await run.seed()
      void run.play()
    }),
  })
