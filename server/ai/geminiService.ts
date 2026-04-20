import { Type } from "@google/genai";
import { AIConfig, generateJson, generateText } from "./aiProvider";

const getRBACContext = (role?: string) => {
  if (role === "boss") {
    return "CONTEXT: You are responding to the BOSS (Superuser). Provide full visibility, detailed strategic analysis, and company-wide financial context. Be exhaustive.";
  }
  return "CONTEXT: You are responding to a SALES representative. Provide focused, action-oriented guidance for their assigned accounts. Maintain data isolation and avoid company-wide high-level financial disclosures.";
};

export const classifyEmail = async (
  email: { subject: string; body: string; from: string; attachments?: any[] },
  customPrompt?: string,
  config?: AIConfig
) => {
  const attachmentContext =
    email.attachments && email.attachments.length > 0
      ? `\nATTACHMENTS:\n${email.attachments.map(a => `- ${a.filename} (${a.contentType})${a.content ? `\n  Content: ${a.content.substring(0, 1000)}` : ""}`).join("\n")}`
      : "";

  const defaultPrompt = `
    You are an expert business email classifier for isBIM, a construction and BIM services company.
    ${getRBACContext(config?.userRole)}
    
    CLASSIFICATION CATEGORIES:
    1. MEETING: Meeting requests, scheduling, transcripts of discussions, project sync-ups.
    2. PROJECT: Technical project updates, site reports, BIM coordination issues, submission trackers.
    3. MARKETING: Promotional content, company announcements, newsletters, general inquiries from prospects.
    4. FINANCE: Invoices, purchase orders, payment notifications, budget discussions, financial claims.
    5. OPPORTUNITY: New business opportunities, partnerships, potential new projects.
    6. REQUEST: Request for quotes (RFQ), Request for information (RFI), price inquiries.
    7. SUBMITTED: Quotations issued, bid submissions, proposal sent.
    8. AWARDED: Contract awarded, successful bid notifications, project wins.
    9. OTHER: All other emails including internal HR, spam, or ambiguous content.
    
    EMAIL TO CLASSIFY:
    From: ${email.from}
    Subject: ${email.subject}
    Body: ${email.body.substring(0, 2000)}
    ${attachmentContext}
    
    INSTRUCTIONS:
    1. Analyze the email intent and any provided attachment content.
    2. Classify into ONE primary category.
    3. Provide a confidence score (0-1).
    4. Extract key entities including project names, personal names of clients (clientName), their associated organizations (clientOrganization), and client email addresses.
    5. CRITICAL: For clientEmail extraction, DO NOT include any emails from internal domains like "isbim.com" or "jarvis-bim.com" (or mentions of isBIM/Jarvis). Only extract the external stakeholder's email address.
    6. If classified as SUBMITTED or AWARDED, pay special attention to financial data (amounts, currencies) in the body or attachments.
    6. Summarize the email.
  `;

  let prompt = customPrompt || defaultPrompt;
  if (customPrompt) {
    prompt = prompt
      .replace("{{from}}", email.from)
      .replace("{{subject}}", email.subject)
      .replace("{{body}}", email.body.substring(0, 2000))
      .replace("{{attachments}}", attachmentContext);
  }

  return generateJson<any>({
    prompt,
    config,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        classification: { type: Type.STRING, enum: ["MEETING", "PROJECT", "MARKETING", "FINANCE", "OPPORTUNITY", "REQUEST", "SUBMITTED", "AWARDED", "OTHER"] },
        confidence: { type: Type.NUMBER },
        summary: { type: Type.STRING },
        extractedData: {
          type: Type.OBJECT,
          properties: {
            projectName: { type: Type.STRING },
            clientName: { type: Type.STRING, description: "Personal name of the client/sender" },
            clientOrganization: { type: Type.STRING, description: "The company or organization the client represents" },
            clientEmail: { type: Type.STRING, description: "External client email address ONLY. Ignore isBIM and Jarvis domains." },
            deadline: { type: Type.STRING },
            amount: { type: Type.STRING },
            currency: { type: Type.STRING },
            estimateValue: { type: Type.NUMBER, description: "Numeric value of the estimate or amount" },
            location: { type: Type.STRING },
            technicalRequirements: { type: Type.ARRAY, items: { type: Type.STRING } }
          }
        },
        reasoning: { type: Type.STRING }
      },
      required: ["classification", "confidence", "summary", "extractedData"]
    }
  });
};

