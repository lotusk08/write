import { computed, ref } from "vue";
import { rememberPassword, rememberSession, sessionPassword, sessionToken } from "../lib/password.ts";

const saved = ref(sessionPassword());
const password = ref(saved.value);
const session = ref(sessionToken());
const rejected = ref(0);
const asking = computed(() => (!saved.value && !session.value) || rejected.value > 0);

const credential = () => (asking.value ? password.value : saved.value);

const accepted = () => {
  if (asking.value) {
    rememberPassword(password.value);
    saved.value = password.value;
    rejected.value = 0;
  }
};

const signedIn = (token: string) => {
  rememberSession(token);
  session.value = token;
  rejected.value = 0;
};

const forget = () => {
  rejected.value += 1;
  password.value = "";
  saved.value = "";
  session.value = "";
  rememberPassword("");
  rememberSession("");
};

export function useSignIn() {
  return { password, rejected, asking, credential, accepted, signedIn, forget };
}
