<script setup lang="ts">
import type { EditorPageState } from '~/utils/editor-page-state'

const props = defineProps<{ state: EditorPageState }>()
const {
  confirmDictionaryDelete, dictionaryDeleteError, dictionaryDeleteModalOpen, dictionaryDeleteSaving,
  dictionaryDeleteTarget, dictionaryEntryForm, dictionaryEntryModalError, dictionaryEntryModalOpen,
  dictionaryEntryModalSaving, dictionaryForm, dictionaryModalError, dictionaryModalOpen, dictionaryModalSaving,
  editingDictionaryEntry, editingDictionaryId, saveDictionary, saveDictionaryEntry
} = props.state
</script>

<template>
  <UModal
    v-model:open="dictionaryModalOpen"
    :title="editingDictionaryId ? '용어집 수정' : '새 용어집'"
    :ui="{ footer: 'justify-end' }"
  >
    <template #body>
      <UForm
        id="editor-dictionary-form"
        :state="dictionaryForm"
        class="flex flex-col gap-4"
        @submit="saveDictionary"
      >
        <UFormField
          name="name"
          label="이름"
          required
        >
          <UInput
            v-model="dictionaryForm.name"
            color="neutral"
            maxlength="100"
            placeholder="용어집 이름"
            class="w-full"
            :ui="{ base: 'h-8 leading-5' }"
          />
        </UFormField>
        <UFormField
          name="description"
          label="설명"
        >
          <UTextarea
            v-model="dictionaryForm.description"
            color="neutral"
            :rows="3"
            maxlength="500"
            placeholder="용어집에 대한 설명"
            class="w-full"
          />
        </UFormField>
        <UFormField
          name="visibility"
          label="공개 범위"
        >
          <USelect
            v-model="dictionaryForm.visibility"
            color="neutral"
            :items="[{ label: '공개', value: 'public' }, { label: '비공개', value: 'private' }]"
            class="w-full"
            :ui="{ base: 'h-8 leading-5' }"
          />
        </UFormField>
        <p
          v-if="dictionaryModalError"
          class="text-sm text-error"
        >
          {{ dictionaryModalError }}
        </p>
      </UForm>
    </template>
    <template #footer>
      <UButton
        color="neutral"
        variant="ghost"
        size="lg"
        @click="dictionaryModalOpen = false"
      >
        취소
      </UButton>
      <UButton
        type="submit"
        form="editor-dictionary-form"
        color="info"
        variant="soft"
        size="lg"
        :loading="dictionaryModalSaving"
      >
        {{ editingDictionaryId ? '저장' : '만들기' }}
      </UButton>
    </template>
  </UModal>

  <UModal
    v-model:open="dictionaryEntryModalOpen"
    :title="editingDictionaryEntry ? '용어 수정' : '용어 추가'"
    :ui="{ footer: 'justify-end' }"
  >
    <template #body>
      <UForm
        id="editor-dictionary-entry-form"
        :state="dictionaryEntryForm"
        class="flex flex-col gap-4"
        @submit="saveDictionaryEntry"
      >
        <UFormField
          name="sourceText"
          label="원문"
          required
        >
          <UTextarea
            v-model="dictionaryEntryForm.sourceText"
            color="neutral"
            :rows="3"
            maxlength="500"
            placeholder="원문 용어"
            class="w-full"
          />
        </UFormField>
        <UFormField
          name="translation"
          label="번역"
          required
        >
          <UTextarea
            v-model="dictionaryEntryForm.translation"
            color="neutral"
            :rows="3"
            maxlength="500"
            placeholder="번역 용어"
            class="w-full"
          />
        </UFormField>
        <UFormField
          name="note"
          label="메모"
        >
          <UTextarea
            v-model="dictionaryEntryForm.note"
            color="neutral"
            :rows="3"
            maxlength="1000"
            placeholder="선택 사항"
            class="w-full"
          />
        </UFormField>
        <p
          v-if="dictionaryEntryModalError"
          class="text-sm text-error"
        >
          {{ dictionaryEntryModalError }}
        </p>
      </UForm>
    </template>
    <template #footer>
      <UButton
        color="neutral"
        variant="ghost"
        @click="dictionaryEntryModalOpen = false"
      >
        취소
      </UButton>
      <UButton
        type="submit"
        form="editor-dictionary-entry-form"
        color="info"
        variant="soft"
        :loading="dictionaryEntryModalSaving"
      >
        {{ editingDictionaryEntry ? '저장' : '추가' }}
      </UButton>
    </template>
  </UModal>

  <UModal
    v-model:open="dictionaryDeleteModalOpen"
    :title="dictionaryDeleteTarget?.kind === 'entry' ? '용어 삭제' : '용어집 삭제'"
    :dismissible="!dictionaryDeleteSaving"
    :close="!dictionaryDeleteSaving"
    :ui="{ footer: 'justify-end' }"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <p class="wrap-break-word text-sm">
          <template v-if="dictionaryDeleteTarget?.kind === 'entry'">
            <strong>{{ dictionaryDeleteTarget.label }}</strong> 용어를 삭제할까요? 삭제한 용어는 복구할 수 없습니다.
          </template>
          <template v-else>
            <strong>{{ dictionaryDeleteTarget?.label }}</strong> 용어집을 삭제할까요? 용어집에 있는 모든 용어도 함께 삭제되며 복구할 수 없습니다.
          </template>
        </p>
        <UAlert
          v-if="dictionaryDeleteError"
          color="error"
          variant="soft"
          :title="dictionaryDeleteError"
        />
      </div>
    </template>
    <template #footer>
      <UButton
        color="neutral"
        variant="ghost"
        :disabled="dictionaryDeleteSaving"
        @click="dictionaryDeleteModalOpen = false"
      >
        취소
      </UButton>
      <UButton
        color="error"
        variant="soft"
        :loading="dictionaryDeleteSaving"
        :disabled="!dictionaryDeleteTarget"
        @click="confirmDictionaryDelete"
      >
        {{ dictionaryDeleteError ? '다시 시도' : '삭제' }}
      </UButton>
    </template>
  </UModal>
</template>
