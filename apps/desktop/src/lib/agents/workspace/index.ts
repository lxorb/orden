import type { Said } from '../../automation/args'
import type { AgentAnswer, Caller } from '../../automation/caller'
import { workspace } from '../../workspace.svelte'
import { askReader } from './ask'
import { bookmarks } from './bookmarks'
import { type Call, done } from './call'
import { readCanvas, editCanvas } from './canvas'
import { noteEditor } from './editor'
import { applicationTabs } from './applications'
import { clipboard } from './clipboard'
import { captureToNote } from './capture'
import { draftMessage, listChats, postMessage, react, readChat, searchChats } from './chats'
import { runCommand } from './commands'
import { listBacklinks, searchNotes } from './find'
import { attachAgentLog } from './log'
import {
  appendNote,
  createNote,
  editNote,
  readNote,
  setProperty,
  setTask,
  writeNote,
} from './notes'
import { pdfHighlights, readPdf } from './pdf'
import { answerOf, Refused } from './problem'
import { readSetting, writeSetting } from './settings'
import { addRow, addTask, editBase, editRows, listTasks, queryBase, updateTask } from './tasks'
import { reachable } from './spaces'
import { getContext, workspaceTabs } from './tabs'
import { runTerminal } from './terminal'
import { readTerminal, typeTerminal } from './terminal-tab'
import { recentlyDeleted } from './deleted'
import { agentResult, runAgent } from './helpers'
import { createFolder, listNotes, moveFile, trashFile } from './tree'
import { listVersions, restoreVersion } from './versions'

export { answerTheCrate } from './crate'

function listSpaces(call: Call): AgentAnswer {
  return done(
    reachable(call).map((space) => ({
      id: space.id,
      name: space.name,
      open: space.id === workspace.activeSpace?.id,
    })),
  )
}

const VERBS: Record<string, (call: Call) => AgentAnswer | Promise<AgentAnswer>> = {
  get_context: getContext,
  list_spaces: listSpaces,
  list_notes: listNotes,
  search_notes: searchNotes,
  list_backlinks: listBacklinks,
  read_note: readNote,
  list_versions: listVersions,
  read_canvas: readCanvas,
  read_pdf: readPdf,
  pdf_highlights: pdfHighlights,
  edit_note: editNote,
  write_note: writeNote,
  append_note: appendNote,
  set_property: setProperty,
  set_task: setTask,
  list_tasks: listTasks,
  add_task: addTask,
  update_task: updateTask,
  query_base: queryBase,
  add_row: addRow,
  edit_rows: editRows,
  edit_base: editBase,
  create_note: createNote,
  restore_version: restoreVersion,
  edit_canvas: editCanvas,
  capture_to_note: captureToNote,
  attach_agent_log: attachAgentLog,
  move_file: moveFile,
  trash_file: trashFile,
  create_folder: createFolder,
  workspace_tabs: workspaceTabs,
  bookmarks,
  run_command: runCommand,
  read_setting: readSetting,
  write_setting: writeSetting,
  run_terminal: runTerminal,
  read_terminal: readTerminal,
  type_terminal: typeTerminal,
  system_clipboard: clipboard,
  ask_reader: askReader,
  note_editor: noteEditor,
  application_tabs: applicationTabs,
  recently_deleted: recentlyDeleted,
  list_chats: listChats,
  read_chat: readChat,
  search_chats: searchChats,
  draft_message: draftMessage,
  post_message: postMessage,
  react,
  run_agent: runAgent,
  agent_result: agentResult,
}

export const AGENT_VERBS = Object.keys(VERBS)

export async function runAgentVerb(name: string, args: Said, caller: Caller): Promise<AgentAnswer> {
  const verb = VERBS[name]
  if (!verb) return answerOf(new Refused('bad_arguments', `there is no verb called ${name}`))

  try {
    return await verb({ verb: name, args, caller })
  } catch (error) {
    return answerOf(error)
  }
}
