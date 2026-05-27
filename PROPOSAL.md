# Proposal: First-party frontend adapters for Genkit

**Status:** Draft
**Author:** (tbd)
**Date:** 2026-05-27
**Prototype:** <https://github.com/chrisraygill/genkit-react-streaming-prototype>

## Summary

Ship thin, framework-native client packages (`@genkit-ai/react`, `@genkit-ai/vue`, `@genkit-ai/svelte`, `@genkit-ai/angular`) that wrap the existing `streamFlow` primitive from `genkit/beta/client` and expose idiomatic reactive APIs (hooks, runes, signals, composables) for streaming Genkit flows in the browser.

The streaming protocol, tool-call chunk shape, and transport are already implemented in core. What's missing is the last-mile binding between `AsyncIterable<chunk>` and each framework's reactive state model. Today every Genkit user reinvents this glue.

## Motivation

Genkit's `streamFlow` already emits everything a rich agent UI needs: text deltas, `toolRequest` parts (name + streaming args), `toolResponse` parts (results), reasoning chunks, and progressively-parsed structured output. Consuming this in a frontend today requires:

1. Manually iterating the async iterable inside a `useEffect` / `onMount` / `ngOnInit`,
2. Hand-rolling reducers to key tool calls by `ref` and merge partial input deltas,
3. Tracking pending vs. resolved tool state,
4. Wiring cancellation, error boundaries, and reconnection,
5. Repeating all of the above for every framework, in every sample app.

Developers evaluating Genkit against LangChain or the Vercel AI SDK hit this wall on day one. Their docs ship a `useStream()` / `useChat()` and a "tool calling" page with a live embed; ours points at `for await` loops.

## Prior art

### LangChain `useStream` (`@langchain/langgraph-sdk/react`)

