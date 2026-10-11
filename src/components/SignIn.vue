<script setup lang="ts">
import { ref } from "vue";
import { addPasskey, passkeysAvailable, signInWithPasskey } from "../lib/passkey.ts";

const password = defineModel<string>({ required: true });
defineProps<{ id: string; disabled?: boolean }>();
const emit = defineEmits<{ submit: []; session: [token: string]; error: [message: string] }>();

const field = ref<HTMLInputElement | null>(null);
const busy = ref(false);
const canPasskey = passkeysAvailable();

const withPasskey = async (ceremony: () => Promise<string | null>) => {
  busy.value = true;
  try {
    const token = await ceremony();
    if (token) {
      emit("session", token);
    }
  } catch (cause) {
    emit("error", cause instanceof Error ? cause.message : String(cause));
  } finally {
    busy.value = false;
  }
};

defineExpose({ focus: () => field.value?.focus() });
</script>

<template>
  <div class="field sign-in">
    <label :for="id">Password</label>
    <div class="password-row">
      <input
        :id="id"
        ref="field"
        v-model="password"
        class="input"
        type="password"
        autocomplete="current-password"
        :autofocus="!canPasskey"
        placeholder="••••••••"
        @keydown.enter.prevent="emit('submit')"
      />
      <button v-if="canPasskey" type="button" class="btn" :disabled="disabled || busy" @click="withPasskey(signInWithPasskey)">
        Passkey
      </button>
    </div>
    <button
      v-if="canPasskey && password"
      type="button"
      class="btn tiny save-passkey"
      :disabled="disabled || busy"
      @click="withPasskey(() => addPasskey(password))"
    >
      Save a passkey on this device
    </button>
  </div>
</template>
