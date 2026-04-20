
export interface AccountContact {
  name: string;
  email: string;
  mobile: string;
  position: string;
}

export interface AccountInternalNote {
  userId: string;
  userEmail: string;
  text: string;
  timestamp: string;
}

export interface AccountAIInsights {
  next_best_action: string;
  churn_risk: "low" | "medium" | "high";
  upsell_hints: string[];
  health_score: number; // 1-10
  health_trend: "improving" | "stable" | "declining";
  recommended_actions: string[];
}

export interface Account {
  id: string;
  name: string;
  industry: string;
  tier: "strategic" | "priority" | "standard";
  
  // Contacts
  primary_contact: AccountContact;
  additional_contacts: AccountContact[];
  
  // Relationship stats
  last_contact_date: string;
  sentiment_trend: "improving" | "stable" | "declining";
  email_volume_30d: number;
  meeting_count_30d: number;
  
  // Business Context
  active_opportunities: string[]; // collection 'templates' refs
  past_quotes: string[];
  won_value_ytd: number;
  
  // Notes & AI
  internal_notes: AccountInternalNote[];
  ai_insights?: AccountAIInsights;
  
  // Audit/Ownership
  owner_id: string; // auth uid
  owner_email: string;
  createdAt: string;
  updatedAt: string;
}
