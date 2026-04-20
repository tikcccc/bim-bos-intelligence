
/**
 * BIM BOS AI Context Management Schema
 */

export type UserRole = 'boss' | 'sales';

export interface UserContext {
  role: UserRole;
  companyId: string;
  permissions: string[];
  activeModule: string;
}

export interface EntityExtracted {
  type: string;
  value: string;
  confidence: number;
}

export interface ConversationMemory {
  sessionId: string;
  entitiesExtracted: EntityExtracted[];
  moduleHandoffs: {
    from: string;
    to: string;
    timestamp: string;
  }[];
  history: {
    role: 'user' | 'model';
    content: string;
    timestamp: string;
  }[];
}

export interface BusinessContextCache {
  keyAccounts: {
    id: string;
    name: string;
    lastContact: string;
    status: string;
  }[];
  activeTenders: {
    id: string;
    title: string;
    deadline: string;
    value: number;
  }[];
  pendingQuotes: {
    id: string;
    client: string;
    amount: number;
    daysPending: number;
  }[];
  activeTasks: {
    id: string;
    title: string;
    priority: number;
    dueDate: string;
    status: string;
  }[];
}

export interface IntentResponse {
  intent: 'email_reply' | 'task_create' | 'meeting_schedule' | 'quote_request' | 'tender_analysis' | 'account_register' | 'report_request' | 'chat' | 'unknown';
  confidence: number;
  entities: Record<string, any>;
  targetModule: string;
  explanation: string;
  functionCalls?: {
    name: string;
    args: Record<string, any>;
  }[];
}

export interface ProactiveAlert {
  id: string;
  title: string;
  body: string;
  actionUrl: string;
  priority: 1 | 2 | 3 | 4 | 5;
  timestamp: string;
}
