<script lang="ts">
  import { arrive, letGo, LIST_STEP } from '../../src/lib/slide'
</script>

<div class="catch" out:letGo></div>
<div class="list" transition:arrive={{ y: -LIST_STEP }}></div>
