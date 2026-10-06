<script setup lang="ts">
import { parseReleaseMarkdown } from '~/utils/release-markdown'

const props = withDefaults(defineProps<{
  source: string
  baseUrl?: string
  imageBaseUrl?: string
  emptyText?: string
}>(), { emptyText: '등록된 릴리즈 노트가 없습니다.' })

const blocks = computed(() => parseReleaseMarkdown(props.source, props.baseUrl, props.imageBaseUrl))

function headingClass(level: number): string {
  if (level === 1) {
    return 'border-b border-default pb-2 text-xl font-semibold text-default'
  }

  if (level === 2) {
    return 'border-b border-default pb-2 text-lg font-semibold text-default'
  }

  if (level === 3) {
    return 'text-base font-semibold text-default'
  }

  return 'text-sm font-semibold text-default'
}
</script>

<template>
  <div
    v-if="blocks.length"
    class="release-markdown flex min-w-0 flex-col gap-4 text-sm leading-6 text-toned"
  >
    <template
      v-for="(block, blockIndex) in blocks"
      :key="`${block.type}-${blockIndex}`"
    >
      <component
        :is="`h${Math.min(block.level, 6)}`"
        v-if="block.type === 'heading'"
        :class="headingClass(block.level)"
      >
        <ReleaseMarkdownInline :nodes="block.children" />
      </component>

      <p
        v-else-if="block.type === 'paragraph'"
        class="wrap-break-word"
      >
        <ReleaseMarkdownInline :nodes="block.children" />
      </p>

      <blockquote
        v-else-if="block.type === 'blockquote'"
        class="border-l-4 border-default pl-4 text-muted"
      >
        <ReleaseMarkdownInline :nodes="block.children" />
      </blockquote>

      <div
        v-else-if="block.type === 'code'"
        class="overflow-x-auto border border-default bg-elevated/50"
      >
        <div
          v-if="block.language"
          class="border-b border-default px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-dimmed"
        >
          {{ block.language }}
        </div>
        <pre class="min-w-max p-3 font-mono text-xs leading-5 text-default"><code>{{ block.text }}</code></pre>
      </div>

      <component
        :is="block.ordered ? 'ol' : 'ul'"
        v-else-if="block.type === 'list'"
        :class="block.ordered ? 'list-decimal' : 'list-disc'"
        class="flex flex-col gap-1 pl-6 marker:text-dimmed"
      >
        <li
          v-for="(item, itemIndex) in block.items"
          :key="itemIndex"
          class="pl-1"
          :class="item.checked !== null ? 'list-none -ml-5 flex items-start gap-2' : ''"
        >
          <span
            v-if="item.checked !== null"
            class="mt-1 flex size-4 shrink-0 items-center justify-center border border-default bg-muted"
            aria-hidden="true"
          >
            <UIcon
              v-if="item.checked"
              name="i-tabler-check"
              class="size-3 text-success"
            />
          </span>
          <span class="min-w-0 wrap-break-word">
            <ReleaseMarkdownInline :nodes="item.children" />
          </span>
        </li>
      </component>

      <div
        v-else-if="block.type === 'table'"
        class="editor-scrollbar w-fit max-w-full overflow-x-auto border border-default"
      >
        <table class="w-max border-collapse text-left text-sm">
          <thead class="bg-elevated/70 text-default">
            <tr>
              <th
                v-for="(cell, cellIndex) in block.headers"
                :key="cellIndex"
                class="border-b border-r border-default px-3 py-2 font-semibold last:border-r-0"
              >
                <ReleaseMarkdownInline :nodes="cell" />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, rowIndex) in block.rows"
              :key="rowIndex"
              class="even:bg-elevated/30"
            >
              <td
                v-for="(cell, cellIndex) in row"
                :key="cellIndex"
                class="border-b border-r border-default px-3 py-2 last:border-r-0 last-of-type:border-r-0"
              >
                <ReleaseMarkdownInline :nodes="cell" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <hr
        v-else-if="block.type === 'hr'"
        class="border-0 border-t border-default"
      >
    </template>
  </div>

  <p
    v-else
    class="text-sm text-muted"
  >
    {{ emptyText }}
  </p>
</template>
