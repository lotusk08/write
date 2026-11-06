import { computed, ref } from "vue";
import { login } from "../lib/api.ts";
import { rememberSession, sessionToken } from "../lib/password.ts";

const password = ref("");
const session = ref(sessionToken());
const rejected = ref(0);
const asking = computed(() => !session.value || rejected.value > 0);

const signedIn = (token: string) => {
  rememberSession(token);
  session.value = token;
  password.value = "";
  rejected.value = 0;
};

const signIn = async () => {
  if (asking.value) {
    signedIn(await login(password.value));
  }
};

const forget = () => {
  rejected.value += 1;
  password.value = "";
  session.value = "";
  rememberSession("");
};

export function useSignIn() {
  return { password, rejected, asking, signIn, signedIn, forget };
}
