<script setup lang="ts">
import { participantName } from "../../lib/participants.ts";
import type { ShareState } from "../types.ts";

const props = defineProps<{ state: ShareState }>();
const emit = defineEmits<{ name: [name: string]; disable: [] }>();

const onBlur = () => {
  if (!props.state.name.trim()) {
    emit("name", participantName());
  }
};
</script>

<template>
  <div class="share-panel">
    <p v-if="state.error" class="notice warn">{{ state.error }}</p>

    <template v-if="state.sharing">
      <input
        class="input"
        :value="state.name"
        maxlength="40"
        placeholder="Your name"
        aria-label="Your name, as the others see it"
        @input="emit('name', ($event.target as HTMLInputElement).value)"
        @blur="onBlur"
      />

      <div v-if="state.peers.length > 0" class="peers" role="group" aria-label="Here now">
        <span v-for="peer in state.peers" :key="peer.key" class="peer">
          <span class="peer-dot" :style="{ background: peer.color }" />
          {{ peer.name }}{{ peer.you ? " (you)" : "" }}
        </span>
      </div>

      <div v-if="state.link" class="share-link">
        <input
          class="input mono"
          readonly
          aria-label="Share link"
          :value="state.link"
          @focus="($event.target as HTMLInputElement).select()"
        />
        <button
          type="button"
          class="btn danger"
          :disabled="state.busy"
          :title="state.owner ? 'End the link for everyone; your copy stays here' : 'Leave; the share stays live for the others'"
          @click="emit('disable')"
        >
          {{ state.owner ? "Stop" : "Leave" }}
        </button>
      </div>
    </template>
  </div>
</template>
