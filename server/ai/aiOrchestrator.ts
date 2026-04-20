import { Type } from "@google/genai";
import type { BusinessContextCache, ConversationMemory, IntentResponse, ProactiveAlert, UserContext } from "../../src/types/ai";
import type { AIConfig } from "./aiProvider";
import { generateJson } from "./aiProvider";

const BOS_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "create_task",
        description: "Create a new task or action item in the system.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "Short title of the task" },
            description: { type: Type.STRING, description: "Detailed description of what needs to be done" },
            dueDate: { type: Type.STRING, description: "Due date in ISO format or YYYY-MM-DD" },
            priority: { type: Type.NUMBER, description: "Priority score from 1 (low) to 5 (high)" },
            assignee: { type: Type.STRING, description: "Email of the person assigned to this task" }
          },
          required: ["title", "description"]
        }
      },
      {
        name: "register_account",
        description: "Register a new client company or key account.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: "Legal name of the company" },
            industry: { type: Type.STRING, description: "Industry sector (e.g., Construction, Real Estate)" },
            tier: { type: Type.STRING, enum: ["Tier 1", "Tier 2", "Tier 3"], description: "Client importance level" },
            website: { type: Type.STRING, description: "Company website URL" }
          },
          required: ["name", "industry"]
        }
      },
      {
        name: "search_data",
        description: "Search for existing information about accounts, tasks, or proposals.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: { type: Type.STRING, description: "Search query string" },
            module: { type: Type.STRING, enum: ["tasks", "accounts", "proposals"], description: "The specific module to search in" }
          },
          required: ["query"]
        }
      }
    ]
  }
];

export async function routeIntent(
  message: string,
  userContext: UserContext,
  memory: ConversationMemory,
  config?: AIConfig
): Promise<IntentResponse & { functionCalls?: any[] }> {
  const prompt = `
    Act as the Central AI Chatbot for BIM BOS (Business Operating System).
    Role: ${userContext.role}
    Active Module: ${userContext.activeModule}
    
    INSTRUCTIONS:
    1. Help the user perform actions like creating tasks or registering accounts using the provided tools.
    2. If the user request matches a tool, CALL THE TOOL.
    3. Always provide a friendly, professional explanation of what you are doing.
    4. Maintain context from previous messages if relevant.
    5. User Role sensitivity: ${userContext.role === "sales" ? "Strictly limit access to financial aggregates." : "Provide full executive overview."}
    6. Conversation memory: ${JSON.stringify(memory.history.slice(-8))}

    USER REQUEST: "${message}"
  `;

  try {
    const resData = await generateJson<any>({
      prompt: `USER REQUEST: "${message}"`,
      config,
      systemInstruction: prompt,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          confidence: { type: Type.NUMBER },
          targetModule: { type: Type.STRING },
          explanation: { type: Type.STRING }
        },
        required: ["explanation"]
      }
    });

    return {
      confidence: resData.confidence || 0.9,
      targetModule: resData.targetModule || userContext.activeModule,
      explanation: resData.explanation,
      intent: "chat",
      entities: {}
    } as IntentResponse & { functionCalls?: any[] };
  } catch (error) {
    console.error("Orchestration Error:", error);
    return {
      intent: "unknown",
      confidence: 0,
      entities: {},
      targetModule: userContext.activeModule,
      explanation: "I encountered an error trying to process your request."
    };
  }
}

export async function generateProactiveAlerts(
  userContext: UserContext,
  businessCache: BusinessContextCache,
  config?: AIConfig
): Promise<ProactiveAlert[]> {
  const prompt = `
    Act as a proactive Business Advisor for isBIM BOS.
    Review the user's current business state and generate exactly 3 prioritized alerts.
    
    USER CONTEXT:
    Role: ${userContext.role}
    
    BUSINESS STATE:
    Accounts: ${JSON.stringify(businessCache.keyAccounts)}
    Tenders: ${JSON.stringify(businessCache.activeTenders)}
    Quotes: ${JSON.stringify(businessCache.pendingQuotes)}
    Tasks: ${JSON.stringify(businessCache.activeTasks)}

    CRITERIAL:
    - High priority for deadlines within 48h.
    - Identify task bottlenecks (e.g., many high priority items due same day).
    - Low priority for general status updates.
    - Format response as a JSON array of alerts.
  `;

  try {
    return await generateJson<ProactiveAlert[]>({
      prompt,
      config,
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            title: { type: Type.STRING },
            body: { type: Type.STRING },
            actionUrl: { type: Type.STRING },
            priority: { type: Type.INTEGER },
            timestamp: { type: Type.STRING }
          },
          required: ["title", "body", "priority"]
        }
      }
    });
  } catch (error) {
    console.error("Alert Generation Error:", error);
    return [];
  }
}
