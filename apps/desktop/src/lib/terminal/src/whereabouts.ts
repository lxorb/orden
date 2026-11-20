export class Whereabouts {
  private told = false
  heard(by: 'shell' | 'kernel', folder: string | null, was: string | null): string | null {
    if (by === 'shell') this.told = true
    else if (this.told) return null
    return folder && folder !== was ? folder : null
  }
}
