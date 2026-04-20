
export interface MeetingAction {
  id?: string;
  description: string;
  ownerEmail: string;
  dueDate: string;
  priority: 1 | 2 | 3 | 4 | 5;
  relatedEmailThreadId?: string;
  status: 'PENDING' | 'COMPLETED' | 'IN_PROGRESS';
  taskId?: string; // Linked task ID in the Task Module
}

export interface MeetingDecision {
  text: string;
  context: string;
}

export interface FollowUpEmail {
  recipient: string;
  subjectHint: string;
  keyPoints: string[];
  draftedContent?: string;
  isSent?: boolean;
}

export interface Meeting {
  id: string;
  uid: string;
  title: string;
  date: string;
  participants: string[];
  notes?: string;
  transcript?: string;
  summary?: string;
  decisions: MeetingDecision[];
  actions: MeetingAction[];
  followUpEmails: FollowUpEmail[];
  openQuestions: string[];
  sentimentSummary: string;
  createdAt: string;
  calendarEventId?: string;
  consentLogged: boolean;
  redacted: boolean;
}
