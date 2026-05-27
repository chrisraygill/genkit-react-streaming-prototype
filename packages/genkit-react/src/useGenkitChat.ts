import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useGenkitStream,
  type StreamStatus,
  type UseGenkitStreamOptions,
} from './useGenkitStream.js';
import {
  applyChunk,
  emptyAgentState,
  flushInFlightToolsToError,
  type AgentState,
  type GenerateResponseChunkData,
  type ToolCall,
} from './reducer.js';

export interface UseGenkitChatResult<I = unknown, O = unknown> {
  /** Final flow output, populated when `status === 'done'`. */
  output: O | null;
  /** Raw streamed chunks (escape hatch for custom rendering). */
  chunks: GenerateResponseChunkData[];
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
 * Chat- and agent-shaped hook over `useGenkitStream`. Assumes the server flow
 * forwards `ai.generate({ onChunk: c => sendChunk(c.toJSON()) })` so each chunk
 * follows the `GenerateResponseChunkData` shape (`{ role, index, content[] }`).
 *
 * Adds the following derived reactive state on top of `useGenkitStream`:
 *
 *   - `text`       — accumulated text deltas
 *   - `reasoning`  — accumulated reasoning deltas (extended-thinking models)
 *   - `toolCalls`  — `ToolCall[]` keyed by `ref`, with `state: 'call' | 'result' | 'error'`
 *
 * For non-chat flows (progress events, custom stream schemas, etc.) use
 * `useGenkitStream` directly.
 */
export function useGenkitChat<I = unknown, O = unknown>(
  options: UseGenkitStreamOptions
): UseGenkitChatResult<I, O> {
  const base = useGenkitStream<I, O, GenerateResponseChunkData>(options);

  // Incrementally reduce chunks into agent state. Keep a ref so we can
  // detect when the upstream chunks array was reset (e.g. on submit).
  const lastSeenCountRef = useRef(0);
  const [agentState, setAgentState] = useState<AgentState>(emptyAgentState);

  useEffect(() => {
    if (base.chunks.length < lastSeenCountRef.current) {
      // Reset case — fresh submit cleared the chunks.
      lastSeenCountRef.current = 0;
      setAgentState(emptyAgentState());
      return;
    }
    if (base.chunks.length === lastSeenCountRef.current) return;
    const newChunks = base.chunks.slice(lastSeenCountRef.current);
    lastSeenCountRef.current = base.chunks.length;
    setAgentState((prev) => newChunks.reduce(applyChunk, prev));
  }, [base.chunks]);

  // When the upstream stream errors, flush any in-flight tool calls so UI
  // cards don't get stuck in their loading state forever.
  useEffect(() => {
    if (base.status === 'error') {
      setAgentState((prev) => flushInFlightToolsToError(prev));
    }
  }, [base.status]);

  // Reset agent state when the consumer calls reset().
  const resetWrapper = useMemo(
    () => () => {
      lastSeenCountRef.current = 0;
      setAgentState(emptyAgentState());
      base.reset();
    },
    [base.reset]
  );

  return {
    output: base.output,
    chunks: base.chunks,
    text: agentState.text,
    reasoning: agentState.reasoning,
    toolCalls: agentState.toolCalls,
    status: base.status,
    error: base.error,
    submit: base.submit,
    abort: base.abort,
    reset: resetWrapper,
  };
}
