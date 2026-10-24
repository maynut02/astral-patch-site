<script setup lang="ts">
import type { EditorDiffPart } from '~/utils/editor-diff'

// unified: 삭제·추가를 모두 강조한다. before/after: 해당 쪽 변경만 강조한다.
const props = withDefaults(defineProps<{
  parts: EditorDiffPart[]
  side?: 'unified' | 'before' | 'after'
}>(), {
  side: 'unified'
})

function getPartClass(part: EditorDiffPart): string {
  if (part.type === 'removed' && props.side !== 'after') {
    return 'bg-error/10 text-error'
  }

  if (part.type === 'added' && props.side !== 'before') {
    return 'bg-success/10 text-success'
  }

  return 'text-toned'
}
</script>

<template>
  <span
    v-for="(part, partIndex) in parts"
    :key="`${part.type}-${partIndex}`"
    :class="getPartClass(part)"
  >{{ part.text }}</span>
</template>
