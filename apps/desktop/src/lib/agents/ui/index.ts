/** Everything the reader sees of agents (docs/agent-native.md 6.7, 7.1, 7.3, 9.3, 9.5):
 *  the frame round a page an agent acts in, its mark on the tab, its row in the Ask
 *  panel's chat list and its session there, its questions, Show, the stop and the
 *  pairing bubble.
 *
 *  Never in the first paint. The shell reads `agent-marks.svelte.ts`, and this arrives
 *  with the first agent event, the chat list or the stop key, whichever asks first.
 *
 *  | file | what it owns |
 *  | --- | --- |
 *  | `seen` | what the window knows, and what each event changes |
 *  | `marks` | which tab wears which mark: acting, paused, none |
 *  | `activity` | the store, and every press about agents |
 *  | `live` | the store started, and the shell kept up to date |
 *  | `session`, `words` | the audit log as a list, and a verb as a word |
 *  | `source`, `fake` | the crate, and a crate in memory for tests and drives |
 *  | `read` | the crate's events read |
 *  | `AgentRows`, `AgentSession`, `Question` | the row in the chat list, and the session |
 *  | `ActivityPanel` | the same sessions in a panel of their own, until it goes |
 *  | `PairingBubble`, `TakeoverBar` | the two things asked outside it | */

export { ended, start, started, stopAgents, wrote } from './live.svelte'
