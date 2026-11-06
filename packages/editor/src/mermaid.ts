import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  type StreamParser,
  type StringStream,
} from '@codemirror/language'

const DIAGRAMS =
  /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|mindmap|timeline|zenuml|sankey(-beta)?|xychart(-beta)?|block(-beta)?|packet(-beta)?|kanban|architecture(-beta)?|radar(-beta)?|treemap(-beta)?|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b/

const KEYWORDS =
  /^(subgraph|end|participant|actor|activate|deactivate|note|loop|alt|else|opt|par|and|rect|critical|option|break|autonumber|class|click|style|linkStyle|classDef|direction|section|title|dateFormat|axisFormat|accTitle|accDescr|state|namespace|link|callback|over|left of|right of|as)\b/

const ARROW = /^(-{1,3}[->x)]+|={1,3}[=>]+|\.-+[.>]*|-\.->?|<-{1,2}>?|:{2,3}|--[ox]|o--o|x--x)/

interface MermaidState {
  diagram: boolean
}

export const mermaidParser: StreamParser<MermaidState> = {
  name: 'mermaid',

  startState: () => ({ diagram: false }),

  token(stream: StringStream, state) {
    if (stream.eatSpace()) return null

    if (stream.match(/^%%.*/)) return 'comment'

    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string'

    if (!state.diagram && stream.match(DIAGRAMS)) {
      state.diagram = true
      return 'definitionKeyword'
    }

    if (stream.match(KEYWORDS)) return 'keyword'
    if (stream.match(ARROW)) return 'operator'
    if (stream.match(/^[[\]{}()|>]/)) return 'bracket'
    if (stream.match(/^\d+(\.\d+)?/)) return 'number'
    if (stream.match(/^[A-Za-z_][\w-]*/)) return 'variableName'

    stream.next()
    return null
  },

  languageData: { commentTokens: { line: '%%' } },
}

const mermaidLanguage = StreamLanguage.define(mermaidParser)

export const mermaidDescription = LanguageDescription.of({
  name: 'mermaid',
  alias: ['mmd'],
  extensions: ['mmd'],
  load: () => Promise.resolve(new LanguageSupport(mermaidLanguage)),
})
