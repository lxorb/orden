import { sidebarParts } from '../../ai-chat/src/api'

export type { Change, ChatHost, Choice, ContextKind, Edit, FileChange } from '../../ai-chat/src/api'
export type { Front, Listed, Mention, MentionKind, NoteChanges, Panel } from '../../ai-chat/src/api'
export type { PanelCommand, ReviewPanel, Row, Source, TaskTool } from '../../ai-chat/src/api'
const parts = await sidebarParts()
export const { alwaysOffered, chat, chatPaths, chatToTab, checkpoints, citationLinks, citedIn } = parts
export const { compactsAt, crateAnswers, DEFAULT_ASK, dictation, estimate, estimateText } = parts
export const { filled, followPath, following, forkAt, instructionsSent, lasted, linkedAnswer } = parts
export const { mentionAt, mentionOf, minutes, noteInFront, ordered, outsideTool, quick, side, railOpen } = parts
export const { pathMenu, ranked, rememberRail, rememberTaskAsk, rememberTaskMode, rememberTaskUses } = parts
export const { review, sameMention, sayAlways, seconds, SELECTION_CHIP, selectionHere } = parts
export const { sourcesFor, spaceNamed, switchBranch, TASK_TOOLS, taskAsk, taskMode } = parts
export const { taskUses, toggleFollow, tokens, verbOf } = parts
