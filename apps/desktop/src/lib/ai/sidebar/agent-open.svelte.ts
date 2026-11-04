/** Which outside agent's session the Ask panel is showing in a conversation's place, if
 *  any (#1120): an agent connected over MCP - Claude Code, a script - is a row of the
 *  chat list, and opening it shows what it did. Here rather than in the chat, because a
 *  session is not a thread: nothing is sent to it and nothing of it is kept as one.
 *
 *  Its own module, a line long, so the chat list and the notification that opens a
 *  session ask for it without carrying the agents' interface with them. */

class AgentOpen {
  /** The agent whose session is shown, or none. */
  id = $state<string | null>(null)
}

export const agentOpen = new AgentOpen()
