import { providePort } from '@orden/contracts'
import { invoke, platform, waited } from './platform/src/api'

const STARTING = 20_000

providePort('terminal.previews', {
  scrollback: (tab) => import('./terminal/src/api').then((one) => one.scrollbackOf(tab)),
})

const terminal = () => import('./terminal/src/api')

providePort('terminal.making', {
  open: async (shell) => {
    await (await terminal()).openTerminal(shell)
  },
  shells: async (open) => (await terminal()).shellRows((shell) => open(shell.id)),
  warm: async () => {
    await (await terminal()).shells.ask()
  },
  pickHost: async (pane) => {
    const { hostPicker } = await (await terminal()).hostPicking()
    hostPicker.show(pane)
  },
  online: async () => {
    await (await terminal()).openOnline()
  },
})

providePort('terminal.judge', {
  runsFree: async (program, args, programs, folder) => {
    const [free, { osOf }] = await Promise.all([
      (await terminal()).programJudge(),
      import('./terminal/src/agent/shell-text'),
    ])
    return free.runsFree(program, args, programs, folder, osOf(platform()))
  },
})

providePort('terminal.lines', {
  typeIn: async (line, pick) => {
    const [{ openTerminal, shells, ptyOf }, { workspace }] = await Promise.all([
      import('./terminal/src/api'),
      import('./workspace/src/api'),
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
