import { providePort } from '@orden/contracts'

providePort('chats.names', {
  names: () =>
    __EVEN_PLUGIN__
      ? Promise.resolve({})
      : import('./chats-client/src/api')
          .then((one) => one.chatStore())
          .then(({ chats }) =>
            Object.fromEntries(chats.list.map((one) => [one.id, one.name ?? one.id])),
          ),
})

providePort('agents.writes', {
  wrote: (agent, tabs) => {
    if (!__EVEN_PLUGIN__) {
      void import('./agents/src/api')
        .then((one) => one.agentsUi())
        .then((ui) => ui.wrote(agent, tabs))
    }
  },
})

providePort('voice', {
  record: () => import('./dictation/src/api').then((one) => one.recordVoice()),
  wordsIn: (bytes) =>
    import('./dictation/src/api')
      .then((one) => one.transcriber())
      .then((one) => one.wordsInFile(bytes))
      .then((words) => words.text),
})

providePort('web.lending', {
  adopt: (tab, handing) =>
    __EVEN_PLUGIN__
      ? handing()
      : import('./web-tab/src/api').then(({ pages }) => pages.adopt(tab, handing)),
  unlend: (tab) => {
    if (!__EVEN_PLUGIN__) void import('./web-tab/src/lending').then((one) => one.unlend(tab))
  },
})
