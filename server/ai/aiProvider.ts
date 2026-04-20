import { GoogleGenAI } from "@google/genai";

export type AIProvider = "gemini" | "qwen";

export interface AIConfig {
  provider?: AIProvider;
  model?: string;
  apiKey?: string;
  userRole?: string;
  baseUrl?: string;
}

interface InlineDataPayload {
  mimeType: string;
  data: string;
}

interface GenerateTextOptions {
  prompt: string;
  config?: AIConfig;
  systemInstruction?: string;
  responseSchema?: unknown;
  inlineData?: InlineDataPayload;
}

export interface NormalizedAIError {
  code: string;
  message: string;
  userMessage: string;
  status: number;
  retryable: boolean;
  provider: AIProvider;
  model: string;
}

const DEFAULT_QWEN_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

export const getDefaultModel = (provider: AIProvider) =>
  provider === "qwen" ? "qwen3.6-plus" : "gemini-2.5-flash";

const cleanValue = (value?: string | null) => value?.trim().replace(/^["']|["']$/g, "") || "";

export const getQwenBaseUrl = (config?: AIConfig) =>
  cleanValue(config?.baseUrl) || cleanValue(process.env.QWEN_BASE_URL) || DEFAULT_QWEN_BASE_URL;

const getProviderAndModel = (config?: AIConfig) => {
  const provider: AIProvider = config?.provider === "qwen" ? "qwen" : "gemini";
  const model = cleanValue(config?.model) || getDefaultModel(provider);
  return { provider, model };
};

class AIProviderError extends Error {
  status: number;
  code: string;
  retryable: boolean;
  provider: AIProvider;
  model: string;
  rawMessage: string;
  userMessage: string;

  constructor(payload: NormalizedAIError) {
    super(payload.message);
    this.name = "AIProviderError";
    this.status = payload.status;
    this.code = payload.code;
    this.retryable = payload.retryable;
    this.provider = payload.provider;
    this.model = payload.model;
    this.rawMessage = payload.message;
    this.userMessage = payload.userMessage;
  }
}

const parseStatusFromUnknown = (error: unknown) => {
  const candidateStatus =
    (error as any)?.status ||
    (error as any)?.statusCode ||
    (typeof (error as any)?.code === "number" ? (error as any).code : undefined);

  if (typeof candidateStatus === "number" && Number.isFinite(candidateStatus)) {
    return candidateStatus;
  }

  const message = String((error as any)?.message || error || "");
  const statusMatch = message.match(/\b(400|401|403|404|408|409|422|429|500|502|503|504)\b/);
  return statusMatch ? Number(statusMatch[1]) : 500;
};

const inferErrorCode = (status: number, message: string) => {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("api key") && (lowerMessage.includes("not configured") || lowerMessage.includes("no api key"))) {
    return "AI_MISSING_KEY";
  }
  if (status === 401 || status === 403 || lowerMessage.includes("invalid api key") || lowerMessage.includes("permission denied")) {
    return "AI_AUTH_FAILED";
  }
  if (
    status === 429 ||
    status === 503 ||
    status === 504 ||
    lowerMessage.includes("high demand") ||
    lowerMessage.includes("overloaded") ||
    lowerMessage.includes("unavailable") ||
    lowerMessage.includes("rate limit") ||
    lowerMessage.includes("quota")
  ) {
    return "AI_PROVIDER_BUSY";
  }
  if (status === 400 || lowerMessage.includes("unsupported model") || lowerMessage.includes("model not found")) {
    return "AI_BAD_REQUEST";
  }

  return "AI_REQUEST_FAILED";
};

const buildUserMessage = (code: string, provider: AIProvider, config?: AIConfig) => {
  const providerLabel = provider === "qwen" ? "Qwen" : "Gemini";
  const missingKeyMessage =
    provider === "qwen"
      ? "Qwen API key is not configured in the backend environment. Set QWEN_API_KEY or DASHSCOPE_API_KEY on the server."
      : "Gemini API key is not configured. Add a key in AI settings or configure the backend environment variable.";

  switch (code) {
    case "AI_MISSING_KEY":
      return missingKeyMessage;
    case "AI_AUTH_FAILED":
      if (provider === "qwen") {
        const baseUrl = getQwenBaseUrl(config);
        return `Qwen rejected the credentials. Check whether the API key is valid for this endpoint (${baseUrl}). If your key was created in the China console, set QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1. For international keys, use https://dashscope-intl.aliyuncs.com/compatible-mode/v1.`;
      }
      return `${providerLabel} rejected the credentials. Check whether the API key is valid and has access to this model.`;
    case "AI_PROVIDER_BUSY":
      return `${providerLabel} is temporarily busy. Please try again in a moment.`;
    case "AI_BAD_REQUEST":
      return `${providerLabel} rejected this request. Check the selected model and runtime configuration.`;
    default:
      return `${providerLabel} request failed. Please retry, and if it keeps happening check the backend logs.`;
  }
};

export const normalizeAIError = (error: unknown, config?: AIConfig): AIProviderError => {
  if (error instanceof AIProviderError) {
    return error;
  }

  const { provider, model } = getProviderAndModel(config);
  const rawMessage = String((error as any)?.rawMessage || (error as any)?.message || error || "Unknown AI error");
  const status = parseStatusFromUnknown(error);
  const code = inferErrorCode(status, rawMessage);
  const retryable = code === "AI_PROVIDER_BUSY";

  return new AIProviderError({
    code,
    message: rawMessage,
    userMessage: buildUserMessage(code, provider, config),
    status,
    retryable,
    provider,
    model
  });
};

const resolveConfig = (config?: AIConfig) => {
  const { provider, model } = getProviderAndModel(config);
  const apiKey =
    (provider === "qwen"
      ? cleanValue(process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY)
      : cleanValue(config?.apiKey) || cleanValue(process.env.GEMINI_API_KEY));

  if (!apiKey) {
    throw normalizeAIError(
      {
        message: "API key is not configured, and no API key was supplied in AI settings.",
        status: 400
      },
      config
    );
  }

  return {
    provider,
    model,
    apiKey,
    baseUrl: getQwenBaseUrl(config)
  };
};

const buildQwenUserContent = (prompt: string, inlineData?: InlineDataPayload) => {
  if (!inlineData) {
    return prompt;
  }

  return [
    { type: "text", text: prompt },
    {
      type: "image_url",
      image_url: {
        url: `data:${inlineData.mimeType};base64,${inlineData.data}`
      }
    }
  ];
};

const readQwenContent = (content: unknown) => {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item: any) => {
        if (typeof item === "string") return item;
        if (item?.type === "text") return item.text || "";
        return "";
      })
      .join("\n");
  }

  return "";
};

