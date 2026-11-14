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

export interface PlaneShown {
  readonly text: string
  readonly name: string
  readonly path: string | null
  readonly root: string | null
  readonly note: string | null
}

export interface PlanePicturePort {
  readonly svg: (plane: PlaneShown) => Promise<string | null>
}

export interface PreviewPorts {
  readonly 'terminal.previews': TerminalPreviewPort
  readonly 'canvas.pictures': PlanePicturePort
}
