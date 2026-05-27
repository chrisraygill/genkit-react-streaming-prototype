import { useState } from 'react';
import { useGenkitStream } from '@genkit-react-proto/react';
import { WeatherCard } from './components/WeatherCard.js';
import { ToolCardGeneric } from './components/ToolCardGeneric.js';

const API_URL =
  (import.meta.env.VITE_GENKIT_URL as string | undefined) ??
  'http://localhost:3400/chat';

const SUGGESTIONS = [
  "What's the weather in Tokyo?",
  'Compare the weather in San Francisco and New York.',
  'Is it raining in London right now?',
];

export default function App() {
  const [input, setInput] = useState('');
  const { text, toolCalls, status, error, submit, abort } = useGenkitStream<
    { prompt: string },
    string
  >({ url: API_URL });

  const isStreaming = status === 'streaming';

  const handleSubmit = (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed || isStreaming) return;
    setInput('');
    submit({ prompt: trimmed });
  };

  return (
    <div className="app">
      <h1>Genkit React Streaming Prototype</h1>
      <p className="subtitle">
        Type a weather question. The agent streams text + tool calls; the{' '}
        <code>useGenkitStream</code> hook reduces them into reactive state.
      </p>

      <div className="input-row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit(input);
          }}
          placeholder="Ask about the weather..."
          disabled={isStreaming}
        />
        {isStreaming ? (
          <button className="abort" onClick={abort}>
            Stop
          </button>
        ) : (
          <button onClick={() => handleSubmit(input)} disabled={!input.trim()}>
            Send
          </button>
        )}
      </div>

      {status === 'idle' && toolCalls.length === 0 && !text && (
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              className="suggestion"
              onClick={() => handleSubmit(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className={`status ${status}`}>{status}</div>

      {error && (
        <div className="error-bubble">
          <strong>Error:</strong> {error.message}
        </div>
      )}

      {toolCalls.map((tc) =>
        tc.name === 'getWeather' ? (
          <WeatherCard key={tc.id} toolCall={tc} />
        ) : (
          <ToolCardGeneric key={tc.id} toolCall={tc} />
        )
      )}

      {text && <div className="text-bubble">{text}</div>}
    </div>
  );
}
