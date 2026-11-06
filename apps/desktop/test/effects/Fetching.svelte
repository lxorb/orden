<script lang="ts">
  import { whileHere } from '../../src/lib/while-here'

  const here = whileHere()

  export function fetch<T>(asked: Promise<T>): Promise<T> {
    return here(asked)
  }
</script>
