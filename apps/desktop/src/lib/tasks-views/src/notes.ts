export function openNote(name: string): void {
  void import('../../workspace/src/api').then(({ followNote }) =>
    followNote({ path: null, target: name, heading: null, block: null, page: null }),
  )
}
