import type { ToolCall } from '@genkit-react-proto/react';

export function ToolCardGeneric({ toolCall }: { toolCall: ToolCall }) {
  return (
    <div className="tool-card-generic">
      <div className="name">
        {toolCall.name} {toolCall.state === 'call' ? '(running...)' : '(done)'}
      </div>
      <pre>input: {JSON.stringify(toolCall.input, null, 2)}</pre>
      {toolCall.output !== undefined && (
        <pre>output: {JSON.stringify(toolCall.output, null, 2)}</pre>
      )}
    </div>
  );
}
