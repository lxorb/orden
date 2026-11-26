import type { TasksReaderPort } from '@orden/contracts'
import { READER, said } from '../../automation/src/api'
import { basesOn } from '../../gates/src/api'
import { queryBaseAt } from './bases'
import { placeFor } from './places'
import { Refused } from './refused'
import { addTodo, listTodos, todoNamed, todoTitle, updateTodo } from './todos'

function refused(): never {
  throw new Refused('not_granted', 'this app keeps no todos; they are in Orden')
}
export const tasksReader: TasksReaderPort = {
  listTasks: (args) => Promise.resolve().then(() => (__ORDEN_APP__ === 'orden' ? listTodos(args) : refused())),
  addTask: async (args) => (__ORDEN_APP__ === 'orden' ? addTodo(args, todoTitle(args)) : refused()),
  updateTask: async (args) => (__ORDEN_APP__ === 'orden' ? updateTodo(args, todoNamed(args).id) : refused()),
  queryBase: async (args) => {
    if (!basesOn()) {
      throw new Refused('not_granted', 'databases are turned off; the reader turns it on in Settings, Experimental')
    }
    return (await queryBaseAt(placeFor({ caller: READER }, said(args, 'space')), args)).answer
  },
}
