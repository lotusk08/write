<script setup lang="ts">
import { computed, ref } from "vue";
import { PasswordRejected } from "../../lib/api.ts";
import { participantColor, participantName } from "../../lib/participants.ts";
import Icon from "../Icon.vue";
import SignIn from "../SignIn.vue";
import type { ShareState } from "../types.ts";
import { useSignIn } from "../useSignIn.ts";

const props = defineProps<{ state: ShareState; copied?: boolean }>();
const emit = defineEmits<{ name: [name: string]; copy: []; disable: []; signedIn: [] }>();

const { password, asking, signIn, signedIn, forget } = useSignIn();
const problem = ref("");

const submit = async () => {
  problem.value = "";
  try {
    await signIn();
    emit("signedIn");
  } catch (cause) {
    if (cause instanceof PasswordRejected) {
      forget();
    }
    problem.value = cause instanceof Error ? cause.message : String(cause);
  }
};

const others = computed(() => props.state.peers.filter((peer) => !peer.you));
const mine = computed(() => props.state.peers.find((peer) => peer.you)?.color ?? participantColor(props.state.name));

const onBlur = () => {
  if (!props.state.name.trim()) {
    emit("name", participantName());
  }
};
</script>

<template>
  <div class="share-panel">
    <p v-if="state.error" class="notice warn">{{ state.error }}</p>
    <SignIn
      v-if="asking && !state.sharing"
      id="share-password"
      v-model="password"
      @submit="submit"
      @session="(token) => (signedIn(token), emit('signedIn'))"
      @error="(message) => (problem = message)"
    />
    <p v-if="problem" class="notice warn">{{ problem }}</p>

    <template v-if="state.sharing">
      <div class="share-row">
        <label class="peer is-you" title="Your name, as the others see it — tap to change it">
          <span class="peer-dot" :style="{ background: mine }" />
          <input
            class="peer-name"
            :value="state.name"
            :style="{ width: `${Math.max(6, state.name.length) + 0.5}ch` }"
            maxlength="40"
            placeholder="Your name"
            aria-label="Your name, as the others see it"
            @input="emit('name', ($event.target as HTMLInputElement).value)"
            @blur="onBlur"
          />
          <span class="peer-you">(you)</span>
        </label>
        <button
          type="button"
          :class="['btn', 'icon', { 'is-done': copied }]"
          :disabled="!state.link"
          :title="copied ? 'Link copied' : 'Copy the share link'"
          :aria-label="copied ? 'Link copied' : 'Copy the share link'"
          @click="emit('copy')"
        >
          <Icon :name="copied ? 'check' : 'link'" />
        </button>
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

      <div v-if="others.length > 0" class="peers" role="group" aria-label="Also here">
        <span v-for="peer in others" :key="peer.key" class="peer">
          <span class="peer-dot" :style="{ background: peer.color }" />
          {{ peer.name }}
        </span>
      </div>
    </template>
  </div>
</template>