export const analyzeTender = async (tenderText: string, customPrompt?: string, config?: AIConfig) => {
  const defaultPrompt = `
    You are an expert Bid Intelligence Specialist. Analyze the following tender/RFP document text.
    ${getRBACContext(config?.userRole)}
    
    TENDER TEXT:
    ${tenderText.substring(0, 20000)}
    
    INSTRUCTIONS:
    1. Extract the submission deadline, issuing organization, and title.
    2. Extract all requirements and categorize them (technical, commercial, legal). Flag if mandatory.
    3. Identify evaluation criteria and their weightings (percentage).
    4. Find key contacts (procurement officers, technical leads).
    5. Identify hidden risks (e.g., mention of an incumbent, tight deadlines, complex compliance).
    6. Suggest 3-5 "Win Themes" based on the client's stated objectives and values.
    7. Identify expected budget min/max and currency.
  `;

  let prompt = customPrompt || defaultPrompt;
  if (customPrompt) {
    prompt = prompt.replace("{{text}}", tenderText.substring(0, 20000));
  }

  return generateJson<any>({
    prompt,
    config,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        issuing_org: { type: Type.STRING },
        deadline: { type: Type.STRING },
        summary: { type: Type.STRING },
        value_range: {
          type: Type.OBJECT,
          properties: {
            min: { type: Type.NUMBER },
            max: { type: Type.NUMBER },
            currency: { type: Type.STRING }
          }
        },
        requirements: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              category: { type: Type.STRING, enum: ["technical", "commercial", "legal"] },
              mandatory: { type: Type.BOOLEAN }
            }
          }
        },
        evaluation_criteria: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              criterion: { type: Type.STRING },
              weight_percent: { type: Type.NUMBER }
            }
          }
        },
        contacts: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              role: { type: Type.STRING },
              email: { type: Type.STRING }
            }
          }
        },
        risk_assessment: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              type: { type: Type.STRING },
              description: { type: Type.STRING },
              severity: { type: Type.STRING, enum: ["low", "medium", "high"] }
            }
          }
        },
        win_themes: { type: Type.ARRAY, items: { type: Type.STRING } },
        win_probability_hint: { type: Type.NUMBER, description: "Estimated win probability based on requirements match (0-100)" }
      },
      required: ["title", "issuing_org", "deadline", "requirements", "evaluation_criteria"]
    }
  });
};

export const createBidDraft = async (tenderAnalysis: any, customPrompt?: string, config?: AIConfig) => {
  const defaultPrompt = `
    Based on the following tender analysis, create a professional bid draft for isBIM (a construction and BIM services company).
    
    TENDER ANALYSIS:
    ${JSON.stringify(tenderAnalysis)}
    
    INSTRUCTIONS:
    1. Write a compelling executive summary.
    2. Address the technical requirements specifically.
    3. Outline the proposed team based on people requirements.
    4. Provide a high-level project plan.
    5. Ensure the tone is professional and persuasive.
    6. Format as Markdown.
  `;

  let prompt = customPrompt || defaultPrompt;
  if (customPrompt) {
    prompt = prompt.replace("{{analysis}}", JSON.stringify(tenderAnalysis));
  }

  return generateText({ prompt, config });
};

export const ocrDocument = async (base64Data: string, mimeType: string, config?: AIConfig) => {
  const prompt = "Extract all text from this document. Maintain the original structure and layout as much as possible. Return ONLY the extracted text.";

  return generateText({
    prompt,
    config,
    inlineData: {
      mimeType,
      data: base64Data
    }
  });
};

