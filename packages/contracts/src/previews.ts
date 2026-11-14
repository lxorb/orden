export interface PreviewedTab {
  readonly id: string
  readonly doc: string
  readonly home: string | null
}

export interface ScreenPreview {
  readonly text: string
  readonly cols: number
}

export interface TerminalPreviewPort {
  readonly scrollback: (tab: PreviewedTab) => Promise<ScreenPreview | null>
}

export interface PreviewPorts {
  readonly 'terminal.previews': TerminalPreviewPort
}
