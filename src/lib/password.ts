const SESSION = "write:session";

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
