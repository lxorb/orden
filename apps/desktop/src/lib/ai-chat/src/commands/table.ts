type Group = 'conversation' | 'model' | 'modes' | 'context' | 'words' | 'app'

export interface Row {
  name: string
  synonyms: readonly string[]
  args?: string
  group: Group
  description: string
}

const row = (
  group: Group,
  name: string,
  synonyms: readonly string[],
  description: string,
  args?: string,
): Row => ({ name, synonyms, group, description, ...(args ? { args } : {}) })

export const ROWS: readonly Row[] = [
  row('conversation', 'new', ['clear', 'reset'], 'New thread', '[name]'),
  row('conversation', 'resume', ['continue', 'history'], 'Open a past thread', '[name]'),
  row('conversation', 'rename', ['title'], 'Rename the thread', '[name]'),
  row('conversation', 'recap', [], 'One line about the thread'),
  row('conversation', 'branch', [], 'Branch from here', '[name]'),
  row('conversation', 'fork', [], 'Copy it into the background', '[prompt]'),
  row('conversation', 'rewind', ['undo', 'checkpoint'], 'Go back to a message'),
  row('conversation', 'compact', [], 'Summarize the older turns', '[focus]'),
  row('conversation', 'autocompact', [], 'When it compacts', '[auto|<tokens>|off]'),
  row('conversation', 'context', [], 'What fills the window', '[all]'),
  row('conversation', 'btw', ['side'], 'A side question', '[question]'),
  row('conversation', 'copy', [], 'Copy an answer', '[n]'),
  row('conversation', 'export', ['save'], 'Save as a note', '[note]'),
  row('conversation', 'archive', [], 'Archive the thread'),
  row('conversation', 'delete', [], 'Delete the thread'),
  row('conversation', 'stop', [], 'Stop everything it runs'),
  row('conversation', 'jobs', ['ps', 'bashes'], 'Background work'),
  row('conversation', 'focus', [], 'Fold tools and thinking'),
  row('conversation', 'help', [], 'Commands and keys'),

  row('model', 'model', ['models'], 'Choose the model', '[name]'),
  row('model', 'effort', ['reasoning', 'think'], 'How hard it thinks', '[level|auto]'),
  row('model', 'fast', [], 'The faster tier', '[on|off]'),
  row('model', 'output-style', ['personality', 'style'], 'How answers read', '[style]'),

  row('modes', 'approve', ['ask'], 'Approve mode', '[task]'),
  row('modes', 'plan', [], 'Plan mode', '[task]'),
  row('modes', 'auto', ['agent'], 'Auto mode', '[task]'),
  row('modes', 'full', ['yolo', 'bypass'], 'Full permissions', '[task]'),
  row('modes', 'agents', ['subagents'], 'Agent profile', '[name]'),
  row('modes', 'permissions', ['approvals', 'allowed-tools'], 'What the agent may do'),
  row('modes', 'goal', [], 'Work toward a goal', '[condition|pause|resume|clear]'),
  row('modes', 'loop', ['proactive'], 'Run again and again', '[interval] [prompt]'),
  row('modes', 'subtask', [], 'A helper in the background', '<task>'),
  row('modes', 'bg', ['background'], 'Send, and start another', '[prompt]'),
  row('modes', 'batch', [], 'One instruction over many notes', '<instruction>'),
  row('modes', 'deep-research', ['research'], 'A cited report', '<question>'),

  row('context', 'mention', ['add', 'attach'], 'Attach something', '<thing>'),
  row('context', 'add-space', ['add-dir'], 'Reach another space', '<space>'),
  row('context', 'memory', ['memories', 'instructions', 'rules'], 'Instructions and memory'),
  row('context', 'init', [], 'Write AGENTS.md'),
  row('context', 'skills', ['commands', 'prompts'], 'Your own commands', '[name]'),
  row('context', 'mcp', ['tools'], 'Tools'),

  row('words', 'shorter', [], 'Shorter'),
  row('words', 'longer', [], 'Longer'),
  row('words', 'fix', ['grammar'], 'Fix grammar'),
  row('words', 'translate', [], 'Translate', '[language]'),
  row('words', 'explain', [], 'Explain'),
  row('words', 'summarize', [], 'Summarize', '[note]'),
  row('words', 'review', ['code-review'], 'Review', '[note|changes]'),
  row('words', 'diff', ['changes'], 'What it changed'),

  row('app', 'tasks', [], 'To-dos', '[filter|words]'),
  row('app', 'today', ['plan-day'], 'Plan my day', '[wishes]'),
  row('app', 'catchup', [], 'What I missed in chats', '[chat]'),
  row('app', 'reply', [], 'A reply for this chat', '[wishes]'),
  row('app', 'status', [], 'Status'),
  row('app', 'usage', ['cost', 'stats', 'rate-limit-options'], 'Usage'),
  row('app', 'login', [], 'Sign in'),
  row('app', 'logout', [], 'Sign out'),
  row('app', 'doctor', ['checkup', 'debug-config'], 'Check the setup'),
  row('app', 'config', ['settings'], 'Settings'),
  row('app', 'keybindings', ['keymap'], 'Shortcuts'),
  row('app', 'theme', [], 'Switch theme'),
  row('app', 'vim', [], 'Vim keys'),
  row('app', 'voice', [], 'Dictate', '[on|off]'),
]

export const GOAL_CLEAR: readonly string[] = ['clear', 'stop', 'off', 'reset', 'none', 'cancel']

export function takenNames(): Set<string> {
  return new Set(ROWS.flatMap((one) => [one.name, ...one.synonyms]))
}
