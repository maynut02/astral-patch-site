<template>
  <div
    class="pointer-events-none sticky top-16 z-30 flex justify-center md:top-4"
    role="status"
    aria-live="polite"
  >
    <div class="absolute flex items-center gap-2 bg-elevated/80 px-3 py-2 text-sm text-muted shadow-sm backdrop-blur-lg">
      <UIcon
        name="i-tabler-loader-2"
        class="size-4 animate-spin"
      />
      <span>불러오는 중</span>
    </div>
  </div>
</template>
