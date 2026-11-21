export interface PickedFile {
  name: string
  webkitRelativePath?: string
  size?: number
  lastModified?: number
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
export interface ExplorerCarryPort {
  carry(paths: readonly string[], into: string, how: 'copy' | 'move'): Promise<void>
}
export interface ArchivePort {
  archive(paths: readonly string[]): Promise<void>
  unarchive(path: string): Promise<void>
  show(path: string | null): Promise<void>
}
export interface FilePorts {
  readonly 'explorer.show': ExplorerShowPort
  readonly 'explorer.carry': ExplorerCarryPort
  readonly archive: ArchivePort
}
