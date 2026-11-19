<script lang="ts">
  import { whileHere } from '../../src/lib/ui-kit/src/api'

  const here = whileHere()
  export function fetch<T>(asked: Promise<T>): Promise<T> {
    return here(asked)
  }
</script>
