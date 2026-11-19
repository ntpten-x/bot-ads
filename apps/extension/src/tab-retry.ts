const TRANSIENT_TAB_EDIT =
  /Tabs cannot be edited right now \(user may be dragging a tab\)\.?/i;

export function isTransientTabEditError(error: unknown) {
  return (
    error instanceof Error && TRANSIENT_TAB_EDIT.test(error.message.trim())
  );
}

export async function retryTabEdit<T>(
  operation: () => Promise<T>,
  options: {
    attempts?: number;
    baseDelayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
) {
  const attempts = Math.max(1, options.attempts ?? 4);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 350);
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      attempt++;
      if (!isTransientTabEditError(error) || attempt >= attempts) throw error;
      await sleep(Math.min(2_000, baseDelayMs * 2 ** (attempt - 1)));
    }
  }
}
