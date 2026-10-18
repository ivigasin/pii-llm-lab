/** OpenAI-compatible chat types (what LiteLLM speaks), reduced to what the lab uses. */

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type Message =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatRequest {
  messages: Message[];
  tools: ToolSpec[];
}

export interface ChatResponse {
  content: string | null;
  tool_calls?: ToolCall[];
}

export interface ChatModel {
  readonly name: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
}
