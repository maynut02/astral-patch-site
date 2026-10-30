<script setup lang="ts">
import type { EditorDictionaryEntry, GlossaryProposal, GlossaryMetadata, GlossaryChangeKind } from '#shared/types/editor-dictionary'
import type { EditorItem } from '#shared/types/editor'
import { emptyGlossaryMetadata } from '#shared/utils/glossary'
import { getRequestErrorMessage } from '~/utils/request-error'
import { getEditorItemKey } from '~/utils/editor-links'

const props = defineProps<{ dictionaryId: string, entry?: EditorDictionaryEntry | null, kind: 'term' | 'voice', source?: EditorItem | null }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ submitted: [proposal: GlossaryProposal] }>()
const saving = ref(false)
const error = ref('')
const form = reactive({ translation: '', note: '', metadata: emptyGlossaryMetadata(), changeKind: 'new' as GlossaryChangeKind, variants: { allowed: '', historical: '', discouraged: '' } })
const baseRevision = ref(0)
const requestId = ref('')
const voiceFields = [
  { key: 'speechStyle', label: '기본 문체', required: true }, { key: 'selfAddress', label: '자신을 부르는 말' },
  { key: 'otherAddress', label: '상대를 부르는 말' }, { key: 'endings', label: '어미·말버릇' },
  { key: 'exceptions', label: '관계·상황별 예외' }, { key: 'exampleSource', label: '대표 대사 원문' },
  { key: 'exampleTranslation', label: '대표 대사 한국어', required: true }
] as const
const variants = [{ key: 'allowed', label: '허용 표기' }, { key: 'historical', label: '과거 표기' }, { key: 'discouraged', label: '비권장 표기' }] as const
watch(open, (value) => {
  if (!value) return
  error.value = ''
  requestId.value = crypto.randomUUID()
  form.translation = props.entry?.translation ?? ''
  form.note = props.entry?.note ?? ''
  form.metadata = { ...emptyGlossaryMetadata(), ...structuredClone(toRaw(props.entry?.metadata ?? {})), kind: props.entry?.metadata.kind ?? props.kind }
  if (!props.entry && props.source) form.metadata.evidenceKey = getEditorItemKey(props.source)
  for (const field of variants) form.variants[field.key] = form.metadata[field.key].join(', ')
  baseRevision.value = props.entry?.revision ?? 0
  form.changeKind = props.entry ? 'terminology' : 'new'
})
async function submit() {
  if (saving.value) return
  error.value = ''
  if (!form.translation.trim() || !form.note.trim()) {
    error.value = '한국어 표기와 의미·결정 이유를 입력해 주세요.'
    return
  }
  if (form.metadata.kind === 'term' && ![form.metadata.japanese, form.metadata.chineseSimplified, form.metadata.chineseTraditional].some(value => value.trim())) {
    error.value = '일본어 또는 중국어 표현을 하나 이상 입력해 주세요.'
    return
  }
  saving.value = true
  try {
    const metadata: GlossaryMetadata = { ...form.metadata }
    for (const field of variants) metadata[field.key] = form.variants[field.key].split(',').map(value => value.trim()).filter(Boolean)
    const proposal = await $fetch<GlossaryProposal>(`/api/editor/dictionaries/${props.dictionaryId}/proposals`, {
      method: 'POST', body: { translation: form.translation, note: form.note, metadata, entryId: props.entry?.id, baseRevision: baseRevision.value, changeKind: form.changeKind, requestId: requestId.value }
    })
    open.value = false
    emit('submitted', proposal)
  } catch (cause) {
    error.value = getRequestErrorMessage(cause, '제안을 제출하지 못했습니다. 입력은 유지됩니다.')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :dismissible="!saving"
    :title="entry ? '기준 변경 제안' : kind === 'voice' ? '캐릭터 문체 제안' : '새 용어 제안'"
    description="확정 전까지 현행 기준은 유지되며, 기존 번역은 자동 변경되지 않습니다."
  >
    <template #body>
      <form id="glossary-entry-form" class="flex flex-col gap-4" @submit.prevent="submit">
        <UAlert v-if="error" color="error" :title="error" />
        <div v-if="source" class="rounded border border-default p-3 text-xs text-muted">
          <p class="font-mono">
            {{ getEditorItemKey(source) }}
          </p>
          <p lang="ja" class="mt-2 whitespace-pre-wrap">
            일본어: {{ source.jp || '미등록' }}
          </p>
          <p lang="zh-Hans" class="mt-1 whitespace-pre-wrap">
            중국어: {{ source.cnS || source.cnT || '미등록' }}
          </p>
          <p class="mt-2">
            등록할 단어·표현만 골라 아래에 입력해 주세요.
          </p>
        </div>
        <UFormField :label="form.metadata.kind === 'voice' ? '캐릭터 이름' : '한국어 권장 표기'" required>
          <UInput
            v-model="form.translation"
            aria-label="한국어 권장 표기 또는 캐릭터 이름"
            :maxlength="200"
            class="w-full"
          />
        </UFormField>
        <template v-if="form.metadata.kind === 'term'">
          <p class="text-xs text-muted">
            일본어·중국어 중 하나만으로도 제안할 수 있습니다.
          </p>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="일본어">
              <UInput
                v-model="form.metadata.japanese"
                aria-label="일본어 대응어"
                :maxlength="200"
                class="w-full"
              />
            </UFormField>
            <UFormField label="중국어 간체">
              <UInput
                v-model="form.metadata.chineseSimplified"
                aria-label="중국어 간체 대응어"
                :maxlength="200"
                class="w-full"
              />
            </UFormField>
            <UFormField label="중국어 번체">
              <UInput
                v-model="form.metadata.chineseTraditional"
                aria-label="중국어 번체 대응어"
                :maxlength="200"
                class="w-full"
              />
            </UFormField>
          </div>
        </template>
        <UFormField
          v-for="field in form.metadata.kind === 'voice' ? voiceFields : []"
          :key="field.key"
          :label="field.label"
          :required="'required' in field && field.required"
        >
          <UTextarea
            v-model="form.metadata[field.key]"
            :aria-label="field.label"
            :maxlength="1000"
            class="w-full"
            :rows="2"
          />
        </UFormField>
        <UFormField label="의미·결정 이유" required>
          <UTextarea
            v-model="form.note"
            aria-label="의미와 결정 이유"
            :maxlength="1000"
            class="w-full"
            :rows="3"
          />
        </UFormField>
        <UFormField v-if="entry" label="변경 유형">
          <USelect v-model="form.changeKind" :items="[{ value: 'terminology', label: '표기 통일' }, { value: 'meaning', label: '의미 오류 수정' }, { value: 'style', label: '표현·문체 개선' }]" class="w-full" />
        </UFormField>
        <details class="border-t border-default pt-3">
          <summary class="cursor-pointer text-sm text-muted">
            적용 범위·표현 변형·근거
          </summary>
          <div class="mt-4 flex flex-col gap-4">
            <UCheckbox
              v-if="entry"
              v-model="form.metadata.archived"
              label="확정 후 이 기준을 보관"
              description="보관도 검토를 거쳐 반영하며, 기존 번역과 이력은 보존됩니다."
            />
            <UFormField label="적용 범위">
              <USelect v-model="form.metadata.scope" :items="[{ value: 'project', label: '전체' }, { value: 'file', label: '특정 파일' }, { value: 'entry', label: '특정 Key' }, { value: 'character', label: '특정 캐릭터 · 자동 적용 안 함' }]" class="w-full" />
            </UFormField>
            <UFormField v-if="form.metadata.scope !== 'project'" label="범위 대상">
              <UInput v-model="form.metadata.target" placeholder="파일명, 전체 Key 또는 캐릭터 이름" class="w-full" />
            </UFormField>
            <UFormField
              v-for="field in variants"
              :key="field.key"
              :label="field.label"
              description="쉼표로 구분합니다. 과거 표기는 자동 오류로 판정하지 않습니다."
            >
              <UInput v-model="form.variants[field.key]" class="w-full" />
            </UFormField>
            <UFormField label="근거 Key">
              <UInput v-model="form.metadata.evidenceKey" placeholder="예: STRCharacter_10014" class="w-full" />
            </UFormField>
            <UFormField label="중국어 의미 대조">
              <USelect v-model="form.metadata.semanticReview" :items="[{ value: 'unrecorded', label: '미기록' }, { value: 'recorded', label: '대조 기록 있음' }, { value: 'unresolved', label: '언어 간 차이 검토 중' }]" class="w-full" />
            </UFormField>
            <UFormField label="대조 근거·미해결 차이">
              <UTextarea v-model="form.metadata.semanticNote" :maxlength="1000" class="w-full" />
            </UFormField>
          </div>
        </details>
      </form>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="saving"
          @click="open = false"
        >
          취소
        </UButton><UButton
          type="submit"
          form="glossary-entry-form"
          color="info"
          :loading="saving"
        >
          제안 제출
        </UButton>
      </div>
    </template>
  </UModal>
</template>
