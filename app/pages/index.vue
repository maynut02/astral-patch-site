<template>
  <div class="flex flex-col">
    <div class="relative">
      <video v-once autoplay muted loop playsinline preload="metadata" aria-hidden="true" class="-mt-19 block w-full">
        <source src="https://file.maynutlab.com/pv.mp4" type="video/mp4">
      </video>

      <div aria-hidden="true" class="absolute inset-0 bg-linear-to-t from-default to-transparent" />
    </div>
  </div>
</template>
