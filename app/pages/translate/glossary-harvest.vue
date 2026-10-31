<script setup lang="ts">
import { useGlossaryHarvest } from '~/composables/glossary-harvest'
import { getEditorItemLocation } from '~/utils/editor-links'

useAstralPageSeo('용어 일괄 정리')
const { loggedIn, isReviewer, dictionaryId, dictionary, corpus, category, page, selectedSources, drafts, activeId, active, loading, extracting, importing, exporting, submitting, busy, error, message, storageError, importOpen, importJson, selected, sources, init, load, changePage, changeCategory, extract, openImport, previewImport, submit, download, exportCandidates, exportCorpus, remove } = useGlossaryHarvest()
const activeIndex = computed(() => drafts.value.findIndex(row => row.requestId === activeId.value))
const statusNames = { submitted: '검토 대기', duplicate: '기존 항목 대조', error: '등록 실패' }
function exportPrompt() {
  if (!corpus.value) return
  // 선택된 근거만 보내도록 서버가 생성한 프롬프트의 마지막 JSON을 바꾼다.
  const lines = corpus.value.prompt.split('\n')
  lines[lines.length - 1] = JSON.stringify({ sources: sources.value })
  download(`glossary-prompt-${page.value}.txt`, lines.join('\n'), 'text/plain')
}
</script>

