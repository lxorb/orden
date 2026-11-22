import { providePort } from '@orden/contracts'
import type { Found } from './mcp-servers/src/api'
import { isDesktop } from './platform/src/api'

const chatsStore = () => import('./chats-client/src/api').then((one) => one.chatStore()).then(({ chats }) => chats)
providePort('chats', {
  list: () =>
    chatsStore().then((chats) => chats.list.map(({ id, name, unread, mentions }) => ({ id, name, unread, mentions }))),
  chatAt: (path) => chatsStore().then((chats) => chats.chatAt(path)),
  part: (chat, wanted) =>
    import('./chats-client/src/api').then((one) => one.chatContext()).then(({ chatPart }) => chatPart(chat, wanted)),
  offer: async (chat, text, parent) => {
    ;(await chatsStore()).offer(chat, text, parent ? { parent } : {})
  },
  openLink: async (uri, how) => {
    const { openChatLink } = await (await import('./chats-client/src/api')).chatOpening()
    await openChatLink(uri, how)
  },
  mayDelete: async (paths) => {
    const { mayDelete } = await (await import('./chats-client/src/api')).chatDeleting()
    return mayDelete(paths)
  },
  ending: async (paths) => {
    const { ending } = await (await import('./chats-client/src/api')).chatDeleting()
    return ending(paths)
  },
})
providePort('chats.demo', {
  stage: (me) => import('./chats-client/src/api').then((one) => one.chatsDemo()).then(({ demoChats }) => demoChats(me)),
})
const agentsApi = () => import('./agents/src/api')
if (__AI__)
  providePort('agents.writes', {
    wrote: (agent, tabs) => {
      void agentsApi()
        .then((one) => one.agentsUi())
        .then((ui) => ui.wrote(agent, tabs))
    },
  })
if (__AI__)
  providePort('agents.reader', {
    knows: (agent, id) => agentsApi().then(({ asking }) => asking.knows(agent, id)),
    waiting: (agent) => agentsApi().then(({ asking }) => asking.of(agent).length),
    ask: (question) => agentsApi().then(({ asking }) => asking.ask({ ...question, choices: [...question.choices] }).id),
    answer: (id, answer) => void agentsApi().then(({ asking }) => asking.answer(id, answer)),
    heard: (id, patience, signal) => agentsApi().then(({ asking }) => asking.heard(id, patience, signal)),
    hear: (on) => agentsApi().then(({ tauriCrate }) => tauriCrate.hear(on)),
  })
providePort('agents.marks', {
  keepMarksOf: (agents) => {
    void import('./agent-host/src/api').then(({ keepMarksOf }) => keepMarksOf(agents))
  },
})
providePort('agents.crate', {
  answer: async (name, args) => {
    const { answerTheCrate } = await import('./agent-host/src/api')
    return answerTheCrate(name, args)
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
  adopt: (tab, handing) => import('./web-tab/src/api').then(({ pages }) => pages.adopt(tab, handing)),
  lend: async (tab, as) => {
    const { webLending } = await import('./web-tab/src/api')
    await (await webLending()).lend(tab, as)
  },
  unlend: (tab) => {
    void unlending(tab)
  },
  readerStore: async () => {
    const { webDataStores } = await import('./web-tab/src/api')
    const { webData } = await webDataStores()
    return webData.store(null)
  },
})
const importing = () => import('./import/src/api')
const bringing = () => importing().then((one) => one.bringing())
providePort('import.bring', {
  here: () => bringing().then((one) => one.here()),
  browser: (importer) => bringing().then((one) => one.browser(importer)),
  notes: (from) => bringing().then((one) => one.notes(from)),
  shared: (json) => importing().then((one) => one.readShared(json)),
  landShared: (shared, bytes, root, folder) => importing().then((one) => one.landShared(shared, bytes, root, folder)),
})
const mcpServers = () => import('./mcp-servers/src/api')
providePort('import.mcp', {
  scan: () => (!__AI__ || !isDesktop ? Promise.resolve([]) : mcpServers().then((one) => one.scanMcp())),
  importable: (found) =>
    (found as readonly Found[]).some((one) => one.servers.some((server) => !server.already && !server.orden)),
  picker: () =>
    !__AI__ || !isDesktop
      ? Promise.reject(new Error('no MCP servers here'))
      : mcpServers().then((one) => one.loadMcpImport()),
})
if (__AI__)
  providePort('account.signingOut', {
    signOut: async () => {
      const { signOut } = await import('./ai-providers/src/api')
      await signOut()
    },
  })
