import { expressHandler } from '@genkit-ai/express';
import cors from 'cors';
import express from 'express';
import { chatFlow } from './weatherFlow.js';

const app = express();
app.use(cors());
app.use(express.json());

app.post('/chat', expressHandler(chatFlow));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const PORT = Number(process.env.PORT ?? 3400);
app.listen(PORT, () => {
  console.log(`Genkit server listening on http://localhost:${PORT}`);
  console.log(`  POST /chat   - streaming weather chat flow`);
});
