<script setup lang="ts">
import { useGlossaryWorkspace } from '~/composables/glossary-workspace'
import { getRequestErrorMessage } from '~/utils/request-error'
import type { GlossaryDecision, GlossaryProposal } from '#shared/types/editor-dictionary'

useAstralPageSeo('공통 용어집')
const workspace = useGlossaryWorkspace()
const { loggedIn, user, dictionaries, dictionaryId, tab, search, page, statusFilter, archived, entries, proposals, loading, error, selection, selectedProposal, currentProposalEntry, comparisonError, detail, history, formOpen, editingEntry, isReviewer, deciding, init, load, runSearch, selectEntry, propose, showHistory, decide, createDictionary } = workspace
const createOpen = ref(false)
const dictionaryName = ref('공통 번역 기준')
const creating = ref(false)
const createError = ref('')
const reason = ref('')
const reasonAction = ref<GlossaryDecision>('hold')
const reasonOpen = ref(false)
const reasonProposal = ref<GlossaryProposal | null>(null)
const statusNames = { pending: '제안 대기', held: '보류', approved: '확정', rejected: '반려', withdrawn: '철회' }
const actionNames: Record<GlossaryDecision, string> = { approve: '확정', hold: '보류', reject: '반려', resume: '검토 재개', withdraw: '철회' }
const reviewBlockReason = computed(() => {
  if (selectedProposal.value?.entryId && currentProposalEntry.value && selectedProposal.value.baseRevision !== currentProposalEntry.value.revision) return '현행 기준이 변경됐습니다. 최신판으로 다시 제안해 주세요.'
  if (selectedProposal.value?.metadata.semanticReview === 'unresolved') return '의미 차이를 정리한 뒤 다시 제안해 주세요.'
  return ''
})
const totalPages = computed(() => tab.value === 'proposals' ? proposals.value?.totalPages ?? 1 : entries.value?.totalPages ?? 1)
const formKind = computed(() => tab.value === 'voice' ? 'voice' as const : 'term' as const)
onMounted(init)
function refreshOnFocus() {
  if (!formOpen.value && !reasonOpen.value && !creating.value && !deciding.value) void init()
}
onMounted(() => window.addEventListener('focus', refreshOnFocus))
onUnmounted(() => window.removeEventListener('focus', refreshOnFocus))
async function create() {
  if (creating.value) return
  creating.value = true
  createError.value = ''
  try {
    await createDictionary(dictionaryName.value)
    createOpen.value = false
  } catch (cause) {
    createError.value = getRequestErrorMessage(cause, '공통 용어집을 만들지 못했습니다.')
  } finally {
    creating.value = false
  }
}
function askDecision(action: 'hold' | 'reject') {
  if (!selectedProposal.value) return
  reasonProposal.value = selectedProposal.value
  reasonAction.value = action
  reason.value = ''
  reasonOpen.value = true
}
async function submitReason() {
  if (!reasonProposal.value) return
  if (await decide(reasonAction.value, reason.value, reasonProposal.value)) reasonOpen.value = false
}
</script>

