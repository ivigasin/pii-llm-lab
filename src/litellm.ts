/**
 * Any model behind a LiteLLM proxy (or any OpenAI-compatible endpoint).
 *   LITELLM_BASE_URL   default http://localhost:4000
 *   LITELLM_API_KEY    the proxy key
 */
import type { ChatModel, ChatRequest, ChatResponse } from './model.js';

export class LiteLLMModel implements ChatModel {
  constructor(
    readonly name: string,
    private readonly baseUrl = process.env.LITELLM_BASE_URL ?? 'http://localhost:4000',
    private readonly apiKey = process.env.LITELLM_API_KEY ?? '',
    private readonly temperature = process.env.TEMPERATURE === undefined ? undefined : Number(process.env.TEMPERATURE),
  ) {}

  async chat({ messages, tools }: ChatRequest): Promise<ChatResponse> {
    const body: Record<string, unknown> = { model: this.name, messages, tools, tool_choice: 'auto' };
    if (this.temperature !== undefined) body.temperature = this.temperature;
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${this.name}: HTTP ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { choices: { message: ChatResponse }[] };
    const message = json.choices[0]?.message;
    return { content: message?.content ?? null, tool_calls: message?.tool_calls?.length ? message.tool_calls : undefined };
  }
}
