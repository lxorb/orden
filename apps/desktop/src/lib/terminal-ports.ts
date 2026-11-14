import { providePort } from '@orden/contracts'
import { invoke, waited } from './platform/src/api'

const STARTING = 20_000

providePort('terminal.previews', {
  scrollback: (tab) => import('./terminal/src/api').then((one) => one.scrollbackOf(tab)),
})

providePort('terminal.lines', {
  typeIn: async (line, pick) => {
    const [{ openTerminal, shells, ptyOf }, { workspace }] = await Promise.all([
      import('./terminal/src/api'),
      import('./workspace.svelte'),
    ])
    const shell = pick(await shells.ask(), shells.chosen)
    if (!shell) return false

    await openTerminal(shell.id, { folder: null })
    const tab = workspace.activeTabId
    if (!tab) return false

    const started = Date.now()
    while (Date.now() - started < STARTING) {
      const pty = ptyOf(tab)
      const typed =
        pty !== undefined &&
        (await invoke('pty_write', { id: pty, data: line, binary: false }).then(
          () => true,
          () => false,
        ))
      if (typed) return true
      await waited(150)
    }
    return false
  },
})
