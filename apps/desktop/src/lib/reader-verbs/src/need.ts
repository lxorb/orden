import { said, type Said } from '../../automation/src/api'
import { Refused } from './refused'

export function need(args: Said, name: string): string {
  const value = said(args, name)
  if (value === null) throw new Refused('bad_arguments', `say ${name}`)
  return value
}
