<script lang="ts">
  import { FileMark, fileMark } from '../../../marks/src/api'
  import { nameOf } from '../../../platform/src/api'

  const { path }: { path: string } = $props()
</script>

<FileMark mark={fileMark(nameOf(path))} {path} />
