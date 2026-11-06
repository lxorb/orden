import type { EditorState } from '@codemirror/state'

export class CompletionContext {
  readonly state: EditorState
  readonly pos: number
  readonly explicit: boolean

  constructor(state: EditorState, pos: number, explicit: boolean) {
    this.state = state
    this.pos = pos
    this.explicit = explicit
  }
}
