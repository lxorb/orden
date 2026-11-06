import { key } from '../../i18n.svelte'

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
  row('conversation', 'new', ['clear', 'reset'], key('New thread'), '[name]'),
  row('conversation', 'resume', ['continue', 'history'], key('Open a past thread'), '[name]'),
  row('conversation', 'rename', ['title'], key('Rename the thread'), '[name]'),
  row('conversation', 'recap', [], key('One line about the thread')),
  row('conversation', 'branch', [], key('Branch from here'), '[name]'),
  row('conversation', 'fork', [], key('Copy it into the background'), '[prompt]'),
  row('conversation', 'rewind', ['undo', 'checkpoint'], key('Go back to a message')),
  row('conversation', 'compact', [], key('Summarize the older turns'), '[focus]'),
  row('conversation', 'autocompact', [], key('When it compacts'), '[auto|<tokens>|off]'),
  row('conversation', 'context', [], key('What fills the window'), '[all]'),
  row('conversation', 'btw', ['side'], key('A side question'), '[question]'),
  row('conversation', 'copy', [], key('Copy an answer'), '[n]'),
  row('conversation', 'export', ['save'], key('Save as a note'), '[note]'),
  row('conversation', 'archive', [], key('Archive the thread')),
  row('conversation', 'delete', [], key('Delete the thread')),
  row('conversation', 'stop', [], key('Stop everything it runs')),
  row('conversation', 'jobs', ['ps', 'bashes'], key('Background work')),
  row('conversation', 'focus', [], key('Fold tools and thinking')),
  row('conversation', 'help', [], key('Commands and keys')),

  row('model', 'model', ['models'], key('Choose the model'), '[name]'),
  row('model', 'effort', ['reasoning', 'think'], key('How hard it thinks'), '[level|auto]'),
  row('model', 'fast', [], key('The faster tier'), '[on|off]'),
  row('model', 'output-style', ['personality', 'style'], key('How answers read'), '[style]'),

  row('modes', 'approve', ['ask'], key('Approve mode'), '[task]'),
  row('modes', 'plan', [], key('Plan mode'), '[task]'),
  row('modes', 'auto', ['agent'], key('Auto mode'), '[task]'),
  row('modes', 'full', ['yolo', 'bypass'], key('Full permissions'), '[task]'),
  row('modes', 'agents', ['subagents'], key('Agent profile'), '[name]'),
  row('modes', 'permissions', ['approvals', 'allowed-tools'], key('What the agent may do')),
  row('modes', 'goal', [], key('Work toward a goal'), '[condition|pause|resume|clear]'),
  row('modes', 'loop', ['proactive'], key('Run again and again'), '[interval] [prompt]'),
  row('modes', 'subtask', [], key('A helper in the background'), '<task>'),
  row('modes', 'bg', ['background'], key('Send, and start another'), '[prompt]'),
  row('modes', 'batch', [], key('One instruction over many notes'), '<instruction>'),
  row('modes', 'deep-research', ['research'], key('A cited report'), '<question>'),

  row('context', 'mention', ['add', 'attach'], key('Attach something'), '<thing>'),
  row('context', 'add-space', ['add-dir'], key('Reach another space'), '<space>'),
  row('context', 'memory', ['memories', 'instructions', 'rules'], key('Instructions and memory')),
  row('context', 'init', [], key('Write AGENTS.md')),
  row('context', 'skills', ['commands', 'prompts'], key('Your own commands'), '[name]'),
  row('context', 'mcp', ['tools'], key('Tools')),

  row('words', 'shorter', [], key('Shorter')),
  row('words', 'longer', [], key('Longer')),
  row('words', 'fix', ['grammar'], key('Fix grammar')),
  row('words', 'translate', [], key('Translate'), '[language]'),
  row('words', 'explain', [], key('Explain')),
  row('words', 'summarize', [], key('Summarize'), '[note]'),
  row('words', 'review', ['code-review'], key('Review'), '[note|changes]'),
  row('words', 'diff', ['changes'], key('What it changed')),

  row('app', 'tasks', [], key('To-dos'), '[filter|words]'),
  row('app', 'today', ['plan-day'], key('Plan my day'), '[wishes]'),
  row('app', 'catchup', [], key('What I missed in chats'), '[chat]'),
  row('app', 'reply', [], key('A reply for this chat'), '[wishes]'),
  row('app', 'status', [], key('Status')),
  row('app', 'usage', ['cost', 'stats', 'rate-limit-options'], key('Usage')),
  row('app', 'login', [], key('Sign in')),
  row('app', 'logout', [], key('Sign out')),
  row('app', 'doctor', ['checkup', 'debug-config'], key('Check the setup')),
  row('app', 'config', ['settings'], key('Settings')),
  row('app', 'keybindings', ['keymap'], key('Shortcuts')),
  row('app', 'theme', [], key('Switch theme')),
  row('app', 'vim', [], key('Vim keys')),
  row('app', 'voice', [], key('Dictate'), '[on|off]'),
]

export const GOAL_CLEAR: readonly string[] = ['clear', 'stop', 'off', 'reset', 'none', 'cancel']

export function takenNames(): Set<string> {
  return new Set(ROWS.flatMap((one) => [one.name, ...one.synonyms]))
}