export const analyzeMeetingIntelligence = async (
  notes: string,
  config?: AIConfig
) => {
  const prompt = `
    Act as a Meeting Intelligence Specialist. Analyze the following meeting notes/transcript and extract structured insights.
    
    MEETING NOTES/TRANSCRIPT:
    ${notes.substring(0, 15000)}
    
    INSTRUCTIONS:
    1. Extract all decisions made during the meeting.
    2. Extract specific action items, including the description, owner email (if identifiable, else leave blank), and suggested due date.
    3. Identify open questions or unresolved issues.
    4. Draft follow-up email templates for key stakeholders based on the discussion.
    5. Summarize the overall sentiment of the meeting (e.g., collaborative, tense, productive).
    6. Extract participants mentioned.
    7. Return strict JSON matching the schema below.
  `;

  return generateJson<any>({
    prompt,
    config,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        date: { type: Type.STRING },
        participants: { type: Type.ARRAY, items: { type: Type.STRING } },
        decisions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              context: { type: Type.STRING }
            }
          }
        },
        actions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              description: { type: Type.STRING },
              ownerEmail: { type: Type.STRING },
              dueDate: { type: Type.STRING },
              priority: { type: Type.INTEGER, minimum: 1, maximum: 5 },
              relatedEmailThreadId: { type: Type.STRING }
            }
          }
        },
        followUpEmails: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              recipient: { type: Type.STRING },
              subjectHint: { type: Type.STRING },
              keyPoints: { type: Type.ARRAY, items: { type: Type.STRING } }
            }
          }
        },
        openQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
        sentimentSummary: { type: Type.STRING }
      },
      required: ["title", "decisions", "actions", "sentimentSummary"]
    }
  });
};

export const generateReplyDraft = async (
  email: { subject: string; body: string; from: string },
  userPrompt: string,
  config?: AIConfig
) => {
  const prompt = `
    You are an expert business communicator for isBIM. Write a draft reply to the following email.
    
    ORIGINAL EMAIL:
    From: ${email.from}
    Subject: ${email.subject}
    Body: ${email.body.substring(0, 3000)}
    
    USER'S SPECIFIC INSTRUCTIONS FOR THIS REPLY:
    ${userPrompt}
    
    INSTRUCTIONS:
    1. Adopt a professional, helpful, and brand-consistent tone for isBIM.
    2. Address the specific points raised in the original email.
    3. Follow the user's specific instructions.
    4. Provide the draft as plain text without placeholders if possible.
  `;

  return generateText({ prompt, config });
};

export const prioritizeTask = async (
  task: any,
  context: { clientTier: string; businessContext: any },
  config?: AIConfig
) => {
  const prompt = `
    Act as a Workflow Automation Engineer for BIM BOS. 
    Score priority 1-5 for this task considering:
    1. Deadline proximity (${task.due_date})
    2. Client tier: ${context.clientTier}
    3. Dependencies: ${task.dependencies?.length || 0} blocking items
    4. Business impact keywords in description: "${task.description}"
    5. Business Context: ${JSON.stringify(context.businessContext)}

    TASK DETAILS:
    Title: ${task.title}
    Status: ${task.status}

    Return a strict JSON object:
    {
      "priority_score": number (1-5),
      "rationale": "short explanation",
      "suggested_due_date": "ISO string if different",
      "subtasks": ["subtask 1", "subtask 2"],
      "time_estimate": "e.g. 4 hours"
    }
  `;

  try {
    return await generateJson<any>({ prompt, config });
  } catch (error) {
    console.error("Failed to parse task priority:", error);
    return { priority_score: 3, rationale: "Standard priority assigned." };
  }
};

export const generateTaskAlerts = async (
  tasks: any[],
  config?: AIConfig
) => {
  const prompt = `
    Review user's tasks and generate proactive alerts.
    Tasks: ${JSON.stringify(tasks.slice(0, 20))}
    Identify:
    1. Due in <24h
    2. Blocked by others
    3. Overloaded days

    Return a strict JSON array:
    [{ "task_id": string, "alert_type": "upcoming|overdue|blocked", "message": string, "suggested_action": string }]
  `;

  try {
    return await generateJson<any[]>({ prompt, config });
  } catch (error) {
    console.error("Failed to parse task alerts:", error);
    return [];
  }
};

