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
  }
}
