import { invoke } from '../../tauri'
import type { Approval, Overview, Picture, ShellWords } from '../verbs'

export interface Source {
  state(): Promise<Overview>
  stop(agent?: string): Promise<boolean>
  resume(agent?: string): Promise<void>
  answer(id: string, allow: boolean, always: boolean): Promise<Approval>
  log(day: string): Promise<unknown[]>
  adopt(agentTab: string, tab: string): Promise<void>
  peek(tab: string): Promise<Picture>
  shell(key: string | null, words: ShellWords): Promise<void>
  holds(): Promise<boolean>
  hide(): Promise<boolean>
}

export const crate: Source = {
  state: () => invoke<Overview>('agents_state'),
  stop: (agent) => invoke<boolean>('agents_stop', agent === undefined ? {} : { agent }),
  resume: (agent) => invoke('agents_resume', agent === undefined ? {} : { agent }),
  answer: (id, allow, always) => invoke<Approval>('agents_answer', { id, allow, always }),
  log: (day) => invoke<unknown[]>('agents_log', { day }),
  adopt: (agentTab, tab) => invoke('agents_adopt', { agentTab, tab }),
  peek: (tab) => invoke<Picture>('agents_peek', { tab }),
  shell: (key, words) => invoke('agents_shell', { key, words }),
  holds: () => invoke<boolean>('agents_hold', { hide: false }),
  hide: () => invoke<boolean>('agents_hold', { hide: true }),
}
