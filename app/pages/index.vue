<script setup lang="ts">
</script>

<template>
  <div class="flex flex-col">
    <div class="relative">
      <video v-once autoplay muted loop playsinline class="-mt-19">
        <source src="https://file.maynutlab.com/pv.mp4" type="video/mp4">
      </video>

      <div class="absolute inset-0 bg-linear-to-t from-default to-transparent">

      </div>
    </div>
  </div>
</template>