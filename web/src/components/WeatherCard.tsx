import type { ToolCall } from '@genkit-react-proto/react';

interface WeatherToolInput {
  location?: string;
}

interface WeatherToolOutput {
  location: string;
  latitude: number;
  longitude: number;
  temperatureC: number;
  windKph: number;
  conditions: string;
}

export function WeatherCard({ toolCall }: { toolCall: ToolCall }) {
  const input = (toolCall.input ?? {}) as WeatherToolInput;
  const output = toolCall.output as WeatherToolOutput | undefined;
  const isLoading = toolCall.state === 'call';
  const isError = toolCall.state === 'error';

  return (
    <div className={`weather-card ${isLoading ? 'loading' : ''} ${isError ? 'errored' : ''}`}>
      <div className="tool-label">Tool call · getWeather</div>
      <div className="location">
        {output?.location ?? input.location ?? 'Locating...'}
      </div>
      {output ? (
        <>
          <div className="temp">{Math.round(output.temperatureC)}°C</div>
          <div className="conditions">{output.conditions}</div>
          <div className="meta">
            <span>Wind {Math.round(output.windKph)} km/h</span>
            <span>
              {output.latitude.toFixed(2)}, {output.longitude.toFixed(2)}
            </span>
          </div>
        </>
      ) : isError ? (
        <div className="spinner">Could not load forecast</div>
      ) : (
        <div className="spinner">Fetching forecast…</div>
      )}
    </div>
  );
}
