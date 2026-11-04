<script lang="ts">
  /** A component that fetches a part for itself, for while-here.effect.test.ts. */
  import { whileHere } from '../../src/lib/while-here'

  const here = whileHere()

  /** Hears `asked` through the component, as a strip hears a menu it fetched. */
  export function fetch<T>(asked: Promise<T>): Promise<T> {
    return here(asked)
  }
</script>
