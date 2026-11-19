import type { AgentAnswer } from '@orden/contracts'
import { basesOn } from '../../gates/src/api'
import { workspace } from '../../workspace/src/api'
import { askReader } from './ask'
import { bookmarks } from './bookmarks'
import { type Call, done, gatedBy, reachable, type Verb, verbsOf } from '../../agent-verbs/src/api'
import { readCanvas, editCanvas } from './canvas'
import { noteEditor } from './editor'
import { clipboard } from './clipboard'
import { captureToNote } from './capture'
import { runCommand } from './commands'
import { listBacklinks, searchNotes } from './find'
import { attachAgentLog } from './log'
import { appendNote, createNote, editNote, readNote, setProperty, setTask, writeNote } from './notes'
import { pdfHighlights, readPdf } from './pdf'
import { readSetting, writeSetting } from './settings'
import { addRow, addTask, editBase, editRows, listTasks, queryBase, updateTask } from './tasks'
import { getContext, workspaceTabs } from './tabs'
import { recentlyDeleted } from './deleted'
import { agentResult, runAgent } from './helpers'
import { createFolder, listNotes, moveFile, trashFile } from './tree'
import { listVersions, restoreVersion } from './versions'

function listSpaces(call: Call): AgentAnswer {
  return done(
    reachable(call).map((space) => ({
      id: space.id,
      name: space.name,
      open: space.id === workspace.activeSpace?.id,
    })),
  )
}

function withBases(verb: Verb): Verb {
  return gatedBy(() => basesOn(), 'databases are', verb)
}

export const hostVerbs = verbsOf({
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
  query_base: withBases(queryBase),
  add_row: withBases(addRow),
  edit_rows: editRows,
  edit_base: withBases(editBase),
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
  system_clipboard: clipboard,
  ask_reader: askReader,
  note_editor: noteEditor,
  recently_deleted: recentlyDeleted,
  run_agent: runAgent,
  agent_result: agentResult,
})
