export interface PickedFile {
  name: string
  webkitRelativePath?: string
  size?: number
  slice?(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> }
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface PandocPicture {
  link: string
  data: string
}

export interface ExplorerShowPort {
  offered(): boolean
  show(path: string): Promise<boolean>
}

export interface FilePorts {
  readonly 'explorer.show': ExplorerShowPort
}
