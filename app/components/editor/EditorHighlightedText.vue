<script setup lang="ts">
interface HighlightSegment {
  text: string
  matched: boolean
}

const props = defineProps<{
  text: string
  query: string
}>()

const segments = computed<HighlightSegment[]>(() => {
  if (!props.text || !props.query.trim()) {
    return [{ text: props.text, matched: false }]
  }

  const query = props.query.trim()
  const source = props.text.toLocaleLowerCase()
  const normalizedQuery = query.toLocaleLowerCase()
  const result: HighlightSegment[] = []
  let cursor = 0

  while (cursor < props.text.length) {
    const matchIndex = source.indexOf(normalizedQuery, cursor)

    if (matchIndex < 0) {
      result.push({ text: props.text.slice(cursor), matched: false })
      break
    }

    if (matchIndex > cursor) {
      result.push({ text: props.text.slice(cursor, matchIndex), matched: false })
    }

    result.push({
      text: props.text.slice(matchIndex, matchIndex + query.length),
      matched: true
    })
    cursor = matchIndex + query.length
  }

  return result
})
</script>

<template>
  <span class="whitespace-pre-wrap">
    <span v-for="(segment, index) in segments" :key="index"
      :class="segment.matched ? 'rounded-sm bg-info/20 text-info' : undefined">{{ segment.text }}</span>
  </span>
</template>
