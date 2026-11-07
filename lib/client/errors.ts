/** User-facing client errors. Never include keys, invite tokens, or incident plaintext. */
export function clientErrorMessage(cause: unknown): string {
  if (cause instanceof Error) {
    const message = cause.message.trim();
    if (message.length > 0 && message.length <= 240 && !/[\r\n]/.test(message)) return message;
  }
  return "The incident client could not complete that action.";
}
