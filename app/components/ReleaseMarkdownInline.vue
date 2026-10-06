<script setup lang="ts">
import type { ReleaseMarkdownInlineNode } from '~/utils/release-markdown'

defineProps<{
  nodes: ReleaseMarkdownInlineNode[]
}>()
</script>

<template>
  <template
    v-for="(node, index) in nodes"
    :key="`${node.type}-${index}`"
  >
    <template v-if="node.type === 'text'">
      {{ node.text }}
    </template>

    <img
      v-else-if="node.type === 'image'"
      :src="node.src"
      :alt="node.alt"
      loading="lazy"
      referrerpolicy="no-referrer"
      class="inline-block max-w-full align-middle"
    >

    <strong
      v-else-if="node.type === 'strong'"
      class="font-semibold text-default"
    >
      <ReleaseMarkdownInline :nodes="node.children" />
    </strong>

    <em
      v-else-if="node.type === 'emphasis'"
      class="italic"
    >
      <ReleaseMarkdownInline :nodes="node.children" />
    </em>

    <del
      v-else-if="node.type === 'delete'"
      class="text-muted"
    >
      <ReleaseMarkdownInline :nodes="node.children" />
    </del>

    <code
      v-else-if="node.type === 'code'"
      class="bg-elevated px-1 py-0.5 font-mono text-[0.875em] text-default"
    >{{ node.text }}</code>

    <a
      v-else-if="node.type === 'link'"
      :href="node.href"
      target="_blank"
      rel="noopener noreferrer"
      class="text-info underline decoration-info/40 underline-offset-2 hover:decoration-info"
    >
      <ReleaseMarkdownInline :nodes="node.children" />
    </a>
  </template>
</template>
