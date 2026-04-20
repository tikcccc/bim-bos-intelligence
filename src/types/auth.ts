
export type UserRole = 'boss' | 'sales';

export interface ModulePermissions {
  email: 'full' | 'own' | 'none';
  tasks: 'all' | 'assigned' | 'none';
  proposals: 'approve' | 'create' | 'view';
  accounts: 'all' | 'assigned' | 'none';
  reporting: 'company' | 'personal' | 'none';
}

export interface ActionPermissions {
  quote_approve: boolean;
  account_delete: boolean;
  ai_override: boolean;
  manage_users: boolean;
}

export interface RBACPermission {
  role: UserRole;
  module_access: ModulePermissions;
  action_permissions: ActionPermissions;
  data_scope: {
    accounts: 'all' | 'assigned';
    opportunities: 'company' | 'team' | 'owned';
  };
}

export const ROLE_PERMISSIONS: Record<UserRole, RBACPermission> = {
  boss: {
    role: 'boss',
    module_access: {
      email: 'full',
      tasks: 'all',
      proposals: 'approve',
      accounts: 'all',
      reporting: 'company'
    },
    action_permissions: {
      quote_approve: true,
      account_delete: true,
      ai_override: true,
      manage_users: true
    },
    data_scope: {
      accounts: 'all',
      opportunities: 'company'
    }
  },
  sales: {
    role: 'sales',
    module_access: {
      email: 'own',
      tasks: 'assigned',
      proposals: 'create',
      accounts: 'assigned',
      reporting: 'personal'
    },
    action_permissions: {
      quote_approve: false,
      account_delete: false,
      ai_override: false,
      manage_users: false
    },
    data_scope: {
      accounts: 'assigned',
      opportunities: 'owned'
    }
  }
};

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  assignedAccounts?: string[];
  createdAt: string;
  lastLogin: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  userEmail: string;
  action: string;
  module: string;
  recordId?: string;
  timestamp: string;
  ip?: string;
  details?: any;
}
