<script lang="ts">
  /** A popup behind a door, the way the list of spaces is: a catch over the window and
   *  the list hanging from its header. For door-turns.effect.test.ts. */
  import { arrive, letGo, LIST_STEP } from '../../src/lib/slide'
</script>

<div class="catch" out:letGo></div>
<div class="list" transition:arrive={{ y: -LIST_STEP }}></div>
