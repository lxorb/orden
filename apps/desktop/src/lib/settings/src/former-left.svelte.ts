import { formerLeftDoor } from '../../launch/src/api'

type Said = Awaited<ReturnType<typeof formerLeftDoor>>['formerLeft']['said']
class Left {
  left = $state<readonly string[]>([])
  said = $state<Said | null>(null)
  private asked: Promise<void> | null = null
  ask(): Promise<void> {
    this.asked ??= formerLeftDoor()
      .then(async ({ formerLeft }) => {
        await formerLeft.look()
        this.left = formerLeft.left
        this.said = formerLeft.said
      })
      .catch(() => undefined)
    return this.asked
  }
}
export const leftBehind = new Left()