<template>
  <div class="mx-auto flex max-w-400 flex-col gap-5">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold">
          용어 일괄 정리
        </h1>
        <p class="mt-1 text-sm text-muted">
          {{ dictionary?.name }}<span v-if="dictionary"> · </span>확정 번역 → 후보 대조 → 검토 대기
        </p>
      </div>
      <UButton :to="{ path: '/translate/glossary', query: { dictionary: dictionaryId || undefined } }" color="neutral" variant="soft">
        용어집으로
      </UButton>
    </header>
    <p v-if="!loggedIn || !isReviewer" class="py-10 text-center text-muted">
      검수 담당자로 로그인해 주세요.
    </p>
    <p v-else-if="!dictionaryId" class="py-10 text-center text-muted">
      용어집에서 일괄 정리를 열어 주세요.
    </p>
    <template v-else>
      <UAlert v-if="error && !importOpen" color="error" :title="error" />
      <UAlert v-if="storageError" color="warning" :title="storageError" />
      <p v-if="message" role="status" class="text-sm text-muted">
        {{ message }}
      </p>
      <AppLoadingSpinner v-if="loading && !dictionary" class="self-center" />
      <UButton
        v-if="!dictionary && !loading"
        color="neutral"
        variant="soft"
        class="self-start"
        @click="init"
      >
        다시 불러오기
      </UButton>
      <template v-if="dictionary">
        <section class="flex flex-col gap-3 border border-default p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="font-semibold">
              확정 번역 <span v-if="corpus" class="text-sm font-normal text-muted">{{ corpus.total }}개 · {{ page }}/{{ corpus.totalPages }}쪽</span>
            </h2>
            <div class="flex flex-wrap gap-2">
              <USelect
                :model-value="category ? 'file:' + category : 'all'"
                :items="[{ label: '전체 파일', value: 'all' }, ...(corpus?.categories ?? []).map(row => ({ label: row.category + ' (' + row.total + ')', value: 'file:' + row.category }))]"
                :disabled="busy"
                aria-label="추출할 파일"
                class="min-w-48"
                @update:model-value="value => changeCategory(value === 'all' ? '' : value.slice(5))"
              />
              <UButton
                icon="i-tabler-refresh"
                aria-label="확정 번역 새로고침"
                color="neutral"
                variant="ghost"
                :disabled="busy"
                @click="load"
              />
            </div>
          </div>
          <AppLoadingSpinner v-if="loading" class="self-center" />
          <details v-else-if="corpus?.sources.length">
            <summary class="cursor-pointer text-sm text-muted">
              근거 번역 {{ sources.length }}/{{ corpus.sources.length }}개 선택
            </summary>
            <div class="mt-3 grid max-h-80 gap-3 overflow-auto">
              <article v-for="source in corpus.sources" :key="source.itemId" class="border-t border-default pt-3 text-sm">
                <div class="flex items-start gap-2">
                  <UCheckbox
                    :model-value="selectedSources.includes(source.itemId)"
                    :disabled="busy"
                    :aria-label="source.category + '_' + source.unitKey + ' 선택'"
                    @update:model-value="value => selectedSources = value ? [...selectedSources, source.itemId] : selectedSources.filter(id => id !== source.itemId)"
                  />
                  <NuxtLink
                    :to="getEditorItemLocation(source)"
                    target="_blank"
                    rel="noopener"
                    class="font-mono text-xs text-info hover:underline"
                  >
                    {{ source.category }}_{{ source.unitKey }} ↗
                  </NuxtLink>
                </div>
                <p class="mt-2 whitespace-pre-wrap break-words text-muted">
                  {{ source.jp || source.cnS || source.cnT }}
                </p>
                <p class="mt-1 whitespace-pre-wrap break-words">
                  {{ source.ko }}
                </p>
              </article>
            </div>
          </details>
          <p v-else-if="corpus" class="text-sm text-muted">
            현재 원문에 확정된 번역이 없습니다.
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <UButton
              color="info"
              :loading="extracting"
              :disabled="busy || !sources.length || !corpus?.aiConfigured"
              @click="extract"
            >
              AI로 후보 추출
            </UButton>
            <UButton
              color="neutral"
              variant="soft"
              :loading="exporting"
              :disabled="busy || !corpus?.total"
              @click="exportCorpus"
            >
              확정 번역 전체 내보내기
            </UButton>
            <UButton
              color="neutral"
              variant="soft"
              :disabled="busy || !sources.length"
              @click="exportPrompt"
            >
              프롬프트 내보내기
            </UButton>
            <UButton
              color="neutral"
              variant="soft"
              :disabled="busy"
              @click="openImport"
            >
              후보 JSON 가져오기
            </UButton>
            <span v-if="corpus && !corpus.aiConfigured" class="text-xs text-muted">서버 AI 미설정 · 외부 정리 후 가져오기 가능</span>
            <div class="ml-auto flex gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                :disabled="busy || page <= 1"
                @click="changePage(page - 1)"
              >
                이전
              </UButton>
              <UButton
                color="neutral"
                variant="ghost"
                :disabled="busy || !corpus || page >= corpus.totalPages"
                @click="changePage(page + 1)"
              >
                다음
              </UButton>
            </div>
          </div>
        </section>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="font-semibold">
            후보 {{ drafts.length }}개
          </h2>
          <div class="flex flex-wrap items-center gap-2">
            <UButton
              v-if="drafts.length"
              color="neutral"
              variant="ghost"
              :disabled="busy"
              @click="exportCandidates"
            >
              후보 JSON 보관
            </UButton>
            <UButton
              :to="{ path: '/translate/glossary', query: { dictionary: dictionaryId, tab: 'proposals', status: 'pending' } }"
              target="_blank"
              color="neutral"
              variant="soft"
            >
              제안·검토 ↗
            </UButton>
            <UButton
              color="info"
              :loading="submitting"
              :disabled="busy || !selected.length || selected.length > 20"
              @click="submit"
            >
              선택 {{ selected.length }}개 검토 대기로
            </UButton>
          </div>
        </div>
        <p v-if="selected.length > 20" role="alert" class="text-sm text-error">
          한 번에 20개까지 등록할 수 있습니다.
        </p>
        <p v-if="!drafts.length" class="border border-default py-10 text-center text-sm text-muted">
          확정 번역에서 후보를 추출하거나 정리한 JSON을 가져와 주세요.
        </p>
        <div v-else class="grid items-start gap-4 lg:grid-cols-[minmax(15rem,0.7fr)_minmax(0,1.3fr)]">
          <section class="max-h-160 overflow-auto border border-default">
            <button
              v-for="candidate in drafts"
              :key="candidate.requestId"
              :disabled="busy"
              class="block w-full border-b border-default p-4 text-left text-sm hover:bg-elevated"
              :class="activeId === candidate.requestId ? 'bg-elevated' : ''"
              @click="activeId = candidate.requestId"
            >
              <span class="font-medium">{{ candidate.translation }}</span>
              <span class="ml-2 text-xs text-muted">{{ candidate.result ? statusNames[candidate.result.status] : candidate.selected ? '등록 대상' : '대조 전' }}</span>
              <p class="mt-1 break-words text-muted">
                {{ [candidate.japanese, candidate.chineseSimplified, candidate.chineseTraditional].filter(Boolean).join(' · ') }}
              </p>
              <p class="mt-1 text-xs text-dimmed">
                {{ candidate.scope === 'project' ? '전체' : candidate.source.category }}
              </p>
            </button>
          </section>
          <GlossaryHarvestCandidate
            v-if="active && activeIndex >= 0 && drafts[activeIndex]"
            :key="active.requestId"
            v-model="drafts[activeIndex]!"
            :dictionary-id="dictionaryId"
            :busy="busy"
            @remove="remove(active.requestId)"
          />
        </div>
      </template>
    </template>
    <UModal
      v-model:open="importOpen"
      title="후보 JSON 가져오기"
      description="검증 후 후보 목록에 추가합니다."
      :dismissible="!importing"
      :close="!importing"
    >
      <template #body>
        <UAlert
          v-if="error"
          color="error"
          :title="error"
          class="mb-3"
        />
        <UTextarea
          v-model="importJson"
          aria-label="후보 JSON"
          placeholder="{&quot;candidates&quot;: [{&quot;itemId&quot;: &quot;근거 itemId&quot;, &quot;translation&quot;: &quot;한국어&quot;, &quot;japanese&quot;: &quot;日本語&quot;, &quot;chineseSimplified&quot;: &quot;&quot;, &quot;chineseTraditional&quot;: &quot;&quot;, &quot;note&quot;: &quot;의미·대조 메모&quot;}]}"
          :maxlength="100000"
          :rows="12"
          :disabled="importing"
          class="w-full font-mono text-xs"
        />
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="importing"
            @click="importOpen = false"
          >
            취소
          </UButton>
          <UButton
            color="info"
            :loading="importing"
            :disabled="!importJson.trim()"
            @click="previewImport"
          >
            검증하고 가져오기
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
