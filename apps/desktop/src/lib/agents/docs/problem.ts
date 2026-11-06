export type Problem =
  | 'not_found'
  | 'ambiguous'
  | 'no_selection'
  | 'bad_anchor'
  | 'bad_edit'
  | 'bad_include'
  | 'overlapping'
  | 'rev_changed'
  | 'reader_edited_here'
  | 'reader_typing'
  | 'no_such_note'
  | 'not_a_note'
  | 'no_such_space'

export class DocError extends Error {
  constructor(
    readonly code: Problem,
    readonly about: unknown,
    message: string,
    readonly count = 0,
  ) {
    super(message)
    this.name = 'DocError'
  }
}