Docs: [LangGraph `useStream` React integration guide](https://langchain-ai.github.io/langgraphjs/cloud/how-tos/use_stream_react/) · [API reference](https://reference.langchain.com/javascript/langchain-langgraph-sdk/react/useStream)

LangChain's React hook for LangGraph agents exposes a reactive `toolCalls` array:

```ts
const stream = useStream<AgentState>({
  apiUrl: AGENT_URL,
  assistantId: "tool_calling",
});

// stream.messages, stream.toolCalls, stream.isLoading, stream.submit(...)
```

Each tool call surfaces as `{ id, name, args, result, state }` and updates in place as the agent emits tool requests and the runtime fulfils them. Their docs render every tool call as a typed UI card, with loading / error states handled by the hook.

Notable: LangChain is React-only for `useStream`. Their multi-SDK story in the UI patterns gallery (React / Vue / Svelte / Angular tabs) is delivered via iframe embeds of separate playground apps, not a true multi-framework client SDK.

### Vercel AI SDK (`@ai-sdk/react`, `@ai-sdk/vue`, `@ai-sdk/svelte`)

Docs: [`useChat` API reference](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat) · [Chatbot Tool Usage guide](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage)

Vercel ships first-party adapters for three frameworks, all wrapping the same wire protocol:

```ts
const { messages, toolCalls, addToolResult, sendMessage, status, error } =
  useChat({ api: "/api/chat" });
```

Capabilities the hook handles for you:
- Streaming text deltas merged into message bubbles
- Tool-call state tracking (`call` → `result`)
- **Client-side tool execution** via `addToolResult` (server requests, browser fulfils)
- Multi-turn message history
- Abort / regenerate
- Optimistic user-message rendering
- Error surfacing and retry

Both ecosystems prove out the same shape: a reactive primitive yielding `{ messages, toolCalls, status, submit, abort }` is the minimum viable agent-UI hook. Genkit has the underlying machinery, but ships no equivalent surface.

## Proposal

Publish a small family of adapter packages, each ~200-400 LOC, all delegating to the same `streamFlow` core:

| Package | Primary API |
|---------|-------------|
| `@genkit-ai/react` | `useGenkitStream()`, `useGenkitFlow()` hooks |
| `@genkit-ai/vue` | `useGenkitStream()` composable returning `ref`s |
| `@genkit-ai/svelte` | `createGenkitStream()` returning `$state` runes (Svelte 5) + store fallback |
| `@genkit-ai/angular` | `GenkitStreamService` exposing `signal()`s and RxJS observables |

Shared signature shape (framework-specific reactive primitives in parens):

```ts
const {
  output,        // (reactive) final flow output, null until done
  chunks,        // (reactive) array of all streamed chunks
  toolCalls,     // (reactive) keyed Map<ref, { name, input, output?, state }>
  text,          // (reactive) accumulated text delta string
  status,        // 'idle' | 'streaming' | 'done' | 'error'
  error,         // (reactive) Error | null
  submit,        // (input) => void
  abort,         // () => void
} = useGenkitStream<FlowType>({ url: '/api/chat' });
```

Type inference flows from the server flow definition (the same `typeof myFlow` pattern users already write).

### Non-goals

- A bespoke wire protocol. We use whatever `streamFlow` already emits.
- A `<Chat />` component. Adapters expose primitives; UI components are downstream.

## Capability inventory: what's possible today

The following table is grounded in the Genkit 1.35.0 source. Each capability is rated:

- **(A) Works today** with `streamFlow` if a flow forwards `generateStream` chunks via `sendChunk`
- **(B) Needs minor flow-author code or thin adapter wrapper** (no core changes)
- **(C) Needs server-side protocol or core changes** to ship cleanly

| # | Capability | Status | Notes |
|---|---|---|---|
| 1 | Text streaming | A | `GenerateResponseChunk.text` getter concatenates text parts ([chunk.ts:73-75](https://github.com/firebase/genkit/blob/main/js/ai/src/generate/chunk.ts#L73-L75)). |
| 2a | Tool requests (with partial streaming args) | A | `chunk.toolRequests` getter ([chunk.ts:129-133](https://github.com/firebase/genkit/blob/main/js/ai/src/generate/chunk.ts#L129-L133)); `ToolRequest.partial?: boolean` flag exists in schema ([parts.ts:89-90](https://github.com/firebase/genkit/blob/main/js/ai/src/parts.ts#L89-L90)). |
| 2b | Tool responses | B | No `toolResponses` convenience getter on `GenerateResponseChunk`. Adapter must filter `chunk.content` for `part.toolResponse`. Trivial wrapper; arguably should be added to core for symmetry. |
| 3 | Reasoning / thinking chunks | A | `chunk.reasoning` getter ([chunk.ts:81-83](https://github.com/firebase/genkit/blob/main/js/ai/src/generate/chunk.ts#L81-L83)); `ReasoningPart` in part schema union ([parts.ts:45-55, 196](https://github.com/firebase/genkit/blob/main/js/ai/src/parts.ts#L45-L55)). |
| 4 | Partial structured output streaming | A (with caveat) | `chunk.output` getter uses `extractJson()` / `parsePartialJson()` for lenient partial parses ([chunk.ts:139-142](https://github.com/firebase/genkit/blob/main/js/ai/src/generate/chunk.ts#L139-L142), [extract.ts:23-25](https://github.com/firebase/genkit/blob/main/js/ai/src/extract.ts#L23-L25)). Caveat: parsing is client-side only; no schema validation on partial chunks. |
| 5 | Cancellation / abort | A | `streamFlow({ abortSignal })` plumbs through to `fetch(..., { signal })` ([client.ts:54-55, 113](https://github.com/firebase/genkit/blob/main/js/genkit/src/client/client.ts#L54-L55)). Express handler aborts the action on `request.on('close')`. |
| 6 | Resume by `streamId` | A (with prerequisite) | `streamFlow({ streamId })` sends `x-genkit-stream-id` header ([client.ts:69](https://github.com/firebase/genkit/blob/main/js/genkit/src/client/client.ts#L69)); express handler calls `streamManager.subscribe(streamId, ...)` if present. Requires the server to configure a `StreamManager` (not default). |
| 7 | Multi-turn chat state | A (server-side only) | `Session` and `Chat` classes ([session.ts](https://github.com/firebase/genkit/blob/main/js/ai/src/session.ts), [chat.ts](https://github.com/firebase/genkit/blob/main/js/ai/src/chat.ts)) persist threads via `SessionStore`. The flow author must wire session loading per-request; nothing the hook can do client-side beyond passing a thread ID. |
| 8 | Type inference from flow definition | B | `streamFlow<O, S>()` generics ([client.ts:39](https://github.com/firebase/genkit/blob/main/js/genkit/src/client/client.ts#L39)) take output and stream types but do not infer them from a `Flow<I, O, S>`. Adapter packages can extract via conditional types so callers write `useGenkitStream<typeof myFlow>()`. |
| 9 | Interrupts / human-in-the-loop | B/C | `interrupt()` throws `ToolInterruptError` ([tool.ts:482-530](https://github.com/firebase/genkit/blob/main/js/ai/src/tool.ts#L482-L530)) which surfaces as a tool request with metadata in the final response, not as a distinguished stream chunk type. Detecting "paused, awaiting input" client-side today requires the flow author to emit a custom chunk on catch. A dedicated chunk type in core would be cleaner. |
| 10 | Trace URLs in dev | C | Non-streaming responses set `x-genkit-trace-id` ([express/src/index.ts:142-143](https://github.com/firebase/genkit/blob/main/js/plugins/express/src/index.ts#L142-L143)) but streaming responses do not. A `{ trace: { id, url } }` chunk type (or a leading SSE event) would need to be added to surface trace links reactively. |

### Translation to adapter capabilities

What this lets us ship in the v1 adapter, beyond tool-call streaming:

1. **Text streaming with batching** (1) — coalesce per-frame deltas to avoid reconciliation thrash.
2. **Reasoning panes** (3) — expose `reasoning` as a separate reactive field.
3. **Generative UI from `outputSchema`** (4) — expose `partialOutput` so forms render as JSON streams in.
4. **Cancellation** (5) — `abort()` wired through `AbortSignal`.
5. **Resume / multi-tab** (6) — optional `resumeId` param when the server configures `StreamManager`.
6. **Multi-turn chat helper** (7) — `useGenkitChat()` variant that bundles a thread ID and message history, leaning on server-side `Session` for persistence.
7. **End-to-end types** (8) — `useGenkitStream<typeof myFlow>()` infers input, output, and chunk types.
8. **Optimistic UI, error states, status machine** — pure adapter-layer concerns, no core dependency.
9. **Testing primitives** — a `MockGenkitStream` helper for unit-testing UI behavior against scripted chunk sequences.

Each is a few dozen lines once the core adapter exists. Without it, every Genkit app reimplements the subset it needs.

### Items deferred to follow-up proposals

- **Trace URLs in streamed responses (10)** — small core change; would let dev-mode UIs render a "View trace" link per run, matching what LangChain's embed does with LangSmith.
- **First-class interrupt chunk type (9)** — would let `useGenkitStream` expose `pendingInterrupts` and a `resume(payload)` callback without flow-author boilerplate.
- **Client-side tool execution** — neither verified nor proposed here. Worth scoping if there's user demand for browser-fulfilled tools (auth tokens, local capabilities).

## Risks and open questions

- **API surface drift across frameworks.** Solve with a shared `@genkit-ai/client-core` package (or extension of `genkit/beta/client`) that owns the reducer; framework packages are thin reactive shells.
- **Versioning.** Adapter packages need to track core `genkit` SemVer. Monorepo + synchronized releases (already the pattern) makes this manageable.
- **Maintenance cost of four frameworks.** Realistic minimum is React + one other (Vue or Svelte) at launch, with Angular and additional frameworks following demand. The core reducer is the expensive part; per-framework shells are cheap.

## Findings from the prototype

Building [the prototype](https://github.com/chrisraygill/genkit-react-streaming-prototype) end-to-end (verified in a browser with Playwright) surfaced two issues worth folding into the design discussion:

1. **The hook's reducer must flush in-flight tool calls when the stream errors.** A tool throwing mid-stream produces no `toolResponse` chunk; the naive reducer leaves the UI card stuck in `state: 'call'` forever. Fix: in the error branch, map all in-flight `'call'` entries to `'error'`. Trivial once observed, but easy to miss without an end-to-end test that exercises the tool-error path. Worth baking into the official adapter from day one (and into the suggested `MockGenkitStream` test fixture).

2. **`UserFacingError` thrown from inside a tool currently gets sanitized to `"INTERNAL: Internal Error"` on the wire**, even though `getCallableJSON` correctly serializes the same error when invoked directly. The express handler ([`plugins/express/src/index.ts:218-222`](https://github.com/firebase/genkit/blob/main/js/plugins/express/src/index.ts#L218-L222)) calls `getCallableJSON(e)`, which checks `instanceof GenkitError` and should return `{status, message}` from `toJSON()` — but something in the tool-execution pipeline ([`ai/src/generate/resolve-tool-requests.ts:175-198`](https://github.com/firebase/genkit/blob/main/js/ai/src/generate/resolve-tool-requests.ts#L175-L198)) strips the `GenkitError` identity before it reaches the handler. This is a Genkit-core friction item, not an adapter concern, but **worth filing upstream** — tool authors today can't produce useful client-facing error messages no matter what hook is consuming the stream.

## Next steps

1. ~~Prototype `@genkit-ai/react` as a standalone repo with a working sample app that demonstrates tool-call card rendering end-to-end.~~ ✅ Done: <https://github.com/chrisraygill/genkit-react-streaming-prototype>
2. Port `js/testapps/next` to use the prototype hook; measure LOC reduction and DX delta.
3. Draft a docs page mirroring LangChain's "Tool calling" pattern, using the new hook.
4. Decide on launch framework set (recommend: React + Svelte for v1; Vue + Angular in a follow-up).
5. File follow-up proposals for streamed trace URLs and a dedicated interrupt chunk type.
6. File the `UserFacingError`-from-tool sanitization bug against Genkit core.
