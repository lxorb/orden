export class BasesError extends Error {
  constructor(
    message: string,
    readonly at?: number,
  ) {
    super(message)
    this.name = 'BasesError'
  }
}
