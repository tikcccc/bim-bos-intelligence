
export interface TaskAlert {
  type: 'upcoming' | 'overdue' | 'blocked';
  triggered_at: string;
  message: string;
}

export interface TaskPriority {
  score: 1 | 2 | 3 | 4 | 5;
  reason: string;
}

export interface Task {
  id: string;
  uid: string;
  title: string;
  description: string;
  source: {
    module: 'email' | 'meeting' | 'manual';
    record_id?: string;
  };
  owner_id: string;
  assignee?: string;
  collaborators: string[];
  status: 'todo' | 'in_progress' | 'review' | 'done';
  priority: TaskPriority;
  due_date: string;
  estimated_hours?: number;
  dependencies: string[]; // task_ids that this task is blocked by
  blocked_by?: string[]; // redundant but explicit
  alerts: TaskAlert[];
  ai_suggestions?: {
    subtasks: string[];
    time_estimate: string;
    resource_needs: string[];
  };
  createdAt: string;
  updatedAt: string;
  opportunityId?: string; // Link to business opportunity
}
