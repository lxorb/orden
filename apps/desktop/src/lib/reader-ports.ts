import { providePort, type TasksReaderPort } from '@orden/contracts'

const read =
  (name: keyof TasksReaderPort): TasksReaderPort[typeof name] =>
  async (args) =>
    (await (await import('./reader-verbs/src/api')).readerPort())[name](args)
providePort('tasks.reader', {
  listTasks: read('listTasks'),
  addTask: read('addTask'),
  updateTask: read('updateTask'),
  queryBase: read('queryBase'),
})
