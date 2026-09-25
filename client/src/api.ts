// Сессия истекла или пользователя удалили: AuthProvider слушает это событие,
// сбрасывает пользователя, и RequireAuth уводит на страницу входа
export const SESSION_EXPIRED_EVENT = "runrehab:session-expired";

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (options?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    credentials: "include",
    ...options,
    headers
  });

  if (!response.ok) {
    if (response.status === 401 && !url.startsWith("/api/auth/")) {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    const data = await response.json().catch(() => ({ message: "Request failed" }));
    throw new Error(data.message ?? "Request failed");
  }

  return response.json();
}
