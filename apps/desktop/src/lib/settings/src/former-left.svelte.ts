import { formerLeftDoor } from '../../launch/src/api'

class Left {
  left = $state<readonly string[]>([])
  private asked: Promise<void> | null = null
  ask(): Promise<void> {
    this.asked ??= formerLeftDoor()
      .then(async ({ formerLeft }) => {
        await formerLeft.look()
        this.left = formerLeft.left
      })
      .catch(() => undefined)
    return this.asked
  }
}
export const leftBehind = new Left()
