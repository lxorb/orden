import type { TasksReaderPort } from '@orden/contracts'
import { READER, said } from '../../automation/src/api'
import { basesOn } from '../../gates/src/api'
import { queryBaseAt } from './bases'
import { placeFor } from './places'
import { Refused } from './refused'
import { addTodo, listTodos, todoNamed, todoTitle, updateTodo } from './todos'

export const tasksReader: TasksReaderPort = {
  listTasks: (args) => Promise.resolve().then(() => listTodos(args)),
  addTask: async (args) => addTodo(args, todoTitle(args)),
  updateTask: async (args) => updateTodo(args, todoNamed(args).id),
  queryBase: async (args) => {
    if (!basesOn()) {
      throw new Refused('not_granted', 'databases are turned off; the reader turns it on in Settings, Experimental')
    }
    return (await queryBaseAt(placeFor({ caller: READER }, said(args, 'space')), args)).answer
  },
}
