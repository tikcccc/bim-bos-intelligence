
export interface TenderRequirement {
  text: string;
  category: "technical" | "commercial" | "legal";
  mandatory: boolean;
  compliant?: boolean;
}

export interface EvaluationCriterion {
  criterion: string;
  weight_percent: number;
}

export interface TenderContact {
  name: string;
  role: string;
  email: string;
}

export interface TenderRisk {
  type: string;
  description: string;
  severity: "low" | "medium" | "high";
}

export interface Tender {
  id: string;
  uid: string;
  title: string;
  issuing_org: string;
  deadline: string;
  value_range: {
    min: number;
    max: number;
    currency: string;
  };
  // Extracted content
  requirements: TenderRequirement[];
  evaluation_criteria: EvaluationCriterion[];
  contacts: TenderContact[];
  // Strategy
  win_themes: string[];
  competitor_notes: string;
  risk_assessment: TenderRisk[];
  // Status & Logic
  status: "draft" | "under_review" | "bid_prepared" | "submitted" | "awarded" | "lost";
  win_probability: number; // 0-100
  // Linked records
  opportunity_id?: string;
  quote_id?: string;
  proposal_id?: string;
  // Collaboration
  assigned_team: string[];
  internal_comments: {
    user: string;
    text: string;
    timestamp: string;
  }[];
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  bidDraft?: string;
  clientName?: string;
}
