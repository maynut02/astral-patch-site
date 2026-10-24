<script setup lang="ts">
type AstralLinkType = 'Buff' | 'Card'

interface AstralReference {
  type: AstralLinkType
  id: string
  originalText: string
}

type Segment
  = | { type: 'text', content: string }
    | { type: 'astral', linkType: AstralLinkType, id: string, content: string }

const props = defineProps<{
  text: string | null
  lang?: string
}>()

const emit = defineEmits<{
  select: [reference: AstralReference]
}>()

const segments = computed<Segment[]>(() => {
  if (!props.text) {
    return []
  }

  const regex = /\[Astral=(Buff|Card):(\d+)\]\[\/Astral\]/g
  const result: Segment[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(props.text)) !== null) {
    if (match.index > lastIndex) {
      result.push({ type: 'text', content: props.text.slice(lastIndex, match.index) })
    }

    result.push({
      type: 'astral',
      linkType: match[1] === 'Buff' ? 'Buff' : 'Card',
      id: match[2] || '',
      content: match[0]
    })
    lastIndex = regex.lastIndex
  }

  if (lastIndex < props.text.length) {
    result.push({ type: 'text', content: props.text.slice(lastIndex) })
  }

  return result
})

function selectReference(part: Extract<Segment, { type: 'astral' }>): void {
  emit('select', {
    type: part.linkType,
    id: part.id,
    originalText: part.content
  })
}
</script>

<template>
  <span :lang="lang">
    <slot
      v-if="!text"
      name="empty"
    />
    <template v-else>
      <template
        v-for="(part, index) in segments"
        :key="index"
      >
        <span
          v-if="part.type === 'text'"
          class="whitespace-pre-wrap"
        >{{ part.content }}</span>
        <button
          v-else
          type="button"
          class="inline p-0 font-inherit text-info hover:underline underline-offset-2"
          :aria-label="`${part.linkType} ${part.id} 사전에서 보기`"
          @click="selectReference(part)"
        >
          {{ part.content }}
        </button>
      </template>
    </template>
  </span>
</template>
