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

const DEFAULT_QWEN_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

export const getDefaultModel = (provider: AIProvider) =>
  provider === "qwen" ? "qwen-plus" : "gemini-3-flash-preview";

const cleanValue = (value?: string | null) => value?.trim().replace(/^["']|["']$/g, "") || "";

const resolveConfig = (config?: AIConfig) => {
  const provider: AIProvider = config?.provider === "qwen" ? "qwen" : "gemini";
  const model = cleanValue(config?.model) || getDefaultModel(provider);
  const apiKey =
    cleanValue(config?.apiKey) ||
    (provider === "qwen"
      ? cleanValue(process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY)
      : cleanValue(process.env.GEMINI_API_KEY));

  if (!apiKey) {
    const envName = provider === "qwen" ? "QWEN_API_KEY / DASHSCOPE_API_KEY" : "GEMINI_API_KEY";
    throw new Error(`${envName} is not configured, and no API key was supplied in AI settings.`);
  }

  return {
    provider,
    model,
    apiKey,
    baseUrl: cleanValue(config?.baseUrl) || cleanValue(process.env.QWEN_BASE_URL) || DEFAULT_QWEN_BASE_URL
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

const buildProviderError = async (response: Response) => {
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

  const error = new Error(message);
  (error as any).status = response.status;
  return error;
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
    throw await buildProviderError(response);
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
    defaultProviderConfigured: {
      gemini: Boolean(cleanValue(process.env.GEMINI_API_KEY)),
      qwen: Boolean(cleanValue(process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY))
    }
  };
};
