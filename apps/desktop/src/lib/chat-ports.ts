import { providePort } from '@orden/contracts'

const chatsStore = () =>
  import('./chats-client/src/api').then((one) => one.chatStore()).then(({ chats }) => chats)

providePort('chats', {
  list: () =>
    __EVEN_PLUGIN__
      ? Promise.resolve([])
      : chatsStore().then((chats) =>
          chats.list.map(({ id, name, unread, mentions }) => ({ id, name, unread, mentions })),
        ),
  chatAt: (path) =>
    __EVEN_PLUGIN__ ? Promise.resolve(null) : chatsStore().then((chats) => chats.chatAt(path)),
  part: (chat, wanted) =>
    __EVEN_PLUGIN__
      ? Promise.resolve(null)
      : import('./chats-client/src/api')
          .then((one) => one.chatContext())
          .then(({ chatPart }) => chatPart(chat, wanted)),
  offer: async (chat, text, parent) => {
    if (__EVEN_PLUGIN__) return
    ;(await chatsStore()).offer(chat, text, parent ? { parent } : {})
  },
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

async function unlending(tab: string) {
  const { webLending } = await import('./web-tab/src/api')
  ;(await webLending()).unlend(tab)
}

providePort('web.lending', {
  adopt: (tab, handing) =>
    __EVEN_PLUGIN__
      ? handing()
      : import('./web-tab/src/api').then(({ pages }) => pages.adopt(tab, handing)),
  unlend: (tab) => {
    if (!__EVEN_PLUGIN__) void unlending(tab)
  },
})

const bringing = () => import('./import/src/api').then((one) => one.bringing())

providePort('import.bring', {
  here: () => (__EVEN_PLUGIN__ ? Promise.resolve(new Set()) : bringing().then((one) => one.here())),
  browser: (importer) =>
    __EVEN_PLUGIN__ ? Promise.resolve([]) : bringing().then((one) => one.browser(importer)),
  notes: (from) =>
    __EVEN_PLUGIN__
      ? Promise.resolve({ picked: false, trouble: null })
      : bringing().then((one) => one.notes(from)),
})

providePort('account.signingOut', {
  signOut: async () => {
    const { signOut } = await import('./ai-providers/src/api')
    await signOut()
  },
})
