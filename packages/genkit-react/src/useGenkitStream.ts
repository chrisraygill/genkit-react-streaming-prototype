import { useCallback, useEffect, useRef, useState } from 'react';
import { streamFlow } from 'genkit/beta/client';

export type StreamStatus = 'idle' | 'streaming' | 'done' | 'error';

export interface UseGenkitStreamOptions {
  /** URL of the deployed Genkit flow. */
  url: string;
  /** Optional headers (auth, etc.) forwarded to every request. */
  headers?: Record<string, string>;
}

export interface UseGenkitStreamResult<I = unknown, O = unknown, S = unknown> {
  /** Final flow output, populated when `status === 'done'`. */
  output: O | null;
  /** Raw streamed chunks in arrival order — whatever the flow's `streamSchema` emits. */
  chunks: S[];
  /** Current state machine position. */
  status: StreamStatus;
  /** Last error, if any. */
  error: Error | null;
  /** Submit input to the flow. Cancels any in-flight stream first. */
  submit: (input: I) => void;
  /** Cancel the in-flight stream. */
  abort: () => void;
  /** Clear all accumulated state. */
  reset: () => void;
}

/**
 * Generic React hook over `streamFlow` from `genkit/beta/client`. Plumbs
 * any Genkit flow's streaming response into reactive state without making
 * assumptions about chunk shape.
 *
 * If your flow forwards `ai.generate({ onChunk: c => sendChunk(c.toJSON()) })`
 * and you want `text` / `toolCalls` / `reasoning` derived for you, use
 * `useGenkitChat` instead. This hook is for flows with custom stream
 * schemas (progress events, structured deltas, custom events, etc.).
 */
export function useGenkitStream<I = unknown, O = unknown, S = unknown>(
  options: UseGenkitStreamOptions
): UseGenkitStreamResult<I, O, S> {
  const { url, headers } = options;

  const [output, setOutput] = useState<O | null>(null);
  const [chunks, setChunks] = useState<S[]>([]);
  const [status, setStatus] = useState<StreamStatus>('idle');
  const [error, setError] = useState<Error | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setOutput(null);
    setChunks([]);
    setStatus('idle');
    setError(null);
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus((s) => (s === 'streaming' ? 'idle' : s));
  }, []);

  const submit = useCallback(
    (input: I) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setOutput(null);
      setChunks([]);
      setError(null);
      setStatus('streaming');

      const { output: outputPromise, stream } = streamFlow<O, S>({
        url,
        input,
        headers,
        abortSignal: controller.signal,
      });

      (async () => {
        try {
          for await (const chunk of stream) {
            setChunks((prev) => [...prev, chunk]);
          }
          const finalOutput = await outputPromise;
          setOutput(finalOutput);
          setStatus('done');
        } catch (err) {
          if (controller.signal.aborted) return;
          setError(err instanceof Error ? err : new Error(String(err)));
          setStatus('error');
        }
      })();
    },
    [url, headers]
  );

  useEffect(() => () => abortRef.current?.abort(), []);

  return { output, chunks, status, error, submit, abort, reset };
}
