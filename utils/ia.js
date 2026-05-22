const Anthropic = require('@anthropic-ai/sdk');

// Timeout predeterminado para llamadas de texto. Para visión usar CLAUDE_VISION_TIMEOUT_MS.
const AI_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS) || 30_000;

let _client = null;

function getClient() {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('Falta ANTHROPIC_API_KEY');
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: AI_TIMEOUT_MS });
  }
  return _client;
}

/**
 * Envuelve una Promise con un timeout. Rechaza si la operación tarda más de `ms`.
 * Compatible con cualquier versión del SDK (no depende de AbortController del SDK).
 */
function withTimeout(promise, ms, label = 'Llamada IA') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} superó el límite de ${ms / 1000}s`)), ms)
    ),
  ]);
}

async function generateText(prompt, maxTokens = 450) {
  const response = await getClient().beta.messages.create({
    model: process.env.CLAUDE_MODEL || 'claude-opus-4-6',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  return response.content[0].text;
}

module.exports = { generateText, getClient, withTimeout };
