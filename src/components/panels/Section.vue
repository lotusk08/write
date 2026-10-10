<script setup lang="ts">
defineProps<{ title: string }>();
</script>

<template>
  <section class="section">
    <h3 class="section-title">{{ title }}</h3>
    <slot />
  </section>
</template>
