<script setup lang="ts">
import type { EditorReviewCandidateGroup } from '#shared/types/editor'
import { formatEditorDate } from '~/utils/editor-helpers'
import { createEditorDiffCache } from '~/utils/editor-diff-cache'

defineProps<{
  groups: EditorReviewCandidateGroup[]
  selections: Record<string, string>
  selectionComplete: boolean
  busy: boolean
  loading: boolean
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{
  select: [unitId: string, value: unknown]
  confirm: []
}>()
const getDiffParts = createEditorDiffCache()
</script>

<template>
  <UModal
    v-model:open="open"
    title="승인할 번역 선택"
    description="같은 번역 항목에 여러 승인 대기 요청이 있습니다. 항목마다 최종 승인할 요청을 하나씩 선택해 주세요."
    :ui="{
      content: 'sm:max-w-240',
      footer: 'justify-end'
    }"
  >
    <template #body>
      <div class="flex max-h-[65vh] flex-col gap-5 overflow-y-auto pr-1">
        <UAlert
          color="warning"
          variant="soft"
          icon="i-tabler-git-merge"
          title="다른 탭과 현재 페이지 밖의 요청도 함께 표시됩니다."
          description="같은 항목의 모든 승인 대기 요청을 비교할 수 있으며, 승인한 요청을 제외한 나머지는 자동 종료됩니다."
        />

        <section
          v-for="group in groups"
          :key="group.unitId"
          class="flex flex-col gap-3"
        >
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-default pb-2">
            <span class="min-w-0 truncate text-sm font-semibold text-default">
              {{ group.category }}_{{ group.unitKey }}
            </span>
            <UBadge
              color="neutral"
              variant="soft"
              size="sm"
            >
              {{ group.candidates.length }}개 요청
            </UBadge>
          </div>

          <URadioGroup
            :model-value="selections[group.unitId]"
            :items="group.candidates"
            value-key="id"
            color="neutral"
            variant="card"
            :ui="{
              fieldset: 'gap-y-2',
              item: 'rounded-none p-3',
              wrapper: 'min-w-0',
              description: 'mt-2 whitespace-pre-wrap wrap-break-word leading-6'
            }"
            @update:model-value="emit('select', group.unitId, $event)"
          >
            <template #label="{ item }">
              <span class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span class="font-medium text-default">{{ item.handle ? `@${item.handle}` : '익명' }}</span>
                <UBadge
                  :color="item.changeKind === 'retain_confirmation' ? 'neutral' : 'info'"
                  variant="soft"
                  size="xs"
                >
                  {{ item.changeKind === 'retain_confirmation' ? '유지 확인' : '번역 수정' }}
                </UBadge>
                <time
                  class="text-xs font-normal text-muted"
                  :datetime="item.createdAt"
                >
                  {{ formatEditorDate(item.createdAt) }}
                </time>
              </span>
            </template>

            <template #description="{ item }">
              <template v-if="item.changeKind === 'retain_confirmation'">
                <span class="text-muted">기존 번역 유지 · </span>
                <span class="text-toned">{{ item.proposedText }}</span>
              </template>
              <template v-else>
                <EditorDiffText :parts="getDiffParts(item)" side="unified" />
                <span v-if="!item.previousText && !item.proposedText">빈 문자열</span>
              </template>
            </template>
          </URadioGroup>
        </section>
      </div>
    </template>

    <template #footer="{ close }">
      <UButton
        color="neutral"
        variant="outline"
        :disabled="busy"
        @click="close"
      >
        취소
      </UButton>
      <UButton
        color="success"
        icon="i-tabler-check"
        :loading="loading"
        :disabled="!selectionComplete || busy"
        @click="emit('confirm')"
      >
        선택한 번역 승인
      </UButton>
    </template>
  </UModal>
</template>
