import { wire } from './sync-server/src/api'
import { publishesFile } from './sync-server-blog/src/api'
import {
  askChat,
  chatsRevoked,
  closeChats,
  eraseChats,
  linkPointer,
} from './sync-server-chats/src/api'
import {
  endingTerm,
  endTerms,
  eraseMachines,
  machinesRevoked,
  machinesSignedOut,
  tellEnded,
} from './sync-server-machines/src/api'
import { PASS_ERASED } from './sync-server-pass/src/api'

wire({
  blog: { publishesFile },
  chats: { askChat, chatsRevoked, closeChats, eraseChats, linkPointer },
  machines: { endingTerm, endTerms, eraseMachines, machinesRevoked, machinesSignedOut, tellEnded },
  pass: { erased: PASS_ERASED },
})
