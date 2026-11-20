<script lang="ts">
  let text = $state('Kestrel')
  let lit = $state(false)
  export function say(next: string) {
    text = next
  }
  export function light() {
    lit = !lit
  }
</script>

<p dir="auto" class:lit>{text}</p>
