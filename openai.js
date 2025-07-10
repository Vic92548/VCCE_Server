import 'dotenv/config';
import { OpenAI } from "openai";

let apiKey = process.env.OPENAI_API_KEY || null;
if (!apiKey) {
  console.warn("[openai] OPENAI_API_KEY env var not set – AI features will be disabled until provided by client.");
}

export function hasApiKey() {
  return !!apiKey;
}

export function setApiKey(key) {
  apiKey = key;
  console.log('[openai] API key set via client');
}

/**
 * Wrapper around the OpenAI chat completion endpoint.
 * @param {Array<{role: 'system'|'user'|'assistant', content: string}>} messages
 * @param {object} [opts]
 * @returns {Promise<string>} assistant reply
 */
export async function chat(messages, opts = {}) {
  if (!apiKey) {
    return "⚠️ OPENAI_API_KEY is not configured on the server.";
  }
  const openai = new OpenAI({ apiKey });
  const resp = await openai.chat.completions.create({
    model: opts.model || "gpt-4o-mini", // smaller + cheaper by default
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.max_tokens ?? 4000,
  });
  return resp.choices?.[0]?.message?.content ?? "";
}