const buildProviderError = async (response: Response, config?: AIConfig) => {
  let message = `AI provider request failed with status ${response.status}.`;

  try {
    const data = await response.json();
    message =
      data?.error?.message ||
      data?.message ||
      data?.error ||
      message;
  } catch {
    try {
      message = await response.text();
    } catch {
      // Ignore secondary parsing failures.
    }
  }

  return normalizeAIError(
    {
      message,
      status: response.status
    },
    config
  );
};

export const extractJsonText = (raw: string) => {
  const trimmed = raw.trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const firstObject = withoutFence.indexOf("{");
  const firstArray = withoutFence.indexOf("[");
  const firstIndexCandidates = [firstObject, firstArray].filter(index => index >= 0);
  const firstIndex = firstIndexCandidates.length > 0 ? Math.min(...firstIndexCandidates) : -1;

  if (firstIndex === -1) {
    return withoutFence;
  }

  const lastObject = withoutFence.lastIndexOf("}");
  const lastArray = withoutFence.lastIndexOf("]");
  const lastIndex = Math.max(lastObject, lastArray);

  if (lastIndex === -1 || lastIndex <= firstIndex) {
    return withoutFence.slice(firstIndex);
  }

  return withoutFence.slice(firstIndex, lastIndex + 1);
};

export const parseJsonResponse = <T>(raw: string): T => JSON.parse(extractJsonText(raw)) as T;

export const generateText = async ({ prompt, config, systemInstruction, responseSchema, inlineData }: GenerateTextOptions) => {
  const resolved = resolveConfig(config);

  if (resolved.provider === "gemini") {
    try {
      const ai = new GoogleGenAI({ apiKey: resolved.apiKey });
      const response = await ai.models.generateContent({
        model: resolved.model,
        contents: [
          {
            role: "user",
            parts: inlineData
              ? [
                  { text: prompt },
                  { inlineData: { mimeType: inlineData.mimeType, data: inlineData.data } }
                ]
              : [{ text: prompt }]
          }
        ],
        config: {
          ...(systemInstruction ? { systemInstruction } : {}),
          ...(responseSchema ? { responseMimeType: "application/json", responseSchema } : {})
        }
      });

      return response.text || "";
    } catch (error) {
      throw normalizeAIError(error, config);
    }
  }

  const response = await fetch(`${resolved.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolved.apiKey}`
    },
    body: JSON.stringify({
      model: resolved.model,
      messages: [
        ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
        {
          role: "user",
          content: buildQwenUserContent(prompt, inlineData)
        }
      ]
    })
  });

  if (!response.ok) {
    throw await buildProviderError(response, config);
  }

  const data = await response.json();
  return readQwenContent(data?.choices?.[0]?.message?.content);
};

export const generateJson = async <T>(options: GenerateTextOptions) => {
  const prompt = `${options.prompt}

Return only valid JSON. Do not wrap the response in markdown fences.`;

  const raw = await generateText({ ...options, prompt });
  return parseJsonResponse<T>(raw);
};

export const getRuntimeHealth = (config?: AIConfig) => {
  const provider: AIProvider = config?.provider === "qwen" ? "qwen" : "gemini";
  const configured = Boolean(
    cleanValue(config?.apiKey) ||
      (provider === "qwen"
        ? cleanValue(process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY)
        : cleanValue(process.env.GEMINI_API_KEY))
  );

  return {
    configured,
    provider,
    qwenBaseUrl: getQwenBaseUrl(config),
    defaultProviderConfigured: {
      gemini: Boolean(cleanValue(process.env.GEMINI_API_KEY)),
      qwen: Boolean(cleanValue(process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY))
    }
  };
};
