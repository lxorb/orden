import { setAiRunner } from '@orden/editor'

export function installAiRunner() {
  setAiRunner(async (ask, signal) => {
    const { answer } = await import('./answering')
    await answer(ask, signal)
  })
}
