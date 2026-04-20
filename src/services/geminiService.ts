import { apiFetch } from "../lib/api";

export interface GeminiConfig {
  provider?: "gemini" | "qwen";
  apiKey?: string;
  model?: string;
  userRole?: string;
  autoClassifyOnSync?: boolean;
}

export interface AIHealthStatus {
  configured: boolean;
  backend: string;
  provider: string;
  qwenBaseUrl?: string;
  defaultProviderConfigured?: {
    gemini: boolean;
    qwen: boolean;
  };
  timestamp: string;
}

export interface AIRequestErrorInfo {
  code?: string;
  details?: string;
  userMessage: string;
  retryable?: boolean;
  provider?: string;
  model?: string;
}

export class AIRequestError extends Error {
  code?: string;
  details?: string;
  retryable?: boolean;
  provider?: string;
  model?: string;

  constructor(info: AIRequestErrorInfo) {
    super(info.userMessage);
    this.name = "AIRequestError";
    this.code = info.code;
    this.details = info.details;
    this.retryable = info.retryable;
    this.provider = info.provider;
    this.model = info.model;
  }
}

async function postAI<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const response = await apiFetch(`/api/ai/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    let errorInfo: AIRequestErrorInfo = {
      userMessage: "AI request failed."
    };
    try {
      const data = await response.json();
      errorInfo = {
        code: data.code,
        details: data.details || data.error,
        userMessage: data.userMessage || data.details || data.error || errorInfo.userMessage,
        retryable: data.retryable,
        provider: data.provider,
        model: data.model
      };
    } catch {
      // Ignore JSON parsing errors and use the fallback message.
    }
    throw new AIRequestError(errorInfo);
  }

  const data = await response.json();
  return data.result as T;
}

export const classifyEmail = async (
  email: { subject: string; body: string; from: string; attachments?: any[] },
  customPrompt?: string,
  config?: GeminiConfig
) => postAI<any>("classify-email", { email, customPrompt, config });

export const analyzeTender = async (tenderText: string, customPrompt?: string, config?: GeminiConfig) =>
  postAI<any>("analyze-tender", { tenderText, customPrompt, config });

export const createBidDraft = async (tenderAnalysis: any, customPrompt?: string, config?: GeminiConfig) =>
  postAI<string>("create-bid-draft", { tenderAnalysis, customPrompt, config });

export const ocrDocument = async (base64Data: string, mimeType: string, config?: GeminiConfig) =>
  postAI<string>("ocr-document", { base64Data, mimeType, config });

export const analyzeMeetingIntelligence = async (notes: string, config?: GeminiConfig) =>
  postAI<any>("analyze-meeting-intelligence", { notes, config });

export const generateReplyDraft = async (
  email: { subject: string; body: string; from: string },
  userPrompt: string,
  config?: GeminiConfig
) => postAI<string>("generate-reply-draft", { email, userPrompt, config });

export const prioritizeTask = async (
  task: any,
  context: { clientTier: string; businessContext: any },
  config?: GeminiConfig
) => postAI<any>("prioritize-task", { task, context, config });

export const generateTaskAlerts = async (tasks: any[], config?: GeminiConfig) =>
  postAI<any[]>("generate-task-alerts", { tasks, config });

export const analyzeAccountHealth = async (
  account: any,
  interactions: { emails: any[]; meetings: any[] },
  opportunities: any[],
  config?: GeminiConfig
) => postAI<any>("analyze-account-health", { account, interactions, opportunities, config });

export const generateStructuredProposal = async (
  context: {
    opportunity: any;
    tender?: any;
    account?: any;
    pastWins?: any[];
  },
  config?: GeminiConfig
) => postAI<any>("generate-structured-proposal", { context, config });

export const improveProposalSection = async (
  sectionContent: string,
  instruction: string,
  config?: GeminiConfig
) => postAI<string>("improve-proposal-section", { sectionContent, instruction, config });

export async function getAIHealth(): Promise<AIHealthStatus> {
  const response = await apiFetch('/api/ai/health');
  if (!response.ok) {
    throw new Error('Failed to fetch AI health status.');
  }
  return response.json();
}

export async function testAIConnection(config?: GeminiConfig): Promise<{ ok: boolean; response: string; attempts?: number }> {
  return postAI<{ ok: boolean; response: string; attempts?: number }>('test', { config });
}
