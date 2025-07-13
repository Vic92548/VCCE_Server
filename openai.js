import 'dotenv/config';
import { OpenAI } from "openai";

// Initial API Key Load
let apiKey = process.env.OPENAI_API_KEY || null;
if (!apiKey) {
  console.warn("[openai] ⚠️ OPENAI_API_KEY env var not set – AI features will be disabled until provided by client.");
} else {
  console.debug("[openai] ✅ API key loaded from environment.");
}

/**
 * Check if API key is currently set
 * @returns {boolean}
 */
export function hasApiKey() {
  const state = !!apiKey;
  console.debug(`[openai] hasApiKey: ${state}`);
  return state;
}

/**
 * Set API key programmatically
 * @param {string} key 
 */
export function setApiKey(key) {
  apiKey = key;
  console.log('[openai] 🔐 API key set via client');
}

/**
 * Wrapper around the OpenAI chat completion endpoint.
 * Logs key input/output data for debugging.
 * @param {Array<{role: 'system'|'user'|'assistant', content: string}>} messages
 * @param {object} [opts]
 * @returns {Promise<string>} assistant reply
 */
export async function chat(messages, opts = {}) {
  if (!apiKey) {
    console.error("[openai] ❌ No API key configured – cannot perform chat completion.");
    return "⚠️ OPENAI_API_KEY is not configured on the server.";
  }

  const openai = new OpenAI({ apiKey });
  console.debug("[openai] 🔄 Sending chat completion request with the following options:", {
    model: opts.model || "gpt-4.1-2025-04-14",
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.max_tokens ?? 50000,
    messageCount: messages.length,
    messageSample: messages.slice(-2), // show last two messages for context
  });

  try {
    const resp = await openai.chat.completions.create({
      model: opts.model || "gpt-4.1-2025-04-14",
      messages,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.max_tokens ?? 32000,
    });

    const output = resp.choices?.[0]?.message?.content ?? "";
    console.debug("[openai] ✅ Chat completion successful. Output length:", output.length);
    return output;

  } catch (err) {
    console.error("[openai] ❌ Error during chat completion:", err);
    return "⚠️ An error occurred while communicating with OpenAI.";
  }
}
