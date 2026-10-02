const KEY = "write:password";
const SESSION = "write:session";

export function sessionPassword(): string {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function sessionToken(): string {
  try {
    return sessionStorage.getItem(SESSION) ?? "";
  } catch {
    return "";
  }
}

export function rememberSession(token: string): void {
  try {
    if (token) {
      sessionStorage.setItem(SESSION, token);
    } else {
      sessionStorage.removeItem(SESSION);
    }
  } catch {
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
