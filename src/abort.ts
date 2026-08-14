export function abortError(): DOMException {
  return new DOMException('This operation was aborted', 'AbortError');
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

/** Resolves after `ms`, or rejects with AbortError if `signal` fires first. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Settles `promise`, or rejects with AbortError as soon as `signal` fires. */
export async function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) reject(abortError());
        else resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(signal.aborted ? abortError() : error);
      }
    );
  });
}