<template>
  <div class="mx-auto flex max-w-400 flex-col gap-5">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold">
          공통 용어집
        </h1>
      </div>
      <div class="flex gap-2">
        <UButton to="/translate/editor" color="neutral" variant="soft">
          번역 에디터
        </UButton><UButton
          v-if="isReviewer"
          color="neutral"
          variant="soft"
          @click="createOpen = true"
        >
          공통 용어집 만들기
        </UButton><UButton
          v-if="dictionaryId"
          color="info"
          variant="soft"
          @click="propose()"
        >
          {{ tab === 'voice' ? '문체 제안' : '용어 제안' }}
        </UButton>
      </div>
    </header>
    <p class="text-xs text-muted">
      일본어 기준 · 중국어 의미 대조
    </p>
    <div class="flex flex-wrap items-center gap-3">
      <USelect
        v-model="dictionaryId"
        :items="dictionaries.map(dictionary => ({ label: dictionary.name, value: dictionary.id }))"
        placeholder="공통 용어집 선택"
        aria-label="공통 용어집 선택"
        class="min-w-56"
      /><UButton
        color="neutral"
        variant="ghost"
        icon="i-tabler-refresh"
        :loading="loading"
        @click="init"
      >
        새로고침
      </UButton>
    </div>
    <UTabs
      v-model="tab"
      :content="false"
      :items="[{ label: '용어', value: 'term' }, { label: '캐릭터 문체', value: 'voice' }, { label: '제안·검토', value: 'proposals' }]"
      class="w-fit"
      color="neutral"
    />
    <div v-if="tab !== 'proposals'" class="flex flex-wrap items-center gap-2">
      <UInput
        v-model="search"
        aria-label="용어 검색"
        placeholder="한국어·일본어·중국어·과거 표기 검색"
        icon="i-tabler-search"
        :maxlength="200"
        class="min-w-48 flex-1"
        @keydown.enter="runSearch"
      /><UButton color="neutral" variant="soft" @click="runSearch">
        검색
      </UButton><UCheckbox v-model="archived" label="보관된 기준" />
    </div>
    <USelect
      v-else
      v-model="statusFilter"
      :items="Object.entries(statusNames).map(([value, label]) => ({ label, value }))"
      aria-label="제안 상태"
      class="w-48"
    />
    <UAlert v-if="error" color="error" :title="error" />
    <AppLoadingSpinner v-if="loading" class="self-center" />
    <div v-else-if="error && !entries && !proposals" class="py-8 text-center">
      <UButton color="neutral" variant="soft" @click="init">
        다시 불러오기
      </UButton>
    </div>
    <p v-else-if="!dictionaryId" class="py-10 text-center text-muted">
      공통 용어집이 없습니다. 검수 담당자가 만들 수 있습니다.
    </p>
    <p v-else-if="tab === 'proposals' && !loggedIn" class="py-10 text-center text-muted">
      로그인하면 검토 기록을 볼 수 있습니다.
    </p>
    <div v-else-if="tab !== 'proposals'" class="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <section class="overflow-auto border border-default">
        <table class="w-full text-left text-sm">
          <thead class="bg-muted text-xs text-muted">
            <tr>
              <th class="p-3">
                {{ tab === 'voice' ? '캐릭터' : '한국어' }}
              </th><th class="p-3">
                {{ tab === 'voice' ? '기본 문체' : '일본어' }}
              </th><th class="p-3">
                {{ tab === 'voice' ? '대표 대사' : '중국어' }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="entry in entries?.entries ?? []"
              :key="entry.id"
              class="border-t border-default"
              :class="selection?.id === entry.id ? 'bg-elevated' : ''"
            >
              <td class="p-3">
                <button class="text-left font-medium text-info hover:underline" @click="selectEntry(entry)">
                  {{ entry.translation }}
                </button><p class="mt-1 text-xs text-dimmed">
                  {{ entry.metadata.archived ? '보관' : '확정' }} · v{{ entry.revision }}
                </p>
              </td><td class="p-3 whitespace-pre-wrap">
                {{ tab === 'voice' ? entry.metadata.speechStyle : entry.metadata.japanese || '미등록' }}
              </td><td class="p-3 whitespace-pre-wrap">
                {{ tab === 'voice' ? entry.metadata.exampleTranslation : entry.metadata.chineseSimplified || entry.metadata.chineseTraditional || '미등록' }}
              </td>
            </tr>
          </tbody>
        </table><p v-if="!entries?.entries.length" class="p-8 text-center text-muted">
          {{ search ? '검색 결과가 없습니다.' : archived ? '보관된 기준이 없습니다.' : '등록된 기준이 없습니다.' }}
        </p>
      </section>
      <aside v-if="selection" class="border border-default">
        <div class="flex flex-wrap gap-2 border-b border-default p-3">
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            @click="detail = 'overview'"
          >
            개요
          </UButton><UButton
            size="xs"
            color="neutral"
            variant="ghost"
            @click="detail = 'usage'"
          >
            사용처
          </UButton><UButton
            size="xs"
            color="neutral"
            variant="ghost"
            @click="showHistory"
          >
            결정 이력
          </UButton>
        </div>
        <GlossaryEntryDetails
          v-if="detail === 'overview'"
          :entry="selection"
          @propose="propose(selection)"
          @usage="detail = 'usage'"
          @history="showHistory"
        />
        <GlossaryUsages v-else-if="detail === 'usage'" :entry="selection" />
        <div v-else class="flex flex-col gap-4 p-4 text-sm">
          <p class="text-xs text-muted">
            최근 50건 · 전체 기록은 제안·검토에서 확인
          </p>
          <article v-for="proposal in history" :key="proposal.id" class="border-b border-default pb-3">
            <p>{{ statusNames[proposal.status] }} · {{ new Date(proposal.createdAt).toLocaleString('ko-KR') }}</p>
            <GlossaryEntryDetails
              :entry="{ translation: proposal.translation, note: proposal.note, metadata: proposal.metadata, revision: proposal.baseRevision + 1 }"
              hide-actions
              :proposed="proposal.status !== 'approved'"
            />
            <p v-for="(event, index) in proposal.history" :key="index" class="mt-2 text-xs text-muted">
              {{ actionNames[event.action] }}<span v-if="event.reason"> · {{ event.reason }}</span> · {{ new Date(event.at).toLocaleString('ko-KR') }}
            </p>
          </article><p v-if="!history.length" class="text-muted">
            처리 이력이 없습니다.
          </p>
        </div>
      </aside>
    </div>
    <div v-else class="grid items-start gap-5 xl:grid-cols-2">
      <section class="border border-default">
        <button
          v-for="proposal in proposals?.proposals ?? []"
          :key="proposal.id"
          class="block w-full border-b border-default p-4 text-left hover:bg-elevated"
          :class="selectedProposal?.id === proposal.id ? 'bg-elevated' : ''"
          @click="selectedProposal = proposal"
        >
          <span class="font-medium">{{ proposal.translation }}</span><UBadge class="ml-3" color="neutral" variant="soft">
            {{ statusNames[proposal.status] }}
          </UBadge><p class="mt-2 text-sm text-muted">
            {{ proposal.note }}
          </p>
        </button><p v-if="!proposals?.proposals.length" class="p-8 text-center text-muted">
          해당 상태의 제안이 없습니다.
        </p>
      </section>
      <aside v-if="selectedProposal" class="flex flex-col gap-4 border border-default p-4 text-sm">
        <h2 class="font-semibold">
          {{ selectedProposal.translation }} · {{ statusNames[selectedProposal.status] }}
        </h2><p>비교 기준: {{ selectedProposal.baseRevision ? `v${selectedProposal.baseRevision}` : '신규 등록' }}</p>
        <div class="grid gap-3" :class="currentProposalEntry ? '2xl:grid-cols-2' : ''">
          <section v-if="currentProposalEntry" class="border border-default">
            <h3 class="px-4 pt-3 text-xs text-dimmed">
              현행 기준
            </h3>
            <GlossaryEntryDetails :entry="currentProposalEntry" hide-actions />
          </section><section class="border border-info">
            <h3 class="text-xs text-dimmed">
              <span class="block px-4 pt-3">{{ selectedProposal.entryId ? '변경 제안' : '신규 등록 제안' }}</span>
            </h3>
            <GlossaryEntryDetails
              :entry="{ translation: selectedProposal.translation, note: selectedProposal.note, metadata: selectedProposal.metadata, revision: selectedProposal.baseRevision + 1 }"
              hide-actions
              proposed
            />
          </section>
        </div>
        <UAlert v-if="comparisonError" color="warning" title="현행 기준을 불러오지 못했습니다." />
        <UAlert v-if="reviewBlockReason && ['pending', 'held'].includes(selectedProposal.status)" color="warning" :title="reviewBlockReason" />
        <p class="text-xs text-muted">
          {{ selectedProposal.creatorHandle || '참여자' }} 제안
        </p>
        <div v-if="isReviewer && selectedProposal.status === 'pending'" class="flex flex-wrap gap-2">
          <UButton
            color="info"
            :loading="deciding"
            :disabled="Boolean(reviewBlockReason) || (Boolean(selectedProposal.entryId) && (!currentProposalEntry || comparisonError))"
            @click="decide('approve', '')"
          >
            확정
          </UButton><UButton
            color="neutral"
            variant="soft"
            :disabled="deciding"
            @click="askDecision('hold')"
          >
            보류
          </UButton><UButton
            color="error"
            variant="soft"
            :disabled="deciding"
            @click="askDecision('reject')"
          >
            반려
          </UButton>
        </div>
        <UButton
          v-if="isReviewer && selectedProposal.status === 'held'"
          color="info"
          :loading="deciding"
          @click="decide('resume', '')"
        >
          검토 재개
        </UButton><UButton
          v-if="user?.id === selectedProposal.createdBy && ['pending', 'held'].includes(selectedProposal.status)"
          color="neutral"
          variant="ghost"
          :disabled="deciding"
          @click="decide('withdraw', '')"
        >
          제안 철회
        </UButton>
        <div v-for="(event, index) in selectedProposal.history" :key="index" class="border-t border-default pt-3 text-xs text-muted">
          {{ actionNames[event.action] }}<span v-if="event.reason"> · {{ event.reason }}</span> · {{ new Date(event.at).toLocaleString('ko-KR') }}
        </div>
      </aside>
    </div>
    <div v-if="totalPages > 1" class="flex items-center justify-center gap-3">
      <UButton color="neutral" :disabled="page <= 1 || loading" @click="page--">
        이전
      </UButton><span>{{ page }} / {{ totalPages }}</span><UButton color="neutral" :disabled="page >= totalPages || loading" @click="page++">
        다음
      </UButton>
    </div>
    <GlossaryEntryForm
      v-model:open="formOpen"
      :dictionary-id="dictionaryId"
      :kind="formKind"
      :entry="editingEntry"
      @submitted="load"
    />
    <UModal
      v-model:open="createOpen"
      :dismissible="!creating"
      :close="!creating"
      title="공통 용어집 만들기"
      description="모든 참여자에게 공개됩니다."
    >
      <template #body>
        <form id="create-team-dictionary" class="flex flex-col gap-3" @submit.prevent="create">
          <UInput
            v-model="dictionaryName"
            aria-label="공통 용어집 이름"
            :maxlength="100"
            :disabled="creating"
            class="w-full"
          /><UAlert v-if="createError" color="error" :title="createError" />
        </form>
      </template><template #footer>
        <UButton
          type="submit"
          form="create-team-dictionary"
          color="info"
          :loading="creating"
        >
          만들기
        </UButton>
      </template>
    </UModal>
    <UModal
      v-model:open="reasonOpen"
      :dismissible="!deciding"
      :close="!deciding"
      :title="reasonAction === 'hold' ? '보류 사유' : '반려 사유'"
      :description="reasonProposal?.translation"
    >
      <template #body>
        <form id="glossary-decision" class="flex flex-col gap-3" @submit.prevent="submitReason">
          <UTextarea
            v-model="reason"
            aria-label="처리 사유와 재검토 조건"
            :maxlength="1000"
            class="w-full"
            :rows="4"
            :disabled="deciding"
          /><UAlert v-if="error" color="error" :title="error" />
        </form>
      </template><template #footer>
        <UButton
          type="submit"
          form="glossary-decision"
          color="info"
          :loading="deciding"
          :disabled="!reason.trim()"
        >
          기록
        </UButton>
      </template>
    </UModal>
  </div>
</template>
