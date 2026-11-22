import type { AgentSaid } from './agents'

export type ReaderSaid = AgentSaid
export interface TasksReaderPort {
  listTasks(args: ReaderSaid): Promise<unknown>
  addTask(args: ReaderSaid): Promise<unknown>
  updateTask(args: ReaderSaid): Promise<unknown>
  queryBase(args: ReaderSaid): Promise<unknown>
}
export interface ReaderPorts {
  readonly 'tasks.reader': TasksReaderPort
}