export const analyzeAccountHealth = async (
  account: any,
  interactions: { emails: any[]; meetings: any[] },
  opportunities: any[],
  config?: AIConfig
) => {
  const prompt = `
    Act as a Senior Relationship Manager and Sales Analyst. 
    ${getRBACContext(config?.userRole)}
    
    Assess account health for client: "${account.name}" (${account.industry}).
    
    INPUT DATA:
    1. Interaction History (last 30 days):
       Emails: ${JSON.stringify(interactions.emails.slice(0, 10))}
       Meetings: ${JSON.stringify(interactions.meetings.slice(0, 5))}
    2. Opportunity Pipeline:
       Opportunities: ${JSON.stringify(opportunities)}
    3. Sentiment History: ${account.sentiment_trend}
    
    INSTRUCTIONS:
    1. Assess health score (1-10) where 10 is excellent.
    2. Identify health trend (improving, stable, declining).
    3. Provide recommended actions to improve relationship or close deals.
    4. Highlight churn risk (low, medium, high).
    5. Suggest upsell hints.
    6. Formulate a 'next best action' text.

    Return a strict JSON object matching AccountAIInsights schema.
  `;

  return generateJson<any>({
    prompt,
    config,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        health_score: { type: Type.NUMBER },
        health_trend: { type: Type.STRING, enum: ["improving", "stable", "declining"] },
        recommended_actions: { type: Type.ARRAY, items: { type: Type.STRING } },
        churn_risk: { type: Type.STRING, enum: ["low", "medium", "high"] },
        upsell_hints: { type: Type.ARRAY, items: { type: Type.STRING } },
        next_best_action: { type: Type.STRING }
      },
      required: ["health_score", "health_trend", "recommended_actions", "churn_risk", "next_best_action"]
    }
  });
};

export const generateStructuredProposal = async (
  context: {
    opportunity: any;
    tender?: any;
    account?: any;
    pastWins?: any[];
  },
  config?: AIConfig
) => {
  const prompt = `
    Act as a Senior Proposal Engineer for isBIM. 
    ${getRBACContext(config?.userRole)}
    
    Generate a client-ready proposal draft based on these inputs:

    1. OPPORTUNITY: ${JSON.stringify(context.opportunity)}
    2. TENDER SPECS: ${context.tender ? JSON.stringify(context.tender) : "N/A"}
    3. CLIENT CONTEXT: ${context.account ? JSON.stringify(context.account) : "N/A"}
    4. PREVIOUS WINS: ${JSON.stringify(context.pastWins || [])}

    INSTRUCTIONS:
    1. Create sections: Cover, Executive Summary, Technical Scope, Proposed Team, Timeline, and Pricing Strategy.
    2. Tone: Professional, authoritative, yet collaborative.
    3. Formatting: Use clear headings and bullet points.
    4. Identify Pricing Suggestions: Based on project scope and client budget clues.
    5. Flag risks or items needing human review.

    Return a strict JSON object matching DocumentSection[] and pricing suggestions.
  `;

  return generateJson<any>({
    prompt,
    config,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        sections: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              content: { type: Type.STRING },
              confidence: { type: Type.NUMBER }
            }
          }
        },
        pricing_suggestions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              description: { type: Type.STRING },
              suggested_amount: { type: Type.NUMBER }
            }
          }
        },
        risk_notes: { type: Type.ARRAY, items: { type: Type.STRING } }
      },
      required: ["sections", "pricing_suggestions"]
    }
  });
};

export const improveProposalSection = async (
  sectionContent: string,
  instruction: string,
  config?: AIConfig
) => {
  const prompt = `
    Refine this proposal section.
    
    ORIGINAL CONTENT:
    ${sectionContent}
    
    USER INSTRUCTION:
    ${instruction}
    
    INSTRUCTIONS:
    1. Improve clarity, persuasiveness, and professionalism.
    2. Maintain isBIM brand voice.
    3. Return only the improved content.
  `;

  return generateText({ prompt, config });
};
