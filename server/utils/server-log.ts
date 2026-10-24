export function logServerError(scope: string, message: string, error: unknown): void {
  console.error(`[${scope}] ${message}`, error)
}
