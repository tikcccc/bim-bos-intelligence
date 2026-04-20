
export interface PricingItem {
  id: string;
  description: string;
  qty: number;
  unit_price: number;
  total: number;
}

export interface Pricing {
  items: PricingItem[];
  subtotal: number;
  tax: number;
  total: number;
}

export interface DocumentSection {
  id: string;
  title: string;
  content_html: string;
  ai_suggested: boolean;
  approved: boolean;
  confidence?: number;
}

export interface ClientFeedback {
  userId: string;
  userName: string;
  text: string;
  timestamp: string;
}

export interface DocumentVersion {
  version: number;
  updatedBy: string;
  timestamp: string;
  changeSummary: string;
}

export interface ProposalDocument {
  id: string;
  type: "quote" | "proposal";
  opportunity_id: string;
  tender_id?: string;
  client_id: string;
  client_name: string;
  title: string;
  
  sections: DocumentSection[];
  pricing: Pricing;
  
  status: "draft" | "review" | "sent" | "accepted" | "rejected";
  
  // Collaboration
  reviewers: string[]; // user emails
  client_feedback: ClientFeedback[];
  
  // Audit
  generated_at: string;
  sent_at?: string;
  accepted_at?: string;
  version_history: DocumentVersion[];
  
  // Metadata
  uid: string;
  createdBy: string;
  ownerEmail: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProposalTemplate {
  id: string;
  name: string;
  type: "quote" | "proposal";
  sections: { title: string; default_content: string }[];
  isDefault: boolean;
}
