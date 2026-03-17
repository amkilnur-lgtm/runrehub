export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {})
    },
    ...options
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({ message: "Request failed" }));
    throw new Error(data.message ?? "Request failed");
  }

  return response.json();
}
