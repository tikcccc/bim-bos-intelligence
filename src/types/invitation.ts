
import { UserRole } from './auth';

export interface Invitation {
  id: string;
  email: string;
  role: UserRole;
  token: string;
  invitedBy: string; // boss email
  createdAt: string;
  status: 'pending' | 'accepted' | 'expired';
}
