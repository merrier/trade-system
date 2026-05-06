export function toJsonText(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function fromJsonText<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
