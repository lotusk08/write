/**
 * The publish password, held for the session.
 *
 * It used to be remembered in Settings, which meant forever: anyone at an
 * unlocked phone could publish, indefinitely, because its owner typed the
 * password once in March. Session storage is the browser's own idea of "until
 * this tab is done" — closing the tab, or the app going away on a phone, is
 * what forgets it. So each sitting starts with one prompt, and a device that
 * left your hands stops publishing on its own.
 *
 * Nothing else keeps it: not Settings, not the Worker, nowhere it has to be
 * cleaned out of.
 */

const KEY = "write:password";

export function sessionPassword(): string {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberPassword(password: string): void {
  try {
    if (password) {
      sessionStorage.setItem(KEY, password);
    } else {
      sessionStorage.removeItem(KEY);
    }
  } catch {
    // Private browsing can refuse writes; the dialog just asks next time too.
  }
}
