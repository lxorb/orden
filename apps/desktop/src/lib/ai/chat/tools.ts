import { isDesktop, invoke } from '../../platform/src/api'
import type { Provider } from '../../ai-providers/src/api'
import { READER_TABS } from '../../ai-providers/src/api'
import type { Mode, ToolOutput } from '../../ai-providers/src/api'
import { record, text, type ToolDef } from './wire'

export interface Tools {
  list(provider: Provider, mode: Mode): Promise<Listed>
  call(
    provider: Provider,
    mode: Mode,
    name: string,
    args: unknown,
    thread?: string,
  ): Promise<ToolOutput>
  context(provider: Provider, thread?: string): Promise<string>
}

interface Listed {
  instructions: string
  tools: ToolDef[]
}

function agentOf(provider: Provider) {
  return { id: provider.id, name: provider.name, readerTabs: READER_TABS }
}

function toolIn(value: unknown): ToolDef | null {
  const row = record(value)
  const name = text(row.name)
  if (!name) return null
  return {
    name,
    description: text(row.description),
    inputSchema: row.inputSchema ?? { type: 'object' },
    ...(row.annotations ? { annotations: record(row.annotations) } : {}),
  }
}

export function outputIn(value: unknown): ToolOutput {
  const result = record(value)
  const content = Array.isArray(result.content) ? result.content.map(record) : []
  const given = record(result._meta)
  const meta = record(given['so.orden.Orden/answer'] ?? given['ch.emilvinu.nib/answer'])
  const approval = meta.status === 'needs_approval' ? text(meta.approval) : ''
  return {
    text: content
      .filter((one) => one.type === 'text')
      .map((one) => text(one.text))
      .join('\n'),
    images: content
      .filter((one) => one.type === 'image')
      .map((one) => ({ mime: text(one.mimeType) || 'image/png', data: text(one.data) })),
    error: result.isError === true,
    ...(approval ? { approval } : {}),
    ...(approval && text(meta.category) ? { category: text(meta.category) } : {}),
    ...(approval && text(meta.site) ? { site: text(meta.site) } : {}),
  }
}

export const crateTools: Tools = {
  async list(provider, mode) {
    if (!isDesktop) return { instructions: '', tools: [] }
    const listed = record(
      await invoke<unknown>('ai_agent_tools', { agent: agentOf(provider), mode }),
    )
    const tools = Array.isArray(listed.tools) ? listed.tools : []
    return {
      instructions: text(listed.instructions),
      tools: tools.map(toolIn).filter((one): one is ToolDef => one !== null),
    }
  },

  async context(provider, thread) {
    if (!isDesktop) return ''
    const said = await invoke<unknown>('ai_agent_context', {
      agent: agentOf(provider),
      ...(thread ? { thread } : {}),
    })
    return Array.isArray(said)
      ? said
          .map(outputIn)
          .filter((one) => !one.error && one.text)
          .map((one) => one.text)
          .join('\n\n')
      : ''
  },

  async call(provider, mode, name, args, thread) {
    if (name === 'run_agent' || name === 'agent_result') {
      const { answerText, helperHere } = await import('../helpers/run')
      const answered = await helperHere(name, record(args), { thread: thread ?? null, mode })
      return {
        text: answerText(answered),
        images: [],
        error: 'refused' in answered,
        ...('agent' in answered ? { agent: answered.agent } : {}),
      }
    }
    try {
      const answered = await invoke<unknown>('ai_agent_call', {
        agent: agentOf(provider),
        mode,
        tool: name,
        args: typeof args === 'object' && args !== null ? args : {},
        ...(thread ? { thread } : {}),
      })
      return outputIn(answered)
    } catch (error) {
      return {
        text: error instanceof Error ? error.message : String(error),
        images: [],
        error: true,
      }
    }
  },
}
