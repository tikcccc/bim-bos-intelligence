import { apiFetch } from "../lib/api";
import type { BusinessContextCache, ConversationMemory, IntentResponse, ProactiveAlert, UserContext } from "../types/ai";
import type { GeminiConfig } from "./geminiService";

async function postAI<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const response = await apiFetch(`/api/ai/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    let message = "AI orchestration request failed.";
    try {
      const data = await response.json();
      message = data.details || data.error || message;
    } catch {
      // Ignore JSON parsing errors and use the fallback message.
    }
    throw new Error(message);
  }

  const data = await response.json();
  return data.result as T;
}

export async function routeIntent(
  message: string,
  userContext: UserContext,
  memory: ConversationMemory,
  config?: GeminiConfig
): Promise<IntentResponse & { functionCalls?: any[] }> {
  return postAI<IntentResponse & { functionCalls?: any[] }>("route-intent", { message, userContext, memory, config });
}

export async function generateProactiveAlerts(
  userContext: UserContext,
  businessCache: BusinessContextCache,
  config?: GeminiConfig
): Promise<ProactiveAlert[]> {
  return postAI<ProactiveAlert[]>("generate-proactive-alerts", { userContext, businessCache, config });
}
