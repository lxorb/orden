<script lang="ts">
  import Mark from './Mark.svelte'

  interface Props {
    size: number
    assemble?: boolean
    class?: string
  }
  const { size, assemble = false, class: extra = '' }: Props = $props()
</script>

<span class="tile {extra}" style:width="{size}px" style:height="{size}px" style:border-radius="{size / 4}px">
  <Mark {size} {assemble} />
</span>

<style>
  .tile {
    display: block;
    flex: none;
    background: linear-gradient(135deg, #c8ddfa, #e8c9ef);
    box-shadow:
      0 20px 50px -18px rgb(91 75 224 / 0.45),
      inset 0 0 0 1px rgb(255 255 255 / 0.5);
  }
</style>
