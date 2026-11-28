import './lib/backend-ports'
import './lib/sync-base-ports'
import './lib/no-workspace-ports'
import '@orden/themes'
import { mount } from 'svelte'
import { account } from './lib/accounts/src/api'
import { ChatNav, hostFor, loadChatApp, watchHanded, watchPhone } from './lib/chat-app/src/api'
import { clearPushed, tellQuiet, watchPush, watchTaken } from './lib/chat-push/src/api'
import {
  chatHosting,
  chatStore,
  dndUntil,
  hush,
  loadChatsPanel,
  loadChatTab,
  wakeChats,
} from './lib/chats-client/src/api'
import { hub } from './lib/hub/src/api'
import { startup } from './lib/launch/src/api'
import { markPainted } from './lib/platform/src/api'
import { loadSignIn } from './lib/sign-in/src/api'
import { theme } from './lib/theme/src/api'
import { viewport } from './lib/ui-kit/src/api'

viewport.start()
theme.init()
void account.restore()
hub.start()
const target = document.getElementById('app')
if (!target) throw new Error('chat.html has no #app to mount into')
const nav = new ChatNav()
const [{ default: ChatApp }, { hostChats }, { chats }, panel, tab, signIn] = await Promise.all([
  loadChatApp(),
  chatHosting(),
  chatStore(),
  loadChatsPanel(),
  loadChatTab(),
  loadSignIn(),
  wakeChats(),
])
hostChats(hostFor(nav, () => chats.list))
watchHanded(nav, chats)
watchPush('chat')
watchTaken((chat, seq) => void chats.markRead(chat, seq))
watchPhone(nav, {
  quiet: () => ({ hours: hush.hours, dndUntil: dndUntil(), previews: hush.previews, sound: hush.sound }),
  tell: (quiet) => void tellQuiet(quiet),
  clear: (chat) => void clearPushed(chat),
})
if (__DRIVEABLE__) Object.assign(window, { ordenApp: { account, nav, chats } })
const app = mount(ChatApp, {
  target,
  props: { nav, parts: { ChatsPanel: panel.default, ChatTab: tab.default, SignIn: signIn.default } },
})
markPainted('shell painted')
void startup.shown()
export default app
