# Genkit React Streaming Prototype

A working prototype of a first-party React adapter (`useGenkitStream`) over [Genkit's](https://genkit.dev) `streamFlow` client. Demonstrates streaming **tool calls** end-to-end, rendered as a typed UI card the moment the model requests a tool and updated again when the result lands.

The bundled sample is a weather agent: ask "what's the weather in Tokyo?", watch the `getWeather` tool call stream in (as a loading card), then resolve with live data from the [Open-Meteo](https://open-meteo.com) API.

See [`PROPOSAL.md`](./PROPOSAL.md) for the full design proposal this prototype validates.

## Why this exists

Genkit's `streamFlow` already emits everything needed for a rich agent UI — text deltas, tool requests (with streaming partial args), tool responses, reasoning chunks, and progressively-parsed structured output. But there's no framework-native binding, so every Genkit user writes the same `useState` + `for await` glue. This repo is a ~200-line proof that a real `useGenkitStream` hook closes the gap with no core changes required.

## Layout

```
.
├── server/                     Genkit + Express server with a weather agent flow
├── packages/genkit-react/      The useGenkitStream hook (the proposed adapter)
└── web/                        React + Vite sample that consumes the hook
```

## Run it

You need Node 20+ and a [Google AI Studio API key](https://aistudio.google.com/app/apikey) (free tier works fine).

```bash
npm install

# 1. Start the Genkit server (port 3400)
cd server
cp .env.example .env
# edit .env and add GEMINI_API_KEY=...
npm run dev

# 2. In a second terminal, start the React app (port 5173)
cd web
npm run dev
```

Open <http://localhost:5173> and ask about the weather somewhere.

## What to look at

**[`packages/genkit-react/src/useGenkitStream.ts`](./packages/genkit-react/src/useGenkitStream.ts)** — the entire hook. ~200 lines including types. Wraps `streamFlow` from `genkit/beta/client` and reduces chunks into:

```ts
const { text, toolCalls, status, error, submit, abort } = useGenkitStream<
  { prompt: string },
  string
>({ url: '/chat' });
```

Each entry in `toolCalls` is `{ id, name, input, output?, state: 'call' | 'result' | 'error' }` and updates in place as the stream progresses.

**[`web/src/App.tsx`](./web/src/App.tsx)** — usage. The interesting bit is the dispatch on tool name:

```tsx
{toolCalls.map((tc) =>
  tc.name === 'getWeather'
    ? <WeatherCard key={tc.id} toolCall={tc} />
    : <ToolCardGeneric key={tc.id} toolCall={tc} />
)}
```

**[`web/src/components/WeatherCard.tsx`](./web/src/components/WeatherCard.tsx)** — the typed UI card. Renders a loading state from the streaming tool input (`toolCall.input.location`), then upgrades to a full forecast when `toolCall.output` arrives.

**[`server/src/weatherFlow.ts`](./server/src/weatherFlow.ts)** — the flow + tool. Key line that makes streaming work:

```ts
await ai.generate({
  model: MODEL,
  tools: [getWeather],
  prompt,
  onChunk: (chunk) => sendChunk(chunk.toJSON()),
});
```

That `sendChunk` forward is the entire server-side contract. Genkit handles tool execution automatically; both the tool request and tool response arrive as chunks the client can observe.

## Verified end-to-end

Verified in a browser (Playwright + headless Chromium) and via curl. See [`PROPOSAL.md`](./PROPOSAL.md) for the full capability matrix with file:line citations into the Genkit source.

Confirmed working:

- Text streaming, merged into a single bubble as deltas arrive
- Tool requests rendered as a loading card from the streamed input (`Tokyo`) before the tool runs
- Tool responses upgrading the same card in place with real data
- Cancellation via `AbortController` (Stop button returns the hook to `idle` with no leaked late chunks)
- Tool errors surface as a card in `state: 'error'` (red tint, "Could not load forecast") rather than spinning forever
- Empty / whitespace input correctly disables the Send button
- Zero React console warnings, zero page errors across happy path + 3 probes

Not yet wired in this prototype (but possible with the existing protocol): reasoning chunks, partial structured output, multi-turn chat, resume-by-streamId.

### Known limitations / friction found while building

- **Tool-thrown `UserFacingError` messages get sanitized to `"INTERNAL: Internal Error"` on the wire.** The tool throws a descriptive message ("Could not find a location named X. Try a city name like..."), but the express handler sends back the generic INTERNAL fallback. `getCallableJSON` recognizes the same error correctly when called directly, so something in the tool-execution path strips the `GenkitError` identity before it reaches the handler. Filed as a finding in PROPOSAL.md to be raised upstream against Genkit core. The prototype's hook correctly transitions the tool-call card to `error` state regardless, so the UX still degrades gracefully.

### The hook bug we found

The first browser verification caught a real bug in the hook's reducer: when a tool threw mid-stream, the resulting `ToolCall` got stuck in `state: 'call'` forever because no `toolResponse` chunk ever arrived. The fix (in [`useGenkitStream.ts`](./packages/genkit-react/src/useGenkitStream.ts) `submit`'s catch block) is to map all in-flight `'call'` entries to `'error'`. Trivial in retrospect, but easy to miss without an end-to-end test that exercises the tool-error path. Worth baking into the official adapter from day one.

## Status

This is a **prototype** for design discussion, not a published package. The `@genkit-react-proto/react` name is a placeholder. If this approach lands, the real package would live in the Genkit monorepo as `@genkit-ai/react` and a `@genkit-ai/client-core` reducer would be factored out so Vue / Svelte / Angular adapters share the same logic.

## License

Apache 2.0
