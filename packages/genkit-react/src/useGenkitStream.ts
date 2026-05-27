import { useCallback, useEffect, useRef, useState } from 'react';
import { streamFlow } from 'genkit/beta/client';

/**
 * Shape of a streamed chunk as serialized by `GenerateResponseChunk.toJSON()`
 * on the server. This is the raw wire format; the hook reduces it into
 * higher-level state below.
 */
export interface GenkitChunk {
  role: 'model' | 'tool' | string;
  index: number;
  content: Array<{
    text?: string;
    reasoning?: string;
    toolRequest?: {
      name: string;
      input?: unknown;
      ref?: string;
      partial?: boolean;
    };
    toolResponse?: {
      name: string;
      output?: unknown;
      ref?: string;
    };
    [k: string]: unknown;
  }>;
  custom?: unknown;
}

export type ToolCallState = 'call' | 'result' | 'error';

export interface ToolCall<I = unknown, O = unknown> {
  /** Stable identifier: model-provided `ref`, or synthetic `${name}#${index}`. */
  id: string;
  name: string;
  input: I;
  output?: O;
  state: ToolCallState;
}

export type StreamStatus = 'idle' | 'streaming' | 'done' | 'error';

export interface UseGenkitStreamOptions {
  /** URL of the deployed Genkit flow. */
  url: string;
  /** Optional headers (auth, etc.) forwarded to every request. */
  headers?: Record<string, string>;
}

export interface UseGenkitStreamResult<I = unknown, O = unknown> {
  /** Final flow output, populated when `status === 'done'`. */
  output: O | null;
  /** Raw streamed chunks, in arrival order. Useful for debugging or custom rendering. */
  chunks: GenkitChunk[];
  /** Accumulated text delta from `role: 'model'` chunks. */
  text: string;
  /** Accumulated reasoning delta (extended-thinking models). */
  reasoning: string;
  /** Tool calls keyed by id, in invocation order. */
  toolCalls: ToolCall[];
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
 * Subscribes to a Genkit flow's streaming response and exposes reactive state
 * for text, tool calls, reasoning, status, and errors. Wraps `streamFlow` from
 * `genkit/beta/client`.
 */
export function useGenkitStream<I = unknown, O = unknown>(
  options: UseGenkitStreamOptions
): UseGenkitStreamResult<I, O> {
  const { url, headers } = options;

  const [output, setOutput] = useState<O | null>(null);
  const [chunks, setChunks] = useState<GenkitChunk[]>([]);
  const [text, setText] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [status, setStatus] = useState<StreamStatus>('idle');
  const [error, setError] = useState<Error | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setOutput(null);
    setChunks([]);
    setText('');
    setReasoning('');
    setToolCalls([]);
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
      setText('');
      setReasoning('');
      setToolCalls([]);
      setError(null);
      setStatus('streaming');

      const { output: outputPromise, stream } = streamFlow<O, GenkitChunk>({
        url,
        input,
        headers,
        abortSignal: controller.signal,
      });

      (async () => {
        try {
          for await (const chunk of stream) {
            applyChunk(chunk, {
              setChunks,
              setText,
              setReasoning,
              setToolCalls,
            });
          }
          const finalOutput = await outputPromise;
          setOutput(finalOutput);
          setStatus('done');
        } catch (err) {
          if (controller.signal.aborted) {
            return;
          }
          setError(err instanceof Error ? err : new Error(String(err)));
          setStatus('error');
        }
      })();
    },
    [url, headers]
  );

  // Cancel on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  return {
    output,
    chunks,
    text,
    reasoning,
    toolCalls,
    status,
    error,
    submit,
    abort,
    reset,
  };
}

function applyChunk(
  chunk: GenkitChunk,
  setters: {
    setChunks: React.Dispatch<React.SetStateAction<GenkitChunk[]>>;
    setText: React.Dispatch<React.SetStateAction<string>>;
    setReasoning: React.Dispatch<React.SetStateAction<string>>;
    setToolCalls: React.Dispatch<React.SetStateAction<ToolCall[]>>;
  }
) {
  setters.setChunks((prev) => [...prev, chunk]);

  for (const part of chunk.content ?? []) {
    if (typeof part.text === 'string' && part.text.length > 0) {
      setters.setText((prev) => prev + part.text);
    }
    if (typeof part.reasoning === 'string' && part.reasoning.length > 0) {
      setters.setReasoning((prev) => prev + part.reasoning);
    }
    if (part.toolRequest) {
      const tr = part.toolRequest;
      const id = tr.ref ?? `${tr.name}#${chunk.index}`;
      setters.setToolCalls((prev) => {
        const next = [...prev];
        const idx = next.findIndex((tc) => tc.id === id);
        const entry: ToolCall = {
          id,
          name: tr.name,
          input: tr.input,
          state: 'call',
        };
        if (idx === -1) {
          next.push(entry);
        } else {
          // Merge partial args into the existing entry.
          next[idx] = { ...next[idx], input: tr.input ?? next[idx].input };
        }
        return next;
      });
    }
    if (part.toolResponse) {
      const tr = part.toolResponse;
      const id = tr.ref ?? `${tr.name}#${chunk.index}`;
      setters.setToolCalls((prev) => {
        const next = [...prev];
        // Match on ref if available; otherwise fall back to most recent
        // call with the same name in `call` state.
        let idx = next.findIndex((tc) => tc.id === id);
        if (idx === -1) {
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].name === tr.name && next[i].state === 'call') {
              idx = i;
              break;
            }
          }
        }
        if (idx === -1) {
          next.push({
            id,
            name: tr.name,
            input: undefined,
            output: tr.output,
            state: 'result',
          });
        } else {
          next[idx] = { ...next[idx], output: tr.output, state: 'result' };
        }
        return next;
      });
    }
  }
}
