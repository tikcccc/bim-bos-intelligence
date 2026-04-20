import React, { useState, useEffect } from 'react';
import AuthGuard from './components/AuthGuard';
import { Mail, Phone, Send, MessageSquare, FileText, CheckCircle, Settings, RefreshCw, LogOut, Search, Filter, ChevronRight, ChevronLeft, AlertCircle, Home, BarChart2, Users, User, HelpCircle, Bell, MoreVertical, Clock, Briefcase, Layers, CheckSquare, X, Trash2, Edit2, ArrowUpRight, ArrowDownRight, Upload, Sparkles, ChevronDown, Calendar, List, LayoutGrid, Server, Plus, Inbox, Archive, Send as SendIcon, TrendingUp } from 'lucide-react';
import { auth, db } from './lib/firebase';
import { apiFetch, API_BASE_URL, getApiUrl } from './lib/api';
import { collection, query, onSnapshot, addDoc, updateDoc, doc, Timestamp, orderBy, deleteDoc, getDocFromServer, getDocs, where, writeBatch, setDoc } from 'firebase/firestore';
import { classifyEmail, analyzeTender, createBidDraft, ocrDocument, generateReplyDraft, analyzeMeetingIntelligence, prioritizeTask, generateTaskAlerts, analyzeAccountHealth, generateStructuredProposal, improveProposalSection, getAIHealth, testAIConnection, AIHealthStatus, AIRequestError } from './services/geminiService';
import { routeIntent, generateProactiveAlerts } from './services/aiOrchestrator';
import { AISidebar } from './components/AISidebar';
import { AiAssistantWorkspace } from './components/AiAssistantWorkspace';
import { CommandPalette } from './components/CommandPalette';
import { UserContext, ConversationMemory, BusinessContextCache, ProactiveAlert } from './types/ai';
import { Meeting, MeetingAction, FollowUpEmail } from './types/meeting';
import { Task, TaskAlert, TaskPriority } from './types/task';
import { Tender, TenderRequirement, EvaluationCriterion, TenderContact, TenderRisk } from './types/tender';
import { Account, AccountContact, AccountAIInsights, AccountInternalNote } from './types/account';
import { ProposalDocument, ProposalTemplate, DocumentSection, Pricing, PricingItem } from './types/document';
import { UserRole, UserProfile, ROLE_PERMISSIONS, AuditLog } from './types/auth';
import { Invitation } from './types/invitation';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'sonner';
import Markdown from 'react-markdown';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function getAIErrorDescription(error: unknown) {
  if (error instanceof AIRequestError) {
    return error.details
      ? `${error.message} Technical details: ${error.details}`
      : error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

function showAIErrorToast(options: { title: string; error: unknown; id?: string | number }) {
  toast.error(options.title, {
    id: options.id,
    description: getAIErrorDescription(options.error)
  });
}

function sanitizeFirestoreValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map(item => sanitizeFirestoreValue(item))
      .filter(item => item !== undefined) as T;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, entryValue]) => [key, sanitizeFirestoreValue(entryValue)] as const)
      .filter(([, entryValue]) => entryValue !== undefined);

    return Object.fromEntries(entries) as T;
  }

  return value;
}

function buildEmailAIUpdate(aiResult: any) {
  return sanitizeFirestoreValue({
    aiClassification: aiResult?.classification,
    aiConfidence: aiResult?.confidence,
    extractedData: aiResult?.extractedData,
    summary: aiResult?.summary
  });
}

async function logAuditEvent(action: string, module: string, recordId?: string, details?: any) {
  try {
    const user = auth.currentUser;
    if (!user) return;
    
    const log: Omit<AuditLog, 'id'> = {
      userId: user.uid,
      userEmail: user.email || 'unknown',
      action,
      module,
      recordId,
      timestamp: new Date().toISOString(),
      details
    };
    await addDoc(collection(db, 'audit_logs'), log);
  } catch (err) {
    console.error('Audit logging failed', err);
  }
}

type Email = {
  id: string;
  uid: string;
  subject: string;
  from: string;
  body: string;
  receivedAt: string;
  account?: string;
  aiClassification?: string;
  aiConfidence?: number;
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED';
  isRead?: boolean;
  isDeleted?: boolean;
  extractedData?: any;
  summary?: string;
  attachments?: any[];
};

const AI_MODELS_BY_PROVIDER = {
  gemini: [
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', desc: 'Preview Gemini 3 Flash model for fast general-purpose analysis.' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', desc: 'Lower-latency production option for routine AI workflows.' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', desc: 'Higher-quality reasoning model for more complex analysis and reviews.' }
  ],
  qwen: [
    { id: 'qwen3.6-plus', name: 'Qwen 3.6 Plus', desc: 'Recommended general-purpose Qwen model via DashScope compatible API.' },
    { id: 'qwen3.5-plus', name: 'Qwen 3.5 Plus', desc: 'Stable fallback option for routine analysis and drafting.' }
  ]
} as const;

const getDefaultAIModel = (provider: 'gemini' | 'qwen') => AI_MODELS_BY_PROVIDER[provider][0].id;

const getValidAIModel = (provider: 'gemini' | 'qwen', model?: string) =>
  AI_MODELS_BY_PROVIDER[provider].some(option => option.id === model)
    ? model as string
    : getDefaultAIModel(provider);

const DEFAULT_ADMIN_EMAILS = ['elvis.wiki@gmail.com', 'chiutikhong11551@gmail.com'];
const ADMIN_EMAILS = Array.from(
  new Set(
    [
      ...DEFAULT_ADMIN_EMAILS,
      ...(import.meta.env.VITE_ADMIN_EMAILS || '')
        .split(',')
        .map(email => email.trim())
        .filter(Boolean)
    ]
  )
);

function BOSApp() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState<'INTAKE' | 'BUSINESS' | 'DASHBOARD' | 'TENDERS' | 'SUPPORT' | 'ACCOUNTS' | 'MEETINGS' | 'TASKS' | 'CONNECTIONS' | 'PROPOSALS' | 'TEAM' | 'AI' | 'SKILLS'>('DASHBOARD');
  const [activeSkillSubTab, setActiveSkillSubTab] = useState<'PROMPTS' | 'TEMPLATES'>('PROMPTS');
  const [activeIntakeSubTab, setActiveIntakeSubTab] = useState<'INBOX' | 'SENT' | 'HISTORY' | 'DRAFTS' | 'TRASH' | 'COMPOSE'>('INBOX');
  const [emailSearchTerm, setEmailSearchTerm] = useState('');
  const [replyHistory, setReplyHistory] = useState<any[]>([]);
  const [sentEmails, setSentEmails] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [composeData, setComposeData] = useState({ to: '', subject: '', body: '' });
  const [activePromptTab, setActivePromptTab] = useState<'CLASSIFY' | 'TENDER' | 'BID'>('CLASSIFY');
  const [isSending, setIsSending] = useState(false);
  const [activeTemplateSubTab, setActiveTemplateSubTab] = useState<'OPPORTUNITY' | 'REQUEST' | 'SUBMITTED' | 'AWARDED'>('OPPORTUNITY');
  const [templates, setTemplates] = useState<any[]>([]);
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [selectedTender, setSelectedTender] = useState<Tender | null>(null);
  const [isAnalyzingTender, setIsAnalyzingTender] = useState(false);
  const [tenderInput, setTenderInput] = useState('');
  const [bidDraft, setBidDraft] = useState<string | null>(null);
  const [isGeneratingBid, setIsGeneratingBid] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<any | null>(null);
  const [isEditingTemplate, setIsEditingTemplate] = useState(false);
  const [editData, setEditData] = useState<any>({});
  const [showSettings, setShowSettings] = useState(false);
  const [showManualConvert, setShowManualConvert] = useState(false);
  const [showClassificationMenu, setShowClassificationMenu] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [tempPassword, setTempPassword] = useState('');
  const [saveStatus, setSaveStatus] = useState<'IDLE' | 'SAVING' | 'SUCCESS'>('IDLE');
  const [testStatus, setTestStatus] = useState<'IDLE' | 'TESTING' | 'SUCCESS' | 'ERROR'>('IDLE');
  
  // Meeting State
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [isAnalyzingMeeting, setIsAnalyzingMeeting] = useState(false);
  const [meetingNotesInput, setMeetingNotesInput] = useState('');
  
  const [activeMeetingSubTab, setActiveMeetingSubTab] = useState<'INTELLIGENCE' | 'CALENDAR' | 'LIST'>('INTELLIGENCE');
  const [showEmailSelectorForMeeting, setShowEmailSelectorForMeeting] = useState(false);
  
  // Task Intelligence State
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isPrioritizing, setIsPrioritizing] = useState(false);
  const [taskFocusMode, setTaskFocusMode] = useState(false);
  const [taskView, setTaskView] = useState<'KANBAN' | 'LIST' | 'CALENDAR'>('KANBAN');
  const [taskSearchTerm, setTaskSearchTerm] = useState('');
  const [taskSourceFilter, setTaskSourceFilter] = useState<'all' | 'email' | 'meeting' | 'manual'>('all');
  const [taskAlerts, setTaskAlerts] = useState<any[]>([]);
  
  // Account Intelligence State
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [isAnalyzingAccount, setIsAnalyzingAccount] = useState(false);
  const [accountSearchTerm, setAccountSearchTerm] = useState('');
  const [accountView, setAccountView] = useState<'GRID' | 'LIST'>('LIST');
  const [accountInitialData, setAccountInitialData] = useState<Partial<Account> | null>(null);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [accountForm, setAccountForm] = useState({
    name: '',
    industry: '',
    tier: 'standard' as Account['tier'],
    primary_contact_name: '',
    primary_contact_email: '',
    primary_contact_mobile: '',
    primary_contact_position: '',
    owner_id: ''
  });

  // RBAC State
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const permissions = userProfile ? ROLE_PERMISSIONS[userProfile.role] : ROLE_PERMISSIONS['sales'];
  const [isAdmin, setIsAdmin] = useState(false); // Refined via profile
  
  // Team Management State
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [isInviting, setIsInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('sales');
  
  // Proposal Intelligence State
  const [proposals, setProposals] = useState<ProposalDocument[]>([]);
  const [selectedProposal, setSelectedProposal] = useState<ProposalDocument | null>(null);
  const [isGeneratingProposal, setIsGeneratingProposal] = useState(false);
  const [proposalSearchTerm, setProposalSearchTerm] = useState('');
  
  // AI Orchestration State
  const [userContext] = useState<UserContext>({
    role: 'boss',
    companyId: 'isbim-corp-01',
    permissions: ['all'],
    activeModule: activeTab
  });
  const [aiMemory, setAiMemory] = useState<ConversationMemory>({
    sessionId: `session-${Date.now()}`,
    entitiesExtracted: [],
    moduleHandoffs: [],
    history: []
  });
  const [aiAlerts, setAiAlerts] = useState<ProactiveAlert[]>([]);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  const [allowUserEditTemplates, setAllowUserEditTemplates] = useState(true);
  const [emailFilter, setEmailFilter] = useState<'ALL' | 'UNREAD'>('ALL');
  const [emailCategoryFilter, setEmailCategoryFilter] = useState<string>('ALL');
  const [settingsTab, setSettingsTab] = useState<'GENERAL' | 'CONNECTIONS' | 'PROMPTS' | 'TEMPLATES' | 'AI'>('GENERAL');
  const [emailConnections, setEmailConnections] = useState<any[]>([]);
  const [isEmailConnectionsLoaded, setIsEmailConnectionsLoaded] = useState(false);
  const [syncDays, setSyncDays] = useState(7);
  const [syncConnectionIds, setSyncConnectionIds] = useState<string[]>([]);
  const [showSyncConfig, setShowSyncConfig] = useState(false);
  const [replyPrompt, setReplyPrompt] = useState('');
  const [aiReplyDraft, setAiReplyDraft] = useState<string | null>(null);
  const [isGeneratingReply, setIsGeneratingReply] = useState(false);
  const [geminiConfig, setGeminiConfig] = useState<{ provider: 'gemini' | 'qwen'; model: string; apiKey?: string; autoClassifyOnSync?: boolean }>({
    provider: 'gemini',
    model: getDefaultAIModel('gemini'),
    apiKey: '',
    autoClassifyOnSync: false
  });
  const [aiHealthStatus, setAiHealthStatus] = useState<AIHealthStatus | null>(null);
  const [isCheckingAIHealth, setIsCheckingAIHealth] = useState(false);
  const [isTestingAIConnection, setIsTestingAIConnection] = useState(false);
  const [promptSettings, setPromptSettings] = useState({
    classifyEmail: `You are an expert business email classifier for isBIM.

CLASSIFICATION CATEGORIES:
1. MEETING: Meeting requests, scheduling, transcripts.
2. PROJECT: Technical project updates, BIM issues, site reports.
3. MARKETING: Promotional content, newsletters, newsletters.
4. FINANCE: Invoices, budget discussions, claims.
5. OPPORTUNITY: New business opportunities, partnerships.
6. REQUEST: Request for quotes (RFQ), price inquiries.
7. SUBMITTED: Quotations issued, bid submissions.
8. AWARDED: Contract awarded, project wins.
9. OTHER: Spam, internal HR, etc.

EMAIL TO CLASSIFY:
From: {{from}}
Subject: {{subject}}
Body: {{body}}
{{attachments}}

INSTRUCTIONS:
1. Analyze intent.
2. Classify (ONE category).
3. Confidence (0-1).
4. Extract (project, clientName, clientOrganization, clientEmail, deadline, amount, currency).
5. Summarize.
6. EXCLUSION RULE: 'clientEmail' MUST NOT belong to isBIM or Jarvis domains (e.g., skip @isbim.com, @jarvis-bim.com). Extract only external client addresses.`,
    analyzeTender: `You are an expert tender analyst. Analyze the TENDER TEXT and extract:
1. Title, client, agency.
2. Deadline.
3. Summary.
4. Business, technical, and people requirements.
5. Marking scheme.
6. Budget, validity, quantity.

TENDER TEXT:
{{text}}`,
    createBidDraft: `Based on the TENDER DATA, create a bid draft for isBIM.

TENDER DATA:
{{analysis}}

INSTRUCTIONS:
1. Executive summary.
2. Technical requirements.
3. Proposed team.
4. Project plan.
5. Tone: Professional/Persuasive.
6. Markdown format.`
  });

  const canAccessEmail = (email: Email) => {
    if (isAdmin) return true;

    const currentUserEmail = auth.currentUser?.email || '';
    if (!currentUserEmail) return false;

    return email.account === currentUserEmail || email.uid?.startsWith(`${currentUserEmail}_`);
  };
  const [formTemplateSettings, setFormTemplateSettings] = useState<any>({
    MEETING: { label: 'Meeting', color: '#175CD3', fields: ['projectName', 'participants', 'deadline', 'location'] },
    PROJECT: { label: 'Project', color: '#B54708', fields: ['projectName', 'clientName', 'deadline', 'technicalRequirements'] },
    MARKETING: { label: 'Marketing', color: '#7F56D9', fields: ['campaignName', 'targetAudience', 'deadline'] },
    FINANCE: { label: 'Finance', color: '#027A48', fields: ['projectName', 'amount', 'currency', 'invoiceNumber'] },
    OPPORTUNITY: { label: 'Opportunity', color: '#3538CD', fields: ['projectName', 'clientName', 'estimateValue', 'deadline'] },
    REQUEST: { label: 'Request', color: '#F79009', fields: ['projectName', 'clientName', 'amount', 'deadline'] },
    SUBMITTED: { label: 'Submitted', color: '#C11574', fields: ['projectName', 'clientName', 'amount', 'currency'] },
    AWARDED: { label: 'Awarded', color: '#054F31', fields: ['projectName', 'clientName', 'amount', 'deadline'] }
  });

  useEffect(() => {
    const q = query(collection(db, 'replies'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const replyData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setReplyHistory(replyData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'replies');
    });
    return () => unsubscribe();
  }, []);

  const handleSavePassword = async () => {
    setSaveStatus('SAVING');
    try {
      const res = await apiFetch('/api/config/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: tempPassword })
      });
      if (res.ok) {
        setSaveStatus('SUCCESS');
        toast.success('Settings saved successfully');
        setTimeout(() => {
          setSaveStatus('IDLE');
          setShowSettings(false);
        }, 1500);
      }
    } catch (error) {
      console.error('Failed to save password:', error);
      setSaveStatus('IDLE');
      toast.error('Failed to save settings');
    }
  };

  const handleTestConnection = async () => {
    setTestStatus('TESTING');
    try {
      // First save the password to session
      await apiFetch('/api/config/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: tempPassword })
      });

      const res = await apiFetch('/api/emails/sync');
      const data = await res.json();
      if (res.ok) {
        setTestStatus('SUCCESS');
        toast.success('Connection successful!');
        setTimeout(() => setTestStatus('IDLE'), 2000);
      } else {
        setTestStatus('ERROR');
        toast.error(data.error || 'Connection failed', { description: data.details });
        setTimeout(() => setTestStatus('IDLE'), 3000);
      }
    } catch (error) {
      setTestStatus('ERROR');
      toast.error('Network error during test');
      setTimeout(() => setTestStatus('IDLE'), 2000);
    }
  };

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    const profileRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(profileRef, async (snapshot) => {
      const isPresetAdmin = ADMIN_EMAILS.includes(user.email || '');

      if (snapshot.exists()) {
        const data = snapshot.data() as UserProfile;

        if (isPresetAdmin && data.role !== 'boss') {
          const upgradedProfile: UserProfile = {
            ...data,
            role: 'boss',
            lastLogin: new Date().toISOString()
          };
          await setDoc(profileRef, upgradedProfile, { merge: true });
          setUserProfile(upgradedProfile);
          setIsAdmin(true);
          return;
        }

        setUserProfile(data);
        setIsAdmin(data.role === 'boss' || isPresetAdmin);
      } else {
        // Check for invitation
        const inviteQ = query(
          collection(db, 'invitations'), 
          where('email', '==', user.email),
          where('status', '==', 'pending')
        );
        const { getDocs } = await import('firebase/firestore');
        const inviteSnap = await getDocs(inviteQ);

        let initialRole: UserRole = isPresetAdmin ? 'boss' : 'sales';
        
        if (!inviteSnap.empty) {
          const inviteData = inviteSnap.docs[0].data() as Invitation;
          initialRole = inviteData.role;
          // Accept invitation
          await updateDoc(doc(db, 'invitations', inviteSnap.docs[0].id), { status: 'accepted' });
          await logAuditEvent('ACCEPT_INVITATION', 'TEAM', inviteSnap.docs[0].id, { email: user.email, role: initialRole });
        }

        const newProfile: UserProfile = {
          uid: user.uid,
          email: user.email || '',
          displayName: user.displayName || 'BOS User',
          role: initialRole,
          createdAt: new Date().toISOString(),
          lastLogin: new Date().toISOString()
        };
        const { setDoc } = await import('firebase/firestore');
        await setDoc(profileRef, newProfile);
        setUserProfile(newProfile);
        setIsAdmin(newProfile.role === 'boss' || isPresetAdmin);
      }
    });

    return () => unsubscribe();
  }, [auth.currentUser]);

  useEffect(() => {
    // We want the staff list available for role assignments and account ownership
    const usersQ = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    const unsubUsers = onSnapshot(usersQ, (snapshot) => {
      setAllUsers(snapshot.docs.map(doc => doc.data() as UserProfile));
    });

    if (!isAdmin) return () => unsubUsers();

    const invitesQ = query(collection(db, 'invitations'), orderBy('createdAt', 'desc'));
    const unsubInvites = onSnapshot(invitesQ, (snapshot) => {
      setInvitations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any as Invitation)));
    });

    return () => {
      unsubUsers();
      unsubInvites();
    };
  }, [isAdmin]);

  useEffect(() => {
    const q = query(collection(db, 'emails'), orderBy('receivedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const emailData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Email));
      setEmails(emailData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'emails');
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'sent_emails'), orderBy('sentAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSentEmails(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'sent_emails');
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'drafts'), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setDrafts(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'drafts');
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'templates'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const templateData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTemplates(templateData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'templates');
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'tenders'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const tenderData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTenders(tenderData as Tender[]);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'tenders');
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'accounts'), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const accountData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAccounts(accountData as Account[]);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'accounts');
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'proposals'), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const proposalData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setProposals(proposalData as ProposalDocument[]);
      // Sync selected proposal if it exists to pick up remote changes (e.g. boss approval)
      if (selectedProposal) {
        const updated = proposalData.find(p => p.id === selectedProposal.id);
        if (updated) setSelectedProposal(updated as ProposalDocument);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'proposals');
    });
    return () => unsubscribe();
  }, [selectedProposal?.id]);

  useEffect(() => {
    const q = query(collection(db, 'sent_emails'), orderBy('sentAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sentData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSentEmails(sentData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'sent_emails');
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'config'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docs.forEach(doc => {
        if (doc.id === 'prompts') setPromptSettings(doc.data() as any);
        if (doc.id === 'forms') setFormTemplateSettings(doc.data() as any);
        if (doc.id === 'general') setAllowUserEditTemplates(doc.data()?.allowUserEditTemplates ?? true);
      });
    }, (error) => {
      console.warn('Config fetch failed (might be permissions or missing collection):', error);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const emailConnectionsRef = doc(db, 'config', 'email_connections');
    const unsubscribe = onSnapshot(emailConnectionsRef, async (snapshot) => {
      if (snapshot.exists()) {
        setEmailConnections(snapshot.data()?.connections || []);
        setIsEmailConnectionsLoaded(true);
        return;
      }

      try {
        const legacySnapshot = await getDocs(query(collection(db, 'config'), where('id', '==', 'email_connections')));
        if (!legacySnapshot.empty) {
          const legacyConnections = legacySnapshot.docs[0].data()?.connections || [];
          setEmailConnections(legacyConnections);
          await setDoc(emailConnectionsRef, {
            connections: legacyConnections,
            updatedAt: new Date().toISOString(),
            migratedFromLegacy: true
          }, { merge: true });
        } else {
          setEmailConnections([]);
        }
      } catch (error) {
        console.warn('Legacy email connections migration failed:', error);
        setEmailConnections([]);
      } finally {
        setIsEmailConnectionsLoaded(true);
      }
    }, (error) => {
      console.warn('Email connections fetch failed:', error);
      setEmailConnections([]);
      setIsEmailConnectionsLoaded(true);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const aiSettingsRef = doc(db, 'config', 'ai_settings');
    const unsubscribe = onSnapshot(aiSettingsRef, async (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as {
          provider?: 'gemini' | 'qwen';
          model?: string;
          apiKey?: string;
          autoClassifyOnSync?: boolean;
        };
        const provider = data.provider === 'qwen' ? 'qwen' : 'gemini';
        setGeminiConfig({
          provider,
          model: getValidAIModel(provider, data.model),
          apiKey: provider === 'qwen' ? '' : (data.apiKey || ''),
          autoClassifyOnSync: data.autoClassifyOnSync ?? false
        });
        return;
      }

      try {
        const legacyGeminiRef = doc(db, 'config', 'gemini');
        const legacyGeminiSnap = await getDocFromServer(legacyGeminiRef);
        const legacyModel = legacyGeminiSnap.exists() ? (legacyGeminiSnap.data()?.model as string | undefined) : undefined;
        setGeminiConfig({
          provider: 'gemini',
          model: getValidAIModel('gemini', legacyModel),
          apiKey: '',
          autoClassifyOnSync: false
        });
      } catch (error) {
        console.warn('AI settings fallback fetch failed:', error);
        setGeminiConfig({
          provider: 'gemini',
          model: getDefaultAIModel('gemini'),
          apiKey: '',
          autoClassifyOnSync: false
        });
      }
    }, (error) => {
      console.warn('AI settings fetch failed:', error);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!showSettings || settingsTab !== 'AI') return;

    let cancelled = false;
    const loadAIHealth = async () => {
      setIsCheckingAIHealth(true);
      try {
        const status = await getAIHealth();
        if (!cancelled) {
          setAiHealthStatus(status);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load AI health status', error);
          setAiHealthStatus(null);
        }
      } finally {
        if (!cancelled) {
          setIsCheckingAIHealth(false);
        }
      }
    };

    loadAIHealth();
    return () => {
      cancelled = true;
    };
  }, [showSettings, settingsTab]);

  useEffect(() => {
    const q = query(collection(db, 'meetings'), orderBy('date', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const meetingsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Meeting[];
      setMeetings(meetingsData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'meetings');
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'tasks'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const tasksData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Task[];
      setTasks(tasksData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'tasks');
    });
    return () => unsubscribe();
  }, []);

  const handleCreateMeeting = async (meetingData: Partial<Meeting>) => {
    const loadToast = toast.loading('Creating meeting record...');
    try {
      const data = {
        title: meetingData.title || 'Untitled Meeting',
        date: meetingData.date || new Date().toISOString(),
        participants: meetingData.participants || [auth.currentUser?.email || 'Me'],
        notes: meetingData.notes || '',
        actions: meetingData.actions || [],
        followUpEmails: meetingData.followUpEmails || [],
        openQuestions: meetingData.openQuestions || [],
        decisions: meetingData.decisions || [],
        sentimentSummary: meetingData.sentimentSummary || 'Productive',
        consentLogged: true,
        redacted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        uid: auth.currentUser?.uid || 'anonymous'
      };
      const docRef = await addDoc(collection(db, 'meetings'), data);
      toast.success('Meeting created successfully!', { id: loadToast });
      setSelectedMeeting({ id: docRef.id, ...data } as Meeting);
    } catch (err) {
      toast.error('Failed to create meeting.');
      console.error(err);
    }
  };

  const handleDeleteMeeting = async (id: string) => {
    if (!confirm('Are you sure you want to delete this meeting?')) return;
    try {
      await deleteDoc(doc(db, 'meetings', id));
      toast.success('Meeting deleted');
      if (selectedMeeting?.id === id) setSelectedMeeting(null);
    } catch (err) {
      toast.error('Delete failed');
    }
  };

  const handleUpdateMeeting = async (id: string, updates: Partial<Meeting>) => {
    try {
      await updateDoc(doc(db, 'meetings', id), {
        ...updates,
        updatedAt: new Date().toISOString()
      });
      toast.success('Meeting updated');
    } catch (err) {
      toast.error('Update failed');
    }
  };

  const handleCreateTaskFromMeetingSelection = async (meeting: Meeting, action: MeetingAction) => {
    const loadToast = toast.loading('Syncing action item to tasks...');
    try {
      const taskData: Omit<Task, 'id'> = {
        uid: auth.currentUser?.uid || 'anonymous',
        title: action.description,
        description: `Source Meeting: ${meeting.title}\nDate: ${new Date(meeting.date).toLocaleDateString()}`,
        source: {
          module: 'meeting',
          record_id: meeting.id
        },
        assignee: action.ownerEmail,
        owner_id: auth.currentUser?.uid || 'anonymous',
        collaborators: [],
        status: 'todo',
        priority: { score: action.priority as TaskPriority['score'], reason: 'Extracted from meeting notes' },
        due_date: action.dueDate,
        dependencies: [],
        alerts: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await addDoc(collection(db, 'tasks'), taskData);
      toast.success('Action item converted to task!', { id: loadToast });
    } catch (err) {
      toast.error('Failed to create task');
    }
  };

  const handleCreateTask = async (task: Partial<Task>) => {
    const loadToast = toast.loading('Creating task...');
    try {
      const taskData: Omit<Task, 'id'> = {
        uid: auth.currentUser?.uid || 'anonymous',
        title: task.title || 'Untitled Task',
        description: task.description || '',
        source: task.source || { module: 'manual' },
        owner_id: auth.currentUser?.uid || 'anonymous',
        collaborators: task.collaborators || [],
        status: task.status || 'todo',
        priority: task.priority || { score: 3, reason: 'Manual entry' },
        due_date: task.due_date || new Date(Date.now() + 86400000).toISOString(),
        dependencies: [],
        alerts: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await addDoc(collection(db, 'tasks'), taskData);
      toast.success('Task created successfully', { id: loadToast });
    } catch (err) {
      toast.error('Failed to create task');
    }
  };

  const handleDeleteTask = async (id: string) => {
    if (!confirm('Are you sure you want to delete this task?')) return;
    try {
      await deleteDoc(doc(db, 'tasks', id));
      toast.success('Task deleted');
      if (selectedTask?.id === id) setSelectedTask(null);
    } catch (err) {
      toast.error('Delete failed');
    }
  };

  const handlePrioritizeTask = async (task: Task) => {
    setIsPrioritizing(true);
    const prioritizeToast = toast.loading('AI is calculating task priority...');
    try {
      const result = await prioritizeTask(task, { 
        clientTier: 'Gold', 
        businessContext: { activeTendersCount: tenders.length, awardedTotal: 500000 }
      }, geminiConfig);
      
      await updateDoc(doc(db, 'tasks', task.id), {
        priority: {
          score: result.priority_score,
          reason: result.rationale
        },
        ai_suggestions: {
          subtasks: result.subtasks || [],
          time_estimate: result.time_estimate || 'Not specified',
          resource_needs: result.resource_needs || []
        },
        updatedAt: new Date().toISOString()
      });
      toast.success('Task prioritized by AI!', { id: prioritizeToast });
    } catch (err) {
      showAIErrorToast({ title: 'AI prioritization failed.', error: err, id: prioritizeToast });
    } finally {
      setIsPrioritizing(false);
    }
  };

  const handleUpdateTask = async (taskId: string, updates: Partial<Task>) => {
    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        ...updates,
        updatedAt: new Date().toISOString()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tasks/${taskId}`);
    }
  };

  const handleCreateTaskFromEmail = async (email: Email) => {
    const loadToast = toast.loading('Converting email to task...');
    try {
      const taskData: Omit<Task, 'id'> = {
        uid: auth.currentUser?.uid || 'anonymous',
        title: `Follow up: ${email.subject}`,
        description: `Source Email: ${email.body.substring(0, 500)}...`,
        source: {
          module: 'email',
          record_id: email.id
        },
        owner_id: auth.currentUser?.uid || 'anonymous',
        collaborators: [],
        status: 'todo',
        priority: { score: 3, reason: 'Initial triage' },
        due_date: new Date(Date.now() + 86400000 * 2).toISOString(), // 2 days from now
        dependencies: [],
        alerts: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const docRef = await addDoc(collection(db, 'tasks'), taskData);
      toast.success('Task created from email!', { id: loadToast });
      setActiveTab('TASKS');
      setSelectedTask({ id: docRef.id, ...taskData } as Task);
    } catch (err) {
      toast.error('Failed to convert email to task.', { id: loadToast });
    }
  };

  const handleAnalyzeTenderFromEmail = async (email: Email) => {
    setTenderInput(email.body);
    setActiveTab('TENDERS');
    setSelectedTender(null);
    toast.info('Email body copied to Tender. Click "Start AI Analysis" to begin deep extraction.');
  };

  const handleAnalyzeMeeting = async () => {
    if (!meetingNotesInput.trim()) return;
    setIsAnalyzingMeeting(true);
    const analyzeToast = toast.loading('AI is analyzing meeting data...');
    try {
      const result = await analyzeMeetingIntelligence(meetingNotesInput, geminiConfig);
      
      // Save meeting to Firestore
      const meetingData: Omit<Meeting, 'id'> = {
        uid: auth.currentUser?.uid || 'anonymous',
        title: result.title || 'Untitled Meeting',
        date: result.date || new Date().toISOString(),
        participants: result.participants || [],
        notes: meetingNotesInput,
        decisions: result.decisions || [],
        actions: result.actions || [],
        followUpEmails: result.followUpEmails || [],
        openQuestions: result.openQuestions || [],
        sentimentSummary: result.sentimentSummary || '',
        createdAt: new Date().toISOString(),
        consentLogged: true,
        redacted: false
      };
      
      const docRef = await addDoc(collection(db, 'meetings'), meetingData);
      const newMeetingId = docRef.id;

      // Auto-create tasks for each action
      if (result.actions && result.actions.length > 0) {
        for (const action of result.actions) {
          try {
            await addDoc(collection(db, 'tasks'), {
              uid: auth.currentUser?.uid || 'anonymous',
              title: action.description,
              description: `Action item from meeting: ${result.title}`,
              source: {
                module: 'meeting',
                record_id: newMeetingId
              },
              owner_id: auth.currentUser?.uid || 'anonymous',
              collaborators: [],
              status: 'todo',
              priority: { 
                score: (action.priority && action.priority >= 1 && action.priority <= 5) ? action.priority : 3, 
                reason: 'Extracted by AI' 
              },
              due_date: action.dueDate || new Date(Date.now() + 86400000 * 3).toISOString(),
              dependencies: [],
              alerts: [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            });
          } catch (taskErr) {
            console.error('Failed to create companion task for meeting action:', taskErr);
          }
        }
      }

      toast.success('Meeting details captured and tasks assigned!', { id: analyzeToast });
      setMeetingNotesInput('');
      setSelectedMeeting({ id: newMeetingId, ...meetingData } as Meeting);
    } catch (error) {
      console.error('Meeting analysis failed:', error);
      showAIErrorToast({ title: 'Meeting analysis failed.', error, id: analyzeToast });
    } finally {
      setIsAnalyzingMeeting(false);
    }
  };

  const handleCreateFollowUpDraft = (followUp: FollowUpEmail) => {
    setComposeData({
      to: followUp.recipient,
      subject: `Follow-up: ${followUp.subjectHint}`,
      body: `Hi,\n\nFollowing our recent discussion, here are the key points we discussed:\n\n${followUp.keyPoints.map(p => `• ${p}`).join('\n')}\n\nPlease let me know if you have any questions.\n\nBest regards,\n${auth.currentUser?.displayName || 'BIM BOS AI'}`
    });
    setActiveTab('INTAKE');
    setActiveIntakeSubTab('COMPOSE');
    toast.success('Follow-up draft created!');
  };

  const handleSavePromptSettings = async () => {
    try {
      await updateDoc(doc(db, 'config', 'prompts'), { ...promptSettings, updatedAt: new Date().toISOString() });
      toast.success('AI Prompts updated successfully');
    } catch (error) {
      // If doc doesn't exist, try creating it
      try {
        await addDoc(collection(db, 'config'), { ...promptSettings, id: 'prompts', updatedAt: new Date().toISOString() });
        toast.success('AI Prompts created successfully');
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, 'config/prompts');
      }
    }
  };

  const handleSaveGeneralSettings = async () => {
    try {
      const configRef = doc(db, 'config', 'general');
      await updateDoc(configRef, { allowUserEditTemplates, updatedAt: new Date().toISOString() });
      toast.success('General settings updated');
    } catch (error) {
      try {
        await addDoc(collection(db, 'config'), { 
          allowUserEditTemplates, 
          id: 'general', 
          updatedAt: new Date().toISOString() 
        });
        toast.success('General settings initialized');
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, 'config/general');
      }
    }
  };
  const handleSaveFormSettings = async () => {
    try {
      await updateDoc(doc(db, 'config', 'forms'), { ...formTemplateSettings, updatedAt: new Date().toISOString() });
      toast.success('Form Templates updated successfully');
    } catch (error) {
      try {
        await addDoc(collection(db, 'config'), { ...formTemplateSettings, id: 'forms', updatedAt: new Date().toISOString() });
        toast.success('Form Templates created successfully');
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, 'config/forms');
      }
    }
  };

  const handleSaveGeminiSettings = async () => {
    try {
      const apiKeyToStore = geminiConfig.provider === 'qwen' ? '' : (geminiConfig.apiKey || '');
      await setDoc(doc(db, 'config', 'ai_settings'), {
        provider: geminiConfig.provider,
        model: geminiConfig.model,
        apiKey: apiKeyToStore,
        autoClassifyOnSync: geminiConfig.autoClassifyOnSync ?? false,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      toast.success('AI settings updated');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'config/ai_settings');
    }
  };

  const handleTestAIConnection = async () => {
    setIsTestingAIConnection(true);
    const toastId = toast.loading(`Testing ${geminiConfig.provider === 'qwen' ? 'Qwen' : 'Gemini'} connection...`);

    try {
      const status = await getAIHealth();
      setAiHealthStatus(status);

      const result = await testAIConnection(geminiConfig);
      if (result.ok) {
        toast.success(`${geminiConfig.provider === 'qwen' ? 'Qwen' : 'Gemini'} connection is working.`, {
          id: toastId,
          description: result.attempts && result.attempts > 1
            ? `${result.response} Recovered after ${result.attempts} attempts.`
            : result.response
        });
      } else {
        toast.error('AI responded, but the test output was unexpected.', {
          id: toastId,
          description: result.response
        });
      }
    } catch (error) {
      showAIErrorToast({ title: 'AI connection test failed.', error, id: toastId });
    } finally {
      setIsTestingAIConnection(false);
    }
  };

  const handleSaveEmailConnections = async (updatedConnections: any[]) => {
    try {
      const configRef = doc(db, 'config', 'email_connections');
      await setDoc(
        configRef,
        {
          connections: updatedConnections,
          updatedAt: new Date().toISOString()
        },
        { merge: true }
      );
      toast.success('Connections saved');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'config/email_connections');
    }
  };

  const handleCreateAccount = async (accountData: Partial<Account>) => {
    try {
      const owner = allUsers.find(u => u.uid === accountData.owner_id) || userProfile;
      const newAccount = {
        ...accountData,
        owner_id: owner?.uid || auth.currentUser?.uid,
        owner_email: owner?.email || auth.currentUser?.email,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        internal_notes: [],
        active_opportunities: [],
        past_quotes: [],
        won_value_ytd: 0,
        email_volume_30d: 0,
        meeting_count_30d: 0,
        sentiment_trend: 'stable'
      };
      await addDoc(collection(db, 'accounts'), newAccount);
      await logAuditEvent('REGISTER_ACCOUNT', 'ACCOUNTS', undefined, { name: accountData.name });
      toast.success('VIP registered successfully');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'accounts');
    }
  };

  const openAccountModal = (account?: Account | Partial<Account>) => {
    if (account && 'id' in account) {
      const fullAccount = account as Account;
      setEditingAccount(fullAccount);
      setAccountInitialData(fullAccount);
      setAccountForm({
        name: fullAccount.name,
        industry: fullAccount.industry || '',
        tier: fullAccount.tier || 'standard',
        primary_contact_name: fullAccount.primary_contact?.name || '',
        primary_contact_email: fullAccount.primary_contact?.email || '',
        primary_contact_mobile: fullAccount.primary_contact?.mobile || '',
        primary_contact_position: fullAccount.primary_contact?.position || '',
        owner_id: fullAccount.owner_id || auth.currentUser?.uid || ''
      });
    } else if (account) {
      const partial = account as Partial<Account>;
      setEditingAccount(null);
      setAccountInitialData(partial);
      setAccountForm({
        name: partial.name || '',
        industry: partial.industry || '',
        tier: partial.tier || 'standard',
        primary_contact_name: partial.primary_contact?.name || '',
        primary_contact_email: partial.primary_contact?.email || '',
        primary_contact_mobile: partial.primary_contact?.mobile || '',
        primary_contact_position: partial.primary_contact?.position || '',
        owner_id: partial.owner_id || auth.currentUser?.uid || ''
      });
    } else {
      setEditingAccount(null);
      setAccountInitialData(null);
      setAccountForm({
        name: '',
        industry: '',
        tier: 'standard',
        primary_contact_name: '',
        primary_contact_email: '',
        primary_contact_mobile: '',
        primary_contact_position: '',
        owner_id: auth.currentUser?.uid || ''
      });
    }
    setIsAccountModalOpen(true);
  };

  const handleAccountSubmit = async () => {
    if (!accountForm.name) {
      toast.error('Account name is required');
      return;
    }
    const owner = allUsers.find(u => u.uid === accountForm.owner_id);
    const accountData: any = {
      ...(accountInitialData || {}),
      name: accountForm.name,
      industry: accountForm.industry,
      tier: accountForm.tier,
      owner_id: accountForm.owner_id,
      owner_email: owner?.email || accountInitialData?.owner_email || auth.currentUser?.email,
      primary_contact: {
        ...(accountInitialData?.primary_contact || {}),
        name: accountForm.primary_contact_name,
        email: accountForm.primary_contact_email,
        mobile: accountForm.primary_contact_mobile,
        position: accountForm.primary_contact_position
      }
    };

    if (editingAccount) {
      await handleUpdateAccount(editingAccount.id, accountData);
      if (selectedAccount?.id === editingAccount.id) {
        setSelectedAccount(prev => prev ? { ...prev, ...accountData } : null);
      }
    } else {
      await handleCreateAccount(accountData);
    }
    setIsAccountModalOpen(false);
  };

  const handleUpdateAccount = async (id: string, updates: Partial<Account>) => {
    try {
      await updateDoc(doc(db, 'accounts', id), {
        ...updates,
        updatedAt: new Date().toISOString()
      });
      toast.success('VIP updated successfully');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `accounts/${id}`);
    }
  };

  const handleDeleteAccount = async (id: string) => {
    if (!confirm('Are you sure you want to delete this VIP account?')) return;
    try {
      await deleteDoc(doc(db, 'accounts', id));
      await logAuditEvent('DELETE_ACCOUNT', 'ACCOUNTS', id);
      toast.success('VIP deleted successfully');
      if (selectedAccount?.id === id) setSelectedAccount(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `accounts/${id}`);
    }
  };

  const handleCreateProposal = async (opportunity: any, tender?: any, account?: any) => {
    try {
      const newProposal: Partial<ProposalDocument> = {
        type: 'proposal',
        opportunity_id: opportunity.id || '',
        tender_id: tender?.id || '',
        client_id: account?.id || '',
        client_name: account?.name || opportunity.extractedData?.clientName || 'Unknown Client',
        title: `Proposal for ${opportunity.extractedData?.projectName || 'Project'}`,
        status: 'draft',
        sections: [],
        pricing: { items: [], subtotal: 0, tax: 0, total: 0 },
        reviewers: [],
        client_feedback: [],
        generated_at: new Date().toISOString(),
        version_history: [{
          version: 1,
          updatedBy: auth.currentUser?.email || 'admin',
          timestamp: new Date().toISOString(),
          changeSummary: 'Initial generation'
        }],
        createdBy: auth.currentUser?.email || 'admin',
        uid: auth.currentUser?.uid || 'anonymous',
        ownerEmail: auth.currentUser?.email || 'admin',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const docRef = await addDoc(collection(db, 'proposals'), newProposal);
      await logAuditEvent('CREATE_PROPOSAL', 'PROPOSALS', docRef.id, { title: newProposal.title });
      toast.success('Proposal draft created');
      setActiveTab('PROPOSALS');
      return docRef.id;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'proposals');
    }
  };

  const handleUpdateProposal = async (id: string, updates: Partial<ProposalDocument>) => {
    try {
      await updateDoc(doc(db, 'proposals', id), {
        ...updates,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `proposals/${id}`);
    }
  };

  const handleGenerateAIProposal = async (proposal: ProposalDocument) => {
    setIsGeneratingProposal(true);
    try {
      // Fetch context
      const opportunity = emails.find(e => e.id === proposal.opportunity_id);
      const tender = tenders.find(t => t.id === proposal.tender_id);
      const account = accounts.find(a => a.id === proposal.client_id);
      
      const aiResponse = await generateStructuredProposal({
        opportunity,
        tender,
        account,
        pastWins: [] // Filter awarded tenders here later
      });

      const sections: DocumentSection[] = aiResponse.sections.map((s: any, idx: number) => ({
        id: `section-${idx}-${Date.now()}`,
        title: s.title,
        content_html: s.content,
        ai_suggested: true,
        approved: false,
        confidence: s.confidence
      }));

      const pricing: Pricing = {
        items: aiResponse.pricing_suggestions.map((p: any, idx: number) => ({
          id: `item-${idx}`,
          description: p.description,
          qty: 1,
          unit_price: p.suggested_amount,
          total: p.suggested_amount
        })),
        subtotal: aiResponse.pricing_suggestions.reduce((acc: number, p: any) => acc + p.suggested_amount, 0),
        tax: 0,
        total: aiResponse.pricing_suggestions.reduce((acc: number, p: any) => acc + p.suggested_amount, 0)
      };

      await handleUpdateProposal(proposal.id, { sections, pricing });
      toast.success('AI Draft Generated');
    } catch (error) {
      console.error('AI Generation Failed:', error);
      showAIErrorToast({ title: 'Proposal generation failed.', error });
    } finally {
      setIsGeneratingProposal(false);
    }
  };

  const handleLogInteraction = async (accountId: string, noteText: string) => {
    try {
      const accountRef = doc(db, 'accounts', accountId);
      const account = accounts.find(a => a.id === accountId);
      if (!account) return;

      const newNote = {
        userId: auth.currentUser?.uid || 'unknown',
        userEmail: auth.currentUser?.email || 'unknown',
        text: noteText,
        timestamp: new Date().toISOString()
      };

      await updateDoc(accountRef, {
        internal_notes: [...account.internal_notes, newNote],
        updatedAt: new Date().toISOString(),
        last_contact_date: new Date().toISOString()
      });
      toast.success('Interaction logged');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `accounts/${accountId}`);
    }
  };

  const handleAnalyzeAccountHealth = async (accountId: string) => {
    const account = accounts.find(a => a.id === accountId);
    if (!account) return;

    setIsAnalyzingAccount(true);
    const toastId = toast.loading(`Analyzing health for ${account.name}...`);
    try {
      // Fetch interactions - in real app we'd query email/meeting collections
      // For now we use the ones we have in state or empty lists
      const relatedEmails = emails.filter(e => e.from.includes(account.primary_contact.email) || account.additional_contacts.some(c => e.from.includes(c.email)));
      const relatedMeetings = meetings.filter(m => m.participants.some(p => p.includes(account.name) || p.includes(account.primary_contact.email)));
      const accountOpps = templates.filter(t => t.data?.clientName === account.name || t.data?.clientEmail === account.primary_contact.email);

      const insights = await analyzeAccountHealth(account, { emails: relatedEmails, meetings: relatedMeetings }, accountOpps);
      
      const accountRef = doc(db, 'accounts', accountId);
      await updateDoc(accountRef, {
        ai_insights: insights,
        updatedAt: new Date().toISOString()
      });
      
      toast.success('Health analysis complete', { id: toastId });
    } catch (error) {
      showAIErrorToast({ title: 'Account health analysis failed.', error, id: toastId });
    } finally {
      setIsAnalyzingAccount(false);
    }
  };

  // AI Orchestration Logic
  useEffect(() => {
    // Generate initial proactive alerts
    const fetchAlerts = async () => {
      const cache: BusinessContextCache = {
        keyAccounts: emailConnections.slice(0, 3).map(c => ({ id: c.id, name: c.name, lastContact: 'Today', status: 'Active' })),
        activeTenders: tenders.slice(0, 3).map(t => ({ id: t.id, title: t.title || 'Untitled', deadline: t.deadline || 'TBA', value: t.value_range?.max || 0 })),
        pendingQuotes: templates.filter(t => t.status === 'OPPORTUNITIES').slice(0, 3).map(t => ({ id: t.id, client: t.data?.client || 'Unknown', amount: t.data?.estimateValue || 0, daysPending: 2 })),
        activeTasks: tasks.filter(t => t.status !== 'done').slice(0, 5).map(t => ({ id: t.id, title: t.title, priority: t.priority.score, dueDate: t.due_date, status: t.status }))
      };
      const alerts = await generateProactiveAlerts(userContext, cache, geminiConfig);
      setAiAlerts(alerts);
    };
    if (activeTab === 'DASHBOARD' || activeTab === 'INTAKE') fetchAlerts();
  }, [tenders, templates, emailConnections, tasks, activeTab, userContext, geminiConfig]);

  const handleAiMessage = async (content: string) => {
    // 1. Add User Message
    const userMsg = { role: 'user' as const, content, timestamp: new Date().toISOString() };
    setAiMemory(prev => ({ ...prev, history: [...prev.history, userMsg] }));

    let response;
    try {
      // 2. Orchestrate
      response = await routeIntent(content, userContext, aiMemory, geminiConfig);
    } catch (error) {
      console.error('AI assistant request failed:', error);
      showAIErrorToast({ title: 'AI assistant request failed.', error });
      const aiErrorMsg = {
        role: 'model' as const,
        content: 'I ran into an AI connection problem while processing that request. Please try again.',
        timestamp: new Date().toISOString()
      };
      setAiMemory(prev => ({ ...prev, history: [...prev.history, aiErrorMsg] }));
      return;
    }
    
    // 3. Handle Function Calls (Data Filling)
    if (response.functionCalls && response.functionCalls.length > 0) {
      for (const call of response.functionCalls) {
        try {
          if (!call.args) {
            console.warn(`AI Tool ${call.name} called without arguments.`);
            continue;
          }
          if (call.name === 'create_task') {
            const { title, description, dueDate, priority, assignee } = call.args;
            await addDoc(collection(db, 'tasks'), {
              uid: auth.currentUser?.uid,
              owner_id: auth.currentUser?.uid,
              title,
              description: description || 'No description provided.',
              status: 'todo',
              priority: { score: priority || 3, reason: "AI Generated" },
              due_date: dueDate || new Date(Date.now() + 86400000).toISOString(),
              source: { module: 'manual' },
              assignee: assignee || auth.currentUser?.email,
              collaborators: [],
              dependencies: [],
              alerts: [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            });
            toast.success(`AI Task Created: ${title}`);
          } else if (call.name === 'register_account') {
            const { name, industry, tier, website } = call.args;
            await addDoc(collection(db, 'accounts'), {
              owner_id: auth.currentUser?.uid,
              owner_email: auth.currentUser?.email,
              name,
              industry,
              tier: (tier?.toLowerCase().includes('strategic') ? 'strategic' : tier?.toLowerCase().includes('priority') ? 'priority' : 'standard'),
              website: website || '',
              primary_contact: { name: 'Unassigned', email: '', phone: '', role: '' },
              additional_contacts: [],
              last_contact_date: new Date().toISOString(),
              sentiment_trend: 'stable',
              email_volume_30d: 0,
              meeting_count_30d: 0,
              active_opportunities: [],
              past_quotes: [],
              won_value_ytd: 0,
              internal_notes: [{
                userId: auth.currentUser?.uid,
                userEmail: auth.currentUser?.email,
                text: "Account registered by AI Assistant.",
                timestamp: new Date().toISOString()
              }],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            });
            toast.success(`AI Account Registered: ${name}`);
          } else if (call.name === 'search_data') {
            const { query: searchQuery, module } = call.args;
            toast.info(`AI Searching ${module} for: ${searchQuery}`);
            // Search logic already handled by AI context mostly, 
            // but we can provide a small toast or visual cue.
          }
        } catch (err) {
          console.error("AI Tool Execution Failed:", err);
          showAIErrorToast({ title: 'AI action failed.', error: err });
        }
      }
    }

    // 4. Add AI Response
    const aiMsg = { role: 'model' as const, content: response.explanation, timestamp: new Date().toISOString() };
    setAiMemory(prev => ({ ...prev, history: [...prev.history, aiMsg] }));

    // 5. Handle Routing
    if (response.confidence > 0.8 && response.targetModule) {
      const mod = response.targetModule.toUpperCase();
      if (mod !== activeTab && ['DASHBOARD', 'INTAKE', 'BUSINESS', 'REPORTING', 'TENDERS', 'SUPPORT', 'ACCOUNTS', 'MEETINGS', 'TASKS'].includes(mod)) {
        setActiveTab(mod as any);
        toast.info(`Switching to ${mod}...`, {
          icon: <Sparkles className="w-4 h-4 text-[#7F56D9]" />
        });
      }
    }
  };

  const handleCommandPaletteAction = (actionId: string) => {
    switch (actionId) {
      case 'goto-inbox': 
        setActiveTab('INTAKE');
        setActiveIntakeSubTab('INBOX');
        break;
      case 'goto-tenders':
        setActiveTab('TENDERS');
        break;
      case 'goto-meetings':
        setActiveTab('MEETINGS');
        break;
      case 'analyze-meeting':
        setActiveTab('MEETINGS');
        handleAnalyzeMeeting();
        break;
      case 'settings':
        setShowSettings(true);
        break;
      case 'ai-summary':
        setActiveTab('AI');
        handleAiMessage("Give me a high-level summary of my business today.");
        break;
    }
  };

  const handleSync = async (forceConnections?: any[], customDays?: number) => {
    const connectionsToSync = forceConnections || emailConnections.filter(c => syncConnectionIds.includes(c.user) || syncConnectionIds.length === 0);
    const daysToSync = customDays || syncDays;

    if (connectionsToSync.length === 0) {
      toast.error('No connections selected for sync', { description: 'Select at least one account in the sync settings.' });
      return;
    }

    setIsSyncing(true);
    const syncToast = toast.loading(`Syncing ${connectionsToSync.length} account(s) for last ${daysToSync} days...`);
    
    let totalNewCount = 0;
    let failedAccounts: string[] = [];

    try {
      for (const connection of connectionsToSync) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort('Sync timed out'), 120000);

        try {
          console.log(`Syncing account: ${connection.user} for ${daysToSync} days...`);
          const response = await apiFetch('/api/emails/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connection, days: daysToSync }),
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          const data = await response.json();
          if (response.ok && data.emails) {
            let accountNewCount = 0;
            for (const email of data.emails) {
              const exists = emails.find(e => e.uid === email.uid);
              if (!exists) {
                accountNewCount++;
                const docRef = await addDoc(collection(db, 'emails'), {
                  ...email,
                  status: 'PENDING',
                  isRead: false,
                  receivedAt: email.receivedAt || new Date().toISOString()
                });

                if (geminiConfig.autoClassifyOnSync) {
                  try {
                    const aiResult = await classifyEmail(email, promptSettings.classifyEmail, geminiConfig);
                    await updateDoc(doc(db, 'emails', docRef.id), buildEmailAIUpdate(aiResult));
                  } catch (aiErr) {
                    console.error('AI Classification failed during sync:', email.uid, aiErr);
                  }
                }
              }
            }
            totalNewCount += accountNewCount;
          } else {
            console.error(`Sync failed for ${connection.user}:`, data.error);
            failedAccounts.push(connection.user);
          }
        } catch (err: any) {
          console.error(`Network sync error for ${connection.user}:`, err);
          failedAccounts.push(connection.user);
        }
      }

      if (failedAccounts.length === 0) {
        toast.success(`Sync complete. ${totalNewCount} new emails found.`, { id: syncToast });
      } else {
        toast.warning(`Sync partially complete. ${totalNewCount} new emails found. Failed: ${failedAccounts.join(', ')}`, { 
          id: syncToast,
          duration: 5000
        });
      }
    } catch (error: any) {
      toast.error('Sync failed', { id: syncToast });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleConfirm = async (email: Email) => {
    try {
      const refPrefix = 
        email.aiClassification === 'OPPORTUNITY' ? 'OPP' : 
        email.aiClassification === 'REQUEST' ? 'REQ' : 
        email.aiClassification === 'SUBMITTED' ? 'SUB' : 'AWARD';
      
      const refNum = `${refPrefix}/${new Date().getFullYear()}/${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
      
      // Map classification to status
      let targetStatus = 'OPPORTUNITIES';
      if (email.aiClassification === 'REQUEST') targetStatus = 'REQUEST';
      if (email.aiClassification === 'SUBMITTED') targetStatus = 'SUBMITTED';
      if (email.aiClassification === 'AWARDED') targetStatus = 'AWARDED';

      try {
        await addDoc(collection(db, 'templates'), {
          referenceNumber: refNum,
          templateType: email.aiClassification,
          emailId: email.id,
          data: email.extractedData,
          status: targetStatus,
          createdAt: new Date().toISOString(),
          assignedTo: auth.currentUser?.email
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, 'templates');
      }

      try {
        await updateDoc(doc(db, 'emails', email.id), {
          status: 'CONFIRMED'
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `emails/${email.id}`);
      }
      
      toast.success('Record confirmed and converted successfully');
      setSelectedEmail(null);
    } catch (error) {
      console.error('Confirmation failed:', error);
      toast.error('Confirmation failed', {
        description: error instanceof Error ? error.message : 'Missing or insufficient permissions.'
      });
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'templates', id));
      toast.success('Record deleted successfully');
    } catch (error) {
      console.error('Delete failed:', error);
      handleFirestoreError(error, OperationType.DELETE, `templates/${id}`);
    }
  };

  const handleUpdateTemplateStatus = async (id: string, newStatus: string) => {
    try {
      await updateDoc(doc(db, 'templates', id), { status: newStatus });
      toast.success(`Status updated to ${newStatus}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `templates/${id}`);
    }
  };

  const handleSaveTemplateEdit = async () => {
    if (!selectedTemplate) return;
    try {
      await updateDoc(doc(db, 'templates', selectedTemplate.id), { data: editData });
      toast.success('Record updated successfully');
      setIsEditingTemplate(false);
      setSelectedTemplate(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `templates/${selectedTemplate.id}`);
    }
  };

  const handleDeleteEmail = async (id: string) => {
    try {
      if (activeIntakeSubTab === 'TRASH') {
        if (!confirm('Permanently delete this email?')) return;
        await deleteDoc(doc(db, 'emails', id));
        toast.success('Email permanently deleted');
      } else {
        await updateDoc(doc(db, 'emails', id), { isDeleted: true });
        toast.success('Email moved to trash');
      }
      if (selectedEmail?.id === id) setSelectedEmail(null);
    } catch (error) {
      console.error('Email delete failed:', error);
      handleFirestoreError(error, OperationType.DELETE, `emails/${id}`);
    }
  };

  const handleUpdateEmailClassification = async (emailId: string, newClassification: string) => {
    try {
      await updateDoc(doc(db, 'emails', emailId), {
        aiClassification: newClassification,
        updatedAt: new Date().toISOString()
      });
      if (selectedEmail?.id === emailId) {
        setSelectedEmail(prev => prev ? { ...prev, aiClassification: newClassification } : null);
      }
      toast.success(`Classification updated to ${newClassification}`);
      await logAuditEvent('UPDATE_EMAIL_CLASSIFICATION', 'EMAILS', emailId, { newClassification });
    } catch (error) {
      console.error('Failed to update classification:', error);
      toast.error('Failed to update classification');
    }
  };

  const handleDeleteAllOther = async () => {
    if (!confirm('Are you sure you want to move all "Other" emails to trash?')) return;
    try {
      const otherEmails = emails.filter(e => 
        e.aiClassification === 'OTHER' && 
        !e.isDeleted && 
        canAccessEmail(e)
      );
      
      if (otherEmails.length === 0) return;

      const batch = writeBatch(db);
      otherEmails.forEach(e => {
        batch.update(doc(db, 'emails', e.id), { isDeleted: true });
      });
      await batch.commit();
      
      toast.success(`Moved ${otherEmails.length} "Other" emails to trash`);
      if (selectedEmail && otherEmails.find(e => e.id === selectedEmail.id)) {
        setSelectedEmail(null);
      }
    } catch (error) {
      console.error('Delete all other failed:', error);
      handleFirestoreError(error, OperationType.DELETE, 'emails/batch-other');
    }
  };

  const handleReAnalyze = async (email: Email) => {
    setIsAnalyzing(true);
    const analyzeToast = toast.loading('AI is re-analyzing email...');
    try {
      const aiResult = await classifyEmail(email, promptSettings.classifyEmail, geminiConfig);
      const emailAIUpdate = buildEmailAIUpdate(aiResult);
      try {
        await updateDoc(doc(db, 'emails', email.id), emailAIUpdate);
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `emails/${email.id}`);
      }
      setSelectedEmail({
        ...email,
        ...emailAIUpdate
      });
      toast.success('Re-analysis complete', { id: analyzeToast });
    } catch (error) {
      console.error('Re-analysis failed:', error);
      showAIErrorToast({ title: 'Email re-analysis failed.', error, id: analyzeToast });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAnalyzeTender = async () => {
    if (!tenderInput.trim()) return;
    setIsAnalyzingTender(true);
    const analyzeToast = toast.loading('AI is analyzing tender documents...');
    try {
      const analysis = await analyzeTender(tenderInput, promptSettings.analyzeTender, geminiConfig);
      
      const tenderData: Omit<Tender, 'id'> = {
        uid: auth.currentUser?.uid || 'anonymous',
        title: analysis.title || 'Untitled Tender',
        issuing_org: analysis.issuing_org || 'Unknown',
        deadline: analysis.deadline || 'TBA',
        value_range: analysis.value_range || { min: 0, max: 0, currency: 'USD' },
        requirements: (analysis.requirements || []).map((r: any) => ({ ...r, compliant: false })),
        evaluation_criteria: analysis.evaluation_criteria || [],
        contacts: analysis.contacts || [],
        win_themes: analysis.win_themes || [],
        competitor_notes: '',
        risk_assessment: analysis.risk_assessment || [],
        status: 'draft',
        win_probability: analysis.win_probability_hint || 50,
        assigned_team: [auth.currentUser?.uid || 'anonymous'],
        internal_comments: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const docRef = await addDoc(collection(db, 'tenders'), tenderData);
      setTenderInput('');
      toast.success('Tender intelligence extracted!', { id: analyzeToast });
      setSelectedTender({ id: docRef.id, ...tenderData });
    } catch (error) {
      console.error('Tender analysis failed:', error);
      showAIErrorToast({ title: 'Tender analysis failed.', error, id: analyzeToast });
    } finally {
      setIsAnalyzingTender(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const uploadToast = toast.loading(`Uploading ${files.length} document(s)...`);
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    try {
      const response = await apiFetch('/api/tenders/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Upload failed');
      }

      const data = await response.json();
      const results = data.results || [];
      
      let combinedText = '';
      
      for (const result of results) {
        if (result.type === 'text') {
          combinedText += `\n--- Document: ${result.name} ---\n${result.content}\n`;
        } else if (result.type === 'ocr_needed') {
          toast.loading(`Performing AI OCR on ${result.name}...`, { id: uploadToast });
          try {
            const ocrText = await ocrDocument(result.data, result.mimeType, geminiConfig);
            combinedText += `\n--- Document: ${result.name} (OCR) ---\n${ocrText}\n`;
          } catch (ocrErr) {
            console.error(`OCR failed for ${result.name}:`, ocrErr);
            showAIErrorToast({ title: `OCR failed for ${result.name}.`, error: ocrErr, id: uploadToast });
          }
        }
      }

      if (combinedText) {
        setTenderInput(prev => prev ? `${prev}\n\n${combinedText}` : combinedText);
        toast.success('Documents processed successfully', { id: uploadToast });
      } else {
        toast.error('No text could be extracted from documents', { id: uploadToast });
      }
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error(error.message || 'Failed to process documents', { id: uploadToast });
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  const handleUpdateTender = async (tenderId: string, updates: Partial<Tender>) => {
    try {
      await updateDoc(doc(db, 'tenders', tenderId), {
        ...updates,
        updatedAt: new Date().toISOString()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tenders/${tenderId}`);
    }
  };

  const handleCreateAccountFromEmail = async (email: Email) => {
    const defaultCompany = email.extractedData?.clientName || email.from.split('@')[1]?.split('.')[0].toUpperCase() || 'UNKNOWN CLIENT';
    const defaultSender = email.from.split('<')[0].trim() || 'Primary Contact';
    
    const initialData: Partial<Account> = {
      name: defaultCompany,
      industry: 'Construction & Finance',
      tier: 'strategic',
      primary_contact: {
        name: defaultSender,
        email: email.from.match(/<(.+)>/)?.[1] || email.from,
        mobile: '',
        position: 'Key Stakeholder'
      }
    };

    openAccountModal(initialData);
  };

  const handleConvertEmailToMeeting = async (email: Email) => {
    const convertToast = toast.loading('Analyzing email content...');
    try {
      // 1. Analyze with Gemini
      const analysis = await analyzeMeetingIntelligence(email.body, geminiConfig);
      
      const meetingDate = analysis.date || new Date().toISOString().split('T')[0];

      toast.loading('Creating Meeting Intelligence...', { id: convertToast });
      
      // 2. Create Meeting
      const meetingData = {
        title: analysis.title || `Email: ${email.subject}`,
        date: meetingDate,
        notes: email.body,
        participants: Array.from(new Set([email.from, auth.currentUser?.email || 'Me', ...(analysis.participants || [])])),
        decisions: analysis.decisions || [],
        actions: analysis.actions || [],
        followUpEmails: analysis.followUpEmails || [],
        openQuestions: analysis.openQuestions || [],
        sentimentSummary: analysis.sentimentSummary || 'Productive Correspondence',
        consentLogged: true,
        redacted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        uid: auth.currentUser?.uid || 'anonymous'
      };
      
      const meetingRef = await addDoc(collection(db, 'meetings'), meetingData);
      const newMeetingId = meetingRef.id;

      // 3. Create Task
      const taskData: Omit<Task, 'id'> = {
        uid: auth.currentUser?.uid || 'anonymous',
        title: `Related Actions: ${email.subject}`,
        description: `Reference: ${email.from}. AI Recommendations: ${analysis.actions?.slice(0, 3).map((a: any) => a.description).join(', ') || 'Review document'}`,
        source: {
          module: 'meeting',
          record_id: newMeetingId
        },
        owner_id: auth.currentUser?.uid || 'anonymous',
        collaborators: [],
        status: 'todo',
        priority: { score: 4, reason: 'Extracted from Intelligence Hub' },
        due_date: new Date(Date.now() + 86400000 * 2).toISOString(),
        dependencies: [],
        alerts: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await addDoc(collection(db, 'tasks'), taskData);

      toast.success('Successfully recorded meeting intelligence!', { id: convertToast });
      
      // Navigate and Select
      setSelectedMeeting({ id: newMeetingId, ...meetingData } as Meeting);
      setActiveTab('MEETINGS');
      setActiveMeetingSubTab('INTELLIGENCE');
      setShowEmailSelectorForMeeting(false);
    } catch (error) {
      console.error('Meeting conversion failed:', error);
      showAIErrorToast({ title: 'Meeting conversion failed.', error, id: convertToast });
    }
  };

  const handleCreateBid = async (tender: any) => {
    setIsGeneratingBid(true);
    const bidToast = toast.loading('AI is generating bid draft...');
    try {
      const draft = await createBidDraft(tender, promptSettings.createBidDraft, geminiConfig);
      setBidDraft(draft);
      await updateDoc(doc(db, 'tenders', tender.id), {
        bidDraft: draft,
        status: 'BID_CREATED',
        updatedAt: new Date().toISOString()
      });
      toast.success('Bid draft generated!', { id: bidToast });
    } catch (error) {
      console.error('Bid generation failed:', error);
      showAIErrorToast({ title: 'Bid draft generation failed.', error, id: bidToast });
    } finally {
      setIsGeneratingBid(false);
    }
  };

  const handleDeleteTender = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'tenders', id));
      toast.success('Tender deleted');
      if (selectedTender?.id === id) setSelectedTender(null);
    } catch (error) {
      console.error('Tender delete failed:', error);
      handleFirestoreError(error, OperationType.DELETE, `tenders/${id}`);
    }
  };

  const handleConvertAwardToAccount = async (email: Email) => {
    const companyName = email.extractedData?.clientName || email.from.split('@')[1]?.split('.')[0].toUpperCase() || 'UNKNOWN CLIENT';
    const senderName = email.from.split('<')[0].trim() || 'Primary Contact';
    
    const initialData: Partial<Account> = {
      name: companyName,
      industry: 'Construction & Finance',
      tier: 'strategic',
      primary_contact: {
        name: senderName,
        email: email.from.match(/<(.+)>/)?.[1] || email.from,
        mobile: '',
        position: 'Decision Maker'
      }
    };
    
    openAccountModal(initialData);
  };

  const handleGenerateReply = async (email: Email) => {
    if (!replyPrompt.trim()) {
      toast.error('Please enter a prompt for the reply');
      return;
    }
    setIsGeneratingReply(true);
    const replyToast = toast.loading('AI is drafting a reply...');
    try {
      const draft = await generateReplyDraft(email, replyPrompt, geminiConfig);
      setAiReplyDraft(draft);
      toast.success('Reply draft generated!', { id: replyToast });
    } catch (error) {
      console.error('Reply generation failed:', error);
      showAIErrorToast({ title: 'Reply draft generation failed.', error, id: replyToast });
    } finally {
      setIsGeneratingReply(false);
    }
  };

  const handleSaveReplyToHistory = async (email: Email, draft: string) => {
    try {
      await addDoc(collection(db, 'replies'), {
        emailId: email.id,
        emailSubject: email.subject,
        emailFrom: email.from,
        replyContent: draft,
        prompt: replyPrompt,
        createdAt: new Date().toISOString(),
        createdBy: auth.currentUser?.email
      });
      toast.success('Reply draft saved to history');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'replies');
    }
  };

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;
    setIsInviting(true);
    try {
      const newInvitation: Omit<Invitation, 'id'> = {
        email: inviteEmail,
        role: inviteRole,
        token: Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15),
        invitedBy: auth.currentUser?.email || '',
        createdAt: new Date().toISOString(),
        status: 'pending'
      };
      await addDoc(collection(db, 'invitations'), newInvitation);
      await logAuditEvent('SEND_INVITATION', 'TEAM', undefined, { email: inviteEmail, role: inviteRole });
      toast.success(`Invitation sent to ${inviteEmail}`);
      setInviteEmail('');
    } catch (error) {
      toast.error('Failed to send invitation');
    } finally {
      setIsInviting(false);
    }
  };

  const handleSendEmail = async () => {
    if (!composeData.to || !composeData.subject || !composeData.body) {
      toast.error('Please fill in all fields (To, Subject, Message)');
      return;
    }

    if (emailConnections.length === 0) {
      toast.error('No email accounts connected', { description: 'Connect an email account in settings first.' });
      return;
    }

    const connection = emailConnections[0]; // Use the first connected account
    setIsSending(true);
    const sendToast = toast.loading('Sending email...');

    try {
      const res = await apiFetch('/api/emails/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connection,
          message: {
            to: composeData.to,
            subject: composeData.subject,
            body: composeData.body
          }
        })
      });

      const data = await res.json();
      if (res.ok) {
        // Record in Firestore
        await addDoc(collection(db, 'sent_emails'), {
          ...composeData,
          sentAt: new Date().toISOString(),
          from: connection.user,
          messageId: data.messageId
        });

        toast.success('Email sent successfully', { id: sendToast });
        setActiveIntakeSubTab('INBOX');
        setComposeData({ to: '', subject: '', body: '' });
      } else {
        toast.error(data.error || 'Failed to send email', { id: sendToast, description: data.details });
      }
    } catch (error: any) {
      console.error('Send failed:', error);
      toast.error('Network error while sending', { id: sendToast });
    } finally {
      setIsSending(false);
    }
  };

  const handleDeleteReplyHistory = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'replies', id));
      toast.success('Reply record deleted');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `replies/${id}`);
    }
  };

  const handleManualConvert = async (email: Email, classification: string) => {
    try {
      const refPrefix = 
        classification === 'OPPORTUNITY' ? 'OPP' : 
        classification === 'REQUEST' ? 'REQ' : 
        classification === 'SUBMITTED' ? 'SUB' : 'AWARD';
      
      const refNum = `${refPrefix}/${new Date().getFullYear()}/${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
      
      let targetStatus = 'OPPORTUNITIES';
      if (classification === 'REQUEST') targetStatus = 'REQUEST';
      if (classification === 'SUBMITTED') targetStatus = 'SUBMITTED';
      if (classification === 'AWARDED') targetStatus = 'AWARDED';

      try {
        await addDoc(collection(db, 'templates'), {
          referenceNumber: refNum,
          templateType: classification,
          emailId: email.id,
          data: email.extractedData || {},
          status: targetStatus,
          createdAt: new Date().toISOString(),
          assignedTo: auth.currentUser?.email
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, 'templates');
      }

      try {
        await updateDoc(doc(db, 'emails', email.id), {
          status: 'CONFIRMED',
          aiClassification: classification
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `emails/${email.id}`);
      }
      
      toast.success(`Manually converted to ${classification}`);
      setSelectedEmail(null);
      setShowManualConvert(false);
    } catch (error) {
      console.error('Manual conversion failed:', error);
      toast.error('Failed to convert record');
    }
  };

  return (
    <>
      <div className="min-h-screen bg-[#F9FAFB] flex text-[#101828] font-sans">
      {/* Sidebar */}
        <aside className="w-[280px] border-r border-[#EAECF0] flex flex-col bg-white">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 bg-[#7F56D9] rounded-xl flex items-center justify-center shadow-lg shadow-purple-100">
                <Mail className="text-white w-6 h-6" />
              </div>
              <div>
                <h1 className="font-bold text-xl tracking-tight">isBIM BOS</h1>
                <p className="text-xs text-[#475467] font-medium">Email</p>
              </div>
            </div>

            <div className="relative mb-6">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" />
              <input 
                type="text" 
                placeholder="Search" 
                className="w-full pl-10 pr-4 py-2 bg-white border border-[#D0D5DD] rounded-lg text-sm focus:ring-2 focus:ring-[#F4EBFF] focus:border-[#7F56D9] outline-none transition-all placeholder:text-[#667085]"
              />
            </div>

            <nav className="space-y-1">
              <NavItem 
                icon={<Home className="w-5 h-5" />} 
                label="Home" 
                active={activeTab === 'DASHBOARD'} 
                onClick={() => setActiveTab('DASHBOARD')} 
              />
              <NavItem 
                icon={<Sparkles className="w-5 h-5" />} 
                label="AI Assistant" 
                active={activeTab === 'AI'}
                onClick={() => setActiveTab('AI')} 
                badge={aiAlerts.filter(a => a.priority >= 4).length}
              />
              <NavItem 
                icon={<Mail className="w-5 h-5" />} 
                label="Email" 
                active={activeTab === 'INTAKE'} 
                onClick={() => setActiveTab('INTAKE')}
                badge={emails.filter(e => !e.isRead).length}
                hasSubmenu
              />
              <AnimatePresence>
                {activeTab === 'INTAKE' && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden ml-9 space-y-1 mt-1"
                  >
                    <SubNavItem 
                      label="Inbox" 
                      active={activeIntakeSubTab === 'INBOX'} 
                      onClick={() => setActiveIntakeSubTab('INBOX')} 
                      icon={<Inbox className="w-4 h-4" />}
                    />
                    <SubNavItem 
                      label="Sent" 
                      active={activeIntakeSubTab === 'SENT'} 
                      onClick={() => setActiveIntakeSubTab('SENT')} 
                      icon={<SendIcon className="w-4 h-4" />}
                    />
                    <SubNavItem 
                      label="Drafts" 
                      active={activeIntakeSubTab === 'DRAFTS'} 
                      onClick={() => setActiveIntakeSubTab('DRAFTS')} 
                      icon={<FileText className="w-4 h-4" />}
                    />
                    <SubNavItem 
                      label="History" 
                      active={activeIntakeSubTab === 'HISTORY'} 
                      onClick={() => setActiveIntakeSubTab('HISTORY')} 
                      icon={<Archive className="w-4 h-4" />}
                    />
                    <SubNavItem 
                      label="Trash" 
                      active={activeIntakeSubTab === 'TRASH'} 
                      onClick={() => setActiveIntakeSubTab('TRASH')} 
                      icon={<Trash2 className="w-4 h-4" />}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
              <NavItem 
                icon={<FileText className="w-5 h-5" />} 
                label="Business" 
                active={activeTab === 'BUSINESS'} 
                onClick={() => setActiveTab('BUSINESS')} 
                hasSubmenu
              />
              <AnimatePresence>
                {activeTab === 'BUSINESS' && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden ml-9 space-y-1 mt-1"
                  >
                    <SubNavItem 
                      label="Opportunities" 
                      active={activeTemplateSubTab === 'OPPORTUNITY'} 
                      onClick={() => setActiveTemplateSubTab('OPPORTUNITY')} 
                    />
                    <SubNavItem 
                      label="Request" 
                      active={activeTemplateSubTab === 'REQUEST'} 
                      onClick={() => setActiveTemplateSubTab('REQUEST')} 
                    />
                    <SubNavItem 
                      label="Issued" 
                      active={activeTemplateSubTab === 'SUBMITTED'} 
                      onClick={() => setActiveTemplateSubTab('SUBMITTED')} 
                    />
                    <SubNavItem 
                      label="Awarded" 
                      active={activeTemplateSubTab === 'AWARDED'} 
                      onClick={() => setActiveTemplateSubTab('AWARDED')} 
                    />
                  </motion.div>
                )}
              </AnimatePresence>
              <NavItem 
                icon={<Layers className="w-5 h-5" />} 
                label="Tender" 
                active={activeTab === 'TENDERS'} 
                onClick={() => setActiveTab('TENDERS')} 
              />
              <NavItem 
                icon={<Calendar className="w-5 h-5" />} 
                label="Meeting" 
                active={activeTab === 'MEETINGS'} 
                onClick={() => setActiveTab('MEETINGS')} 
                hasSubmenu
              />
              <AnimatePresence>
                {activeTab === 'MEETINGS' && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden ml-9 space-y-1 mt-1"
                  >
                    <SubNavItem 
                      label="Intelligence" 
                      active={activeTab === 'MEETINGS' && activeMeetingSubTab === 'INTELLIGENCE'} 
                      onClick={() => { setActiveTab('MEETINGS'); setActiveMeetingSubTab('INTELLIGENCE'); }} 
                    />
                    <SubNavItem 
                      label="Calendar" 
                      active={activeTab === 'MEETINGS' && activeMeetingSubTab === 'CALENDAR'} 
                      onClick={() => { setActiveTab('MEETINGS'); setActiveMeetingSubTab('CALENDAR'); }} 
                    />
                    <SubNavItem 
                      label="Archives" 
                      active={activeTab === 'MEETINGS' && activeMeetingSubTab === 'LIST'} 
                      onClick={() => { setActiveTab('MEETINGS'); setActiveMeetingSubTab('LIST'); }} 
                    />
                  </motion.div>
                )}
              </AnimatePresence>
              <NavItem 
                icon={<CheckSquare className="w-5 h-5" />} 
                label="Task" 
                active={activeTab === 'TASKS'} 
                onClick={() => setActiveTab('TASKS')} 
              />
              <NavItem 
                icon={<Users className="w-5 h-5" />} 
                label="VIP" 
                active={activeTab === 'ACCOUNTS'} 
                onClick={() => setActiveTab('ACCOUNTS')} 
              />
              <NavItem 
                icon={<SendIcon className="w-5 h-5" />} 
                label="Proposal" 
                active={activeTab === 'PROPOSALS'} 
                onClick={() => setActiveTab('PROPOSALS')} 
              />
              <NavItem 
                icon={<Sparkles className="w-5 h-5" />} 
                label="AI Skill" 
                active={activeTab === 'SKILLS'} 
                onClick={() => setActiveTab('SKILLS')} 
              />
              {isAdmin && (
                <NavItem 
                  icon={<Server className="w-5 h-5" />} 
                  label="Connection" 
                  active={activeTab === 'CONNECTIONS'} 
                  onClick={() => setActiveTab('CONNECTIONS')} 
                />
              )}
            </nav>
          </div>

          <div className="mt-auto p-6 border-t border-[#EAECF0] space-y-1">
            {isAdmin && (
              <NavItem 
                icon={<Settings className="w-5 h-5" />} 
                label="Settings" 
                onClick={() => setShowSettings(true)} 
              />
            )}
            <NavItem 
              icon={<HelpCircle className="w-5 h-5" />} 
              label="Support" 
              active={activeTab === 'SUPPORT'}
              onClick={() => setActiveTab('SUPPORT')} 
              status="Online"
            />
            {isAdmin && (
              <NavItem 
                icon={<Users className="w-5 h-5" />} 
                label="Team Management" 
                active={activeTab === 'TEAM'} 
                onClick={() => setActiveTab('TEAM')} 
              />
            )}
            
            <div className="pt-4 mt-4 border-t border-[#EAECF0]">
              <div className="flex items-center gap-3 px-3 py-2">
                <div className="w-10 h-10 rounded-full bg-[#F2F4F7] flex items-center justify-center overflow-hidden border border-[#EAECF0]">
                  {auth.currentUser?.photoURL ? (
                    <img src={auth.currentUser.photoURL} alt="User" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="text-sm font-bold text-[#475467]">{auth.currentUser?.email?.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#101828] truncate">{auth.currentUser?.displayName || 'Sales Agent'}</p>
                  <p className="text-xs text-[#475467] truncate">{auth.currentUser?.email}</p>
                </div>
                <button 
                  onClick={() => auth.signOut()}
                  className="p-2 text-[#667085] hover:text-[#101828] transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col h-screen overflow-hidden">
          {/* Header */}
          <header className="h-18 border-b border-[#EAECF0] bg-white flex items-center justify-between px-8 shrink-0">
            <div>
              <h2 className="text-2xl font-bold text-[#101828]">
                {activeTab === 'INTAKE' ? (
                  activeIntakeSubTab === 'INBOX' ? 'Email Inbox' : 
                  activeIntakeSubTab === 'SENT' ? 'Sent Messages' :
                  activeIntakeSubTab === 'DRAFTS' ? 'Drafts' :
                  activeIntakeSubTab === 'HISTORY' ? 'Reply History' :
                  'Trash'
                ) : 
                 activeTab === 'BUSINESS' ? 'Business Records' : 
                 activeTab === 'DASHBOARD' ? 'Dashboard' : 
                 activeTab === 'TENDERS' ? 'Tender' : 
                 activeTab === 'MEETINGS' ? 'Meeting' :
                 activeTab === 'TASKS' ? 'Task' :
                 activeTab === 'SUPPORT' ? 'Support & Help Center' : 
                 activeTab === 'ACCOUNTS' ? 'Email Accounts' :
                 activeTab === 'TEAM' ? 'Team Management' :
                 activeTab === 'PROPOSALS' ? 'Proposal' :
                  activeTab === 'CONNECTIONS' ? 'Connection' :
                  activeTab === 'SKILLS' ? 'AI Skill' :
                 activeTab === 'AI' ? 'BOS Chatbot' :
                 'Dashboard'}
              </h2>
              <p className="text-sm text-[#475467]">
                {activeTab === 'DASHBOARD' ? 'Overview of your business development pipeline.' : 
                 activeTab === 'TENDERS' ? 'Analyze tender documents and generate bid drafts.' :
                 activeTab === 'MEETINGS' ? 'Convert meeting discussions into tracked actions and follow-ups.' :
                 activeTab === 'TASKS' ? 'Turn ad-hoc requests into tracked work with intelligent prioritization.' :
                 activeTab === 'SUPPORT' ? 'Get help, view tutorials, and contact our support team.' :
                 activeTab === 'ACCOUNTS' ? 'Manage and monitor your connected accounts.' :
                  activeTab === 'CONNECTIONS' ? 'Manage and monitor your configured data connections.' :
                 activeTab === 'TEAM' ? 'Manage your team members and invitation-based growth.' :
                  activeTab === 'SKILLS' ? 'Manage AI behavioral prompts and form extraction mappings.' :
                 activeTab === 'INTAKE' ? (
                   activeIntakeSubTab === 'INBOX' ? 'Manage and classify incoming business correspondence.' :
                   activeIntakeSubTab === 'SENT' ? 'View and track your outgoing communications.' :
                   activeIntakeSubTab === 'HISTORY' ? 'Review all agreed AI reply drafts.' :
                   activeIntakeSubTab === 'DRAFTS' ? 'Manage your unsent email drafts.' :
                   'Review recently deleted correspondence.'
                 ) :
                 'Manage and classify incoming business correspondence.'}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button 
                onClick={() => setActiveIntakeSubTab('COMPOSE')}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-[#D0D5DD] text-[#344054] font-bold text-sm rounded-lg hover:bg-[#F9FAFB] shadow-sm transition-all"
              >
                <Plus className="w-4 h-4" />
                Compose
              </button>

              <button className="p-2 text-[#667085] hover:bg-[#F9FAFB] rounded-lg transition-colors relative">
                <Bell className="w-5 h-5" />
                <span className="absolute top-2 right-2 w-2 h-2 bg-[#F04438] rounded-full border-2 border-white"></span>
              </button>
              
              <div className="relative">
                <div className="flex bg-white border border-[#D0D5DD] rounded-lg shadow-sm overflow-hidden">
                  <button 
                    onClick={() => handleSync()}
                    disabled={isSyncing}
                    className="flex items-center gap-2 bg-[#7F56D9] text-white px-4 py-2.5 font-semibold text-sm hover:bg-[#6941C6] disabled:opacity-50 transition-all"
                  >
                    <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                    {isSyncing ? 'Syncing...' : 'Sync Inbox'}
                  </button>
                  <button 
                    onClick={() => setShowSyncConfig(!showSyncConfig)}
                    className="px-2 border-l border-white/20 bg-[#7F56D9] text-white hover:bg-[#6941C6] transition-all"
                    title="Sync Settings"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>

                <AnimatePresence>
                  {showSyncConfig && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute top-full right-0 mt-2 w-72 bg-white border border-[#EAECF0] rounded-xl shadow-xl z-50 p-4"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-sm font-bold text-[#101828]">Sync Settings</h4>
                        <button onClick={() => setShowSyncConfig(false)} className="text-[#667085] hover:text-[#101828]">
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="text-[10px] font-bold text-[#667085] uppercase tracking-wider mb-2 block">
                            Sync Period
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            {[1, 3, 7, 30].map(d => (
                              <button
                                key={d}
                                onClick={() => setSyncDays(d)}
                                className={`px-2 py-1.5 rounded-md text-xs font-medium border transition-all ${syncDays === d ? 'bg-[#F9F5FF] border-[#7F56D9] text-[#7F56D9]' : 'bg-white border-[#D0D5DD] text-[#475467] hover:bg-[#F9FAFB]'}`}
                              >
                                {d === 1 ? '1 Day' : `${d} Days`}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label className="text-[10px] font-bold text-[#667085] uppercase tracking-wider mb-2 block">
                            Select Accounts
                          </label>
                          <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                            {!isEmailConnectionsLoaded ? (
                              <p className="text-[10px] text-[#98A2B3] italic">Loading configured accounts...</p>
                            ) : emailConnections.length === 0 ? (
                              <p className="text-[10px] text-[#98A2B3] italic">No accounts configured</p>
                            ) : (
                              emailConnections.map(conn => (
                                <label key={conn.user} className="flex items-center gap-2 p-2 rounded-lg hover:bg-[#F9FAFB] cursor-pointer border border-transparent hover:border-[#F2F4F7]">
                                  <input 
                                    type="checkbox"
                                    checked={syncConnectionIds.includes(conn.user) || syncConnectionIds.length === 0}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSyncConnectionIds([...syncConnectionIds, conn.user]);
                                      } else {
                                        const next = syncConnectionIds.filter(id => id !== conn.user);
                                        // If unchecking the last manually selected, it stays empty (all)
                                        setSyncConnectionIds(next);
                                      }
                                    }}
                                    className="w-3.5 h-3.5 rounded text-[#7F56D9] focus:ring-[#F4EBFF]"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-[#344054] truncate">{conn.name || conn.user}</p>
                                    <p className="text-[10px] text-[#667085] truncate">{conn.user}</p>
                                  </div>
                                </label>
                              ))
                            )}
                          </div>
                        </div>

                        <button 
                          onClick={() => {
                            handleSync();
                            setShowSyncConfig(false);
                          }}
                          className="w-full py-2 bg-[#7F56D9] text-white rounded-lg text-sm font-semibold hover:bg-[#6941C6] transition-all shadow-sm"
                        >
                          Sync Now
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </header>

          {/* View Area */}
          <div className="flex-1 flex overflow-hidden">
            {activeTab === 'DASHBOARD' ? (
              <div className="flex-1 p-8 overflow-y-auto bg-[#F9FAFB]">
                <div className="max-w-7xl mx-auto space-y-8">
                  {/* Dashboard Header */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-2xl font-bold text-[#101828]">
                        {isAdmin ? 'Team Performance Intelligence' : 'My Sales Workspace'}
                      </h3>
                      <p className="text-sm text-[#475467]">
                        {isAdmin ? 'Strategic overview of company pipeline and team activity.' : 'Your personal pipeline and achievement tracking.'}
                      </p>
                    </div>
                    {isAdmin && (
                      <div className="flex items-center gap-2 px-4 py-2 bg-[#F9F5FF] border border-[#E9D7FE] rounded-xl">
                        <Users className="w-4 h-4 text-[#7F56D9]" />
                        <span className="text-sm font-bold text-[#7F56D9]">8 Active Agents</span>
                      </div>
                    )}
                  </div>

                  {/* Stats Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <StatCard 
                      title={isAdmin ? "Total Company Intake" : "My Intake"} 
                      value={emails.filter(canAccessEmail).length} 
                      icon={<Mail className="w-6 h-6 text-[#7F56D9]" />}
                      trend={emails.filter(canAccessEmail).filter(e => !e.isRead).length + " unread"}
                    />
                    <StatCard 
                      title={isAdmin ? "Strategic Accounts" : "My Accounts"} 
                      value={accounts.filter(a => isAdmin || a.owner_id === auth.currentUser?.uid).length} 
                      icon={<Briefcase className="w-6 h-6 text-[#175CD3]" />}
                    />
                    <StatCard 
                      title="Active Proposals" 
                      value={proposals.filter(p => isAdmin || p.uid === auth.currentUser?.uid).filter(p => p.status !== 'accepted' && p.status !== 'rejected').length} 
                      icon={<Clock className="w-6 h-6 text-[#B54708]" />}
                    />
                    <StatCard 
                      title={isAdmin ? "Company Revenue YTD" : "My Wins YTD"} 
                      value={"HKD " + proposals.filter(p => isAdmin || p.uid === auth.currentUser?.uid).filter(p => p.status === 'accepted').reduce((acc, curr) => acc + (curr.pricing?.total || 0), 0).toLocaleString()} 
                      icon={<CheckCircle className="w-6 h-6 text-[#027A48]" />}
                      trend={proposals.filter(p => isAdmin || p.uid === auth.currentUser?.uid).filter(p => p.status === 'accepted').length + " deals"}
                    />
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Pipeline Perspective */}
                    <div className="bg-white p-8 rounded-3xl border border-[#EAECF0] shadow-sm">
                      <div className="flex items-center justify-between mb-8">
                        <h3 className="text-lg font-bold text-[#101828]">Pipeline Distribution</h3>
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 bg-[#7F56D9] rounded-full" />
                          <span className="text-xs font-bold text-[#667085]">Live Opportunities</span>
                        </div>
                      </div>
                      <div className="space-y-6">
                        {['draft', 'review', 'sent', 'accepted'].map((status) => {
                          const userProposals = proposals.filter(p => isAdmin || p.uid === auth.currentUser?.uid);
                          const count = userProposals.filter(p => p.status === status).length;
                          const total = userProposals.length || 1;
                          const percentage = (count / total) * 100;
                          return (
                            <div key={status} className="space-y-3">
                              <div className="flex justify-between text-sm">
                                <span className="font-black text-[#475467] uppercase tracking-widest text-[10px]">{status}</span>
                                <span className="font-bold text-[#101828]">{count} documents</span>
                              </div>
                              <div className="h-3 bg-[#F9FAFB] rounded-full overflow-hidden border border-[#EAECF0]">
                                <motion.div 
                                  initial={{ width: 0 }}
                                  animate={{ width: `${percentage}%` }}
                                  className={`h-full rounded-full ${
                                    status === 'draft' ? 'bg-[#98A2B3]' :
                                    status === 'review' ? 'bg-[#7F56D9]' :
                                    status === 'sent' ? 'bg-[#2E90FA]' :
                                    'bg-[#12B76A]'
                                  }`}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Team Approval Queue or My Activity */}
                    <div className="bg-white p-8 rounded-3xl border border-[#EAECF0] shadow-sm">
                      <div className="flex items-center justify-between mb-8">
                        <h3 className="text-lg font-bold text-[#101828]">
                          {isAdmin ? 'Approval Action Required' : 'My Recent Milestone Activity'}
                        </h3>
                        {isAdmin && (
                          <span className="px-2.5 py-1 bg-[#F0F9FF] text-[#026AA2] text-xs font-bold rounded-full border border-[#B9E6FE]">
                            {proposals.filter(p => p.status === 'review').length} Pending
                          </span>
                        )}
                      </div>
                      <div className="space-y-4">
                        {(isAdmin ? proposals.filter(p => p.status === 'review') : proposals.filter(p => p.uid === auth.currentUser?.uid).slice(0, 5)).length === 0 ? (
                          <div className="py-12 text-center text-[#98A2B3] italic text-sm">
                             No items requiring attention.
                          </div>
                        ) : (
                          (isAdmin ? proposals.filter(p => p.status === 'review') : proposals.filter(p => p.uid === auth.currentUser?.uid).slice(0, 5)).map((p) => (
                            <div key={p.id} className="flex items-center gap-4 p-4 hover:bg-[#F9FAFB] rounded-2xl transition-all border border-transparent hover:border-[#EAECF0] group cursor-pointer" onClick={() => { setSelectedProposal(p); setActiveTab('PROPOSALS'); }}>
                              <div className="w-12 h-12 bg-[#F9F5FF] rounded-xl flex items-center justify-center text-[#7F56D9] group-hover:bg-[#7F56D9] group-hover:text-white transition-all">
                                <FileText className="w-6 h-6" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-[#101828] truncate">{p.title}</p>
                                <p className="text-xs text-[#667085]">{p.client_name} • HKD {p.pricing.total.toLocaleString()}</p>
                              </div>
                              <ChevronRight className="w-4 h-4 text-[#98A2B3] group-hover:text-[#7F56D9]" />
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : activeTab === 'INTAKE' ? (
              activeIntakeSubTab === 'COMPOSE' ? (
                <div className="flex-1 p-8 overflow-y-auto bg-[#F9FAFB]">
                  <div className="max-w-4xl mx-auto">
                    <motion.div 
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-white rounded-2xl border border-[#EAECF0] shadow-sm flex flex-col overflow-hidden"
                    >
                      <div className="px-8 py-6 border-b border-[#EAECF0] bg-white flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-[#F9F5FF] rounded-xl flex items-center justify-center">
                            <SendIcon className="text-[#7F56D9] w-6 h-6" />
                          </div>
                          <div>
                            <h3 className="text-xl font-bold text-[#101828]">New Message</h3>
                            <p className="text-sm text-[#475467]">Compose and send a business email.</p>
                          </div>
                        </div>
                        <button onClick={() => setActiveIntakeSubTab('INBOX')} className="p-2.5 text-[#667085] hover:bg-[#F9FAFB] rounded-lg transition-all">
                          <X className="w-6 h-6" />
                        </button>
                      </div>

                      <div className="p-8 space-y-6">
                        <div className="grid grid-cols-[100px_1fr] items-center gap-4">
                          <label className="text-sm font-bold text-[#344054]">Recipient</label>
                          <div className="relative">
                            <Users className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#98A2B3]" />
                            <input 
                              type="email" 
                              value={composeData.to || ''}
                              onChange={(e) => setComposeData({ ...composeData, to: e.target.value })}
                              className="w-full pl-10 pr-4 py-3 bg-white border border-[#D0D5DD] rounded-xl text-sm focus:ring-4 focus:ring-[#F4EBFF] focus:border-[#7F56D9] outline-none transition-all"
                              placeholder="recipient@example.com"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-[100px_1fr] items-center gap-4">
                          <label className="text-sm font-bold text-[#344054]">Subject</label>
                          <input 
                            type="text" 
                            value={composeData.subject || ''}
                            onChange={(e) => setComposeData({ ...composeData, subject: e.target.value })}
                            className="w-full px-4 py-3 bg-white border border-[#D0D5DD] rounded-xl text-sm focus:ring-4 focus:ring-[#F4EBFF] focus:border-[#7F56D9] outline-none transition-all"
                            placeholder="Enquiry Regarding Project..."
                          />
                        </div>
                        <div className="flex flex-col gap-3">
                          <label className="text-sm font-bold text-[#344054]">Message Body</label>
                          <textarea 
                            value={composeData.body || ''}
                            onChange={(e) => setComposeData({ ...composeData, body: e.target.value })}
                            className="w-full h-[400px] p-6 bg-white border border-[#D0D5DD] rounded-2xl text-sm focus:ring-4 focus:ring-[#F4EBFF] focus:border-[#7F56D9] outline-none transition-all resize-none shadow-sm font-sans"
                            placeholder="Start typing your professional email here..."
                          />
                        </div>
                      </div>

                      <div className="px-8 py-6 bg-[#F9FAFB] border-t border-[#EAECF0] flex justify-end items-center gap-4">
                        <button 
                          onClick={() => setActiveIntakeSubTab('INBOX')}
                          className="px-6 py-2.5 text-[#344054] font-bold text-sm hover:bg-[#F2F4F7] rounded-lg transition-all"
                        >
                          Discard Draft
                        </button>
                        <button 
                          onClick={handleSendEmail}
                          disabled={isSending}
                          className="px-8 py-2.5 bg-[#7F56D9] text-white rounded-lg text-sm font-bold hover:bg-[#6941C6] transition-all shadow-md flex items-center gap-2 disabled:opacity-50"
                        >
                          {isSending ? (
                            <>
                              <RefreshCw className="w-4 h-4 animate-spin" />
                              Transmitting...
                            </>
                          ) : (
                            <>
                              <SendIcon className="w-4 h-4" />
                              Send Message
                            </>
                          )}
                        </button>
                      </div>
                    </motion.div>
                  </div>
                </div>
              ) : activeIntakeSubTab === 'HISTORY' ? (
                <div className="flex-1 p-8 overflow-y-auto bg-[#F9FAFB]">
                  <div className="max-w-6xl mx-auto space-y-6">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <h3 className="text-xl font-bold text-[#101828]">Reply History</h3>
                        <p className="text-sm text-[#475467]">Review and manage your agreed AI reply drafts.</p>
                      </div>
                    </div>

                    {replyHistory.length === 0 ? (
                      <div className="bg-white border border-dashed border-[#EAECF0] rounded-2xl p-16 text-center flex flex-col items-center gap-4">
                        <div className="w-16 h-16 bg-[#F9F5FF] rounded-full flex items-center justify-center text-[#7F56D9]">
                          <MessageSquare className="w-8 h-8" />
                        </div>
                        <div>
                          <h4 className="text-lg font-bold text-[#101828]">No history found</h4>
                          <p className="text-sm text-[#667085] max-w-xs mx-auto">Drafts you save after agreeing with the AI will appear here for record-keeping.</p>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4">
                        {replyHistory.map((item) => (
                          <div key={item.id} className="bg-white border border-[#EAECF0] rounded-2xl p-6 shadow-sm hover:border-[#7F56D9] transition-all group overflow-hidden">
                            <div className="flex items-start justify-between mb-6">
                              <div className="flex gap-4">
                                <div className="w-12 h-12 bg-[#F9F5FF] rounded-xl flex items-center justify-center text-[#7F56D9] shrink-0">
                                  <Mail className="w-6 h-6" />
                                </div>
                                <div className="min-w-0">
                                  <h4 className="font-bold text-[#101828] truncate">{item.emailSubject}</h4>
                                  <p className="text-xs text-[#667085] mb-2">To: {item.emailFrom}</p>
                                  <div className="flex items-center gap-3">
                                    <span className="text-[10px] text-[#98A2B3] flex items-center gap-1">
                                      <Clock className="w-3 h-3" />
                                      {new Date(item.createdAt).toLocaleString()}
                                    </span>
                                    <span className="text-[10px] px-2 py-0.5 bg-[#F2F4F7] text-[#475467] rounded-full font-medium">
                                      {item.createdBy}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <button 
                                onClick={() => handleDeleteReplyHistory(item.id)}
                                className="p-2 text-[#98A2B3] hover:text-[#F04438] hover:bg-[#FEF3F2] rounded-lg transition-all"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>

                            <div className="space-y-4">
                              <div className="bg-[#F9FAFB] p-4 rounded-xl border border-[#F2F4F7]">
                                <p className="text-[10px] font-bold text-[#667085] uppercase tracking-wider mb-2">Original Instruction</p>
                                <p className="text-xs text-[#475467] italic">"{item.prompt}"</p>
                              </div>
                              <div className="p-5 bg-white border border-[#EAECF0] rounded-xl relative group/inner">
                                <p className="text-[10px] font-bold text-[#667085] uppercase tracking-wider mb-3">Saved Draft</p>
                                <div className="text-xs text-[#344054] leading-relaxed whitespace-pre-wrap font-sans">
                                  {item.replyContent}
                                </div>
                                <button 
                                  onClick={() => {
                                    navigator.clipboard.writeText(item.replyContent);
                                    toast.success('Reply draft copied to clipboard');
                                  }}
                                  className="absolute top-4 right-4 p-1.5 bg-white border border-[#D0D5DD] text-[#667085] hover:text-[#7F56D9] rounded-md opacity-0 group-hover/inner:opacity-100 transition-all shadow-sm"
                                  title="Copy to Clipboard"
                                >
                                  <CheckSquare className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : activeIntakeSubTab === 'SENT' ? (
                <>
                  {/* Sent List */}
                  <div className="w-[400px] border-r border-[#EAECF0] overflow-y-auto bg-white">
                    <div className="p-4 border-b border-[#EAECF0] bg-[#F9FAFB]/50">
                      <h3 className="text-sm font-bold text-[#101828]">Sent Messages</h3>
                    </div>
                    {sentEmails.length === 0 ? (
                      <div className="p-12 text-center flex flex-col items-center gap-4">
                        <div className="w-12 h-12 bg-[#F9FAFB] rounded-full flex items-center justify-center">
                          <SendIcon className="w-6 h-6 text-[#98A2B3]" />
                        </div>
                        <p className="text-sm font-medium text-[#475467]">No sent emails yet</p>
                      </div>
                    ) : (
                      sentEmails.map((email) => (
                        <div 
                          key={email.id}
                          onClick={() => setSelectedEmail(email as any)}
                          className={`p-5 border-b border-[#EAECF0] cursor-pointer transition-all hover:bg-[#F9FAFB] ${selectedEmail?.id === email.id ? 'bg-[#F9F5FF] border-l-4 border-l-[#7F56D9]' : ''}`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium text-[#667085]">To: {email.to}</span>
                            <span className="text-xs text-[#98A2B3]">{new Date(email.sentAt).toLocaleDateString()}</span>
                          </div>
                          <p className="text-sm font-bold text-[#101828] truncate mb-1">{email.subject}</p>
                          <p className="text-xs text-[#667085] line-clamp-2">{email.body}</p>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto bg-[#F9FAFB] p-8">
                    <AnimatePresence mode="wait">
                      {selectedEmail ? (
                        <motion.div 
                          key={selectedEmail.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="max-w-4xl mx-auto space-y-6"
                        >
                          <div className="bg-white border border-[#EAECF0] rounded-2xl shadow-sm p-8">
                            <div className="flex items-center justify-between mb-8">
                              <h2 className="text-2xl font-bold text-[#101828]">{selectedEmail.subject}</h2>
                              <span className="text-xs text-[#667085]">{new Date((selectedEmail as any).sentAt || selectedEmail.receivedAt).toLocaleString()}</span>
                            </div>
                            <div className="flex items-center gap-3 mb-8 pb-4 border-b border-[#F2F4F7]">
                              <div className="w-10 h-10 rounded-full bg-[#F9F5FF] flex items-center justify-center text-[#7F56D9] font-bold">
                                {selectedEmail.from?.charAt(0).toUpperCase() || 'M'}
                              </div>
                              <div>
                                <p className="text-sm font-bold text-[#101828]">From: {selectedEmail.from}</p>
                                <p className="text-sm text-[#475467]">To: {(selectedEmail as any).to}</p>
                              </div>
                            </div>
                            <div className="text-sm text-[#344054] leading-relaxed whitespace-pre-wrap">
                              {selectedEmail.body}
                            </div>
                          </div>
                        </motion.div>
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-[#98A2B3] gap-4">
                          <SendIcon className="w-12 h-12 stroke-[1.5]" />
                          <p className="text-sm font-medium">Select a sent message to review</p>
                        </div>
                      )}
                    </AnimatePresence>
                  </div>
                </>
              ) : activeIntakeSubTab === 'TRASH' ? (
                <>
                  {/* Trash List */}
                  <div className="w-[400px] border-r border-[#EAECF0] overflow-y-auto bg-white">
                    <div className="p-4 border-b border-[#EAECF0] bg-[#F9FAFB]/50">
                      <h3 className="text-sm font-bold text-[#101828]">Trash</h3>
                    </div>
                    {emails.filter(e => e.isDeleted).length === 0 ? (
                      <div className="p-12 text-center flex flex-col items-center gap-4">
                        <div className="w-12 h-12 bg-[#F9FAFB] rounded-full flex items-center justify-center">
                          <Trash2 className="w-6 h-6 text-[#98A2B3]" />
                        </div>
                        <p className="text-sm font-medium text-[#475467]">Trash is empty</p>
                      </div>
                    ) : (
                      emails.filter(e => e.isDeleted).map((email) => (
                        <div 
                          key={email.id}
                          onClick={() => setSelectedEmail(email)}
                          className={`p-5 border-b border-[#EAECF0] cursor-pointer transition-all hover:bg-[#F9FAFB] ${selectedEmail?.id === email.id ? 'bg-[#F9F5FF] border-l-4 border-l-[#7F56D9]' : ''}`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium text-[#667085]">{email.from}</span>
                            <span className="text-xs text-[#98A2B3]">{new Date(email.receivedAt).toLocaleDateString()}</span>
                          </div>
                          <p className="text-sm font-bold text-[#101828] truncate mb-1">{email.subject}</p>
                          <p className="text-xs text-[#667085] line-clamp-2">{email.body}</p>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto bg-[#F9FAFB] p-8">
                    <AnimatePresence mode="wait">
                      {selectedEmail && selectedEmail.isDeleted ? (
                        <motion.div 
                          key={selectedEmail.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="max-w-4xl mx-auto space-y-6"
                        >
                          <div className="bg-white border border-[#EAECF0] rounded-2xl shadow-sm p-4 flex justify-end gap-3">
                             <button 
                               onClick={async () => {
                                 await updateDoc(doc(db, 'emails', selectedEmail.id), { isDeleted: false });
                                 toast.success('Email restored to Inbox');
                               }}
                               className="px-4 py-2 border border-[#D0D5DD] rounded-lg text-sm font-semibold hover:bg-[#F9FAFB]"
                             >
                               Restore to Inbox
                             </button>
                             <button 
                               onClick={() => handleDeleteEmail(selectedEmail.id)}
                               className="px-4 py-2 bg-[#FEF3F2] text-[#B42318] border border-[#FDA29B] rounded-lg text-sm font-semibold hover:bg-[#FEE4E2]"
                             >
                               Delete Permanently
                             </button>
                          </div>
                          <div className="bg-white border border-[#EAECF0] rounded-2xl shadow-sm p-8">
                            <div className="flex items-center justify-between mb-8">
                              <h2 className="text-2xl font-bold text-[#101828]">{selectedEmail.subject}</h2>
                              <span className="text-xs text-[#667085]">{new Date(selectedEmail.receivedAt).toLocaleString()}</span>
                            </div>
                            <div className="text-sm text-[#344054] leading-relaxed whitespace-pre-wrap">
                              {selectedEmail.body}
                            </div>
                          </div>
                        </motion.div>
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-[#98A2B3] gap-4">
                          <Trash2 className="w-12 h-12 stroke-[1.5]" />
                          <p className="text-sm font-medium">Select a deleted message to review or restore</p>
                        </div>
                      )}
                    </AnimatePresence>
                  </div>
                </>
              ) : activeIntakeSubTab === 'DRAFTS' ? (
                <>
                  <div className="w-[400px] border-r border-[#EAECF0] overflow-y-auto bg-white">
                    <div className="p-4 border-b border-[#EAECF0] bg-[#F9FAFB]/50">
                      <h3 className="text-sm font-bold text-[#101828]">Drafts</h3>
                    </div>
                    {drafts.length === 0 ? (
                      <div className="p-12 text-center flex flex-col items-center gap-4">
                        <div className="w-12 h-12 bg-[#F9FAFB] rounded-full flex items-center justify-center">
                          <FileText className="w-6 h-6 text-[#98A2B3]" />
                        </div>
                        <p className="text-sm font-medium text-[#475467]">No drafts saved</p>
                      </div>
                    ) : (
                      drafts.map((draft) => (
                        <div 
                          key={draft.id}
                          onClick={() => {
                            setComposeData({ to: draft.to || '', subject: draft.subject || '', body: draft.body || '' });
                            setActiveIntakeSubTab('COMPOSE');
                          }}
                          className="p-5 border-b border-[#EAECF0] cursor-pointer transition-all hover:bg-[#F9FAFB]"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium text-[#667085]">Draft</span>
                            <span className="text-xs text-[#98A2B3]">{new Date(draft.updatedAt).toLocaleDateString()}</span>
                          </div>
                          <p className="text-sm font-bold text-[#101828] truncate mb-1">{draft.subject || '(No Subject)'}</p>
                          <p className="text-xs text-[#667085] line-clamp-2">{draft.body || '(No content)'}</p>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto bg-[#F9FAFB] p-8 flex flex-col items-center justify-center text-[#98A2B3] gap-4">
                    <FileText className="w-12 h-12 stroke-[1.5]" />
                    <p className="text-sm font-medium text-center max-w-xs">Drafts are messages you've started but haven't sent yet. Click a draft to resume composing.</p>
                  </div>
                </>
              ) : (
                <>
                  {/* Inbox List */}
                  <div className="w-[400px] border-r border-[#EAECF0] overflow-y-auto bg-white">
                  <div className="p-4 border-b border-[#EAECF0] bg-[#F9FAFB]/50 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex gap-2">
                        <button 
                          onClick={() => setEmailFilter('ALL')}
                          className={`px-3 py-1.5 rounded-md text-xs font-semibold shadow-sm transition-all ${emailFilter === 'ALL' ? 'bg-white border border-[#D0D5DD]' : 'text-[#475467] hover:bg-white'}`}
                        >
                          All
                        </button>
                        <button 
                          onClick={() => setEmailFilter('UNREAD')}
                          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${emailFilter === 'UNREAD' ? 'bg-white border border-[#D0D5DD] shadow-sm' : 'text-[#475467] hover:bg-white'}`}
                        >
                          Unread
                        </button>
                      </div>
                      <button className="p-1.5 text-[#667085] hover:bg-white rounded-md border border-transparent hover:border-[#D0D5DD] transition-all">
                        <Filter className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {['ALL', 'MEETING', 'PROJECT', 'MARKETING', 'FINANCE', 'OPPORTUNITY', 'REQUEST', 'SUBMITTED', 'AWARDED', 'OTHER'].map(cat => (
                        <button
                          key={cat}
                          onClick={() => setEmailCategoryFilter(cat)}
                          className={`px-2 py-1 rounded text-[10px] font-bold border transition-all ${
                            emailCategoryFilter === cat 
                              ? 'bg-[#7F56D9] text-white border-[#7F56D9] shadow-sm' 
                              : 'bg-white text-[#475467] border-[#EAECF0] hover:bg-[#F9FAFB]'
                          }`}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>

                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#98A2B3]" />
                      <input 
                        type="text"
                        placeholder="Search emails..."
                        value={emailSearchTerm || ''}
                        onChange={(e) => setEmailSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-white border border-[#D0D5DD] rounded-xl text-xs focus:ring-4 focus:ring-[#F4EBFF] focus:border-[#7F56D9] outline-none transition-all"
                      />
                    </div>

                    {emailCategoryFilter === 'OTHER' && emails.filter(e => !e.isDeleted && e.aiClassification === 'OTHER' && canAccessEmail(e)).length > 0 && (
                      <button 
                        onClick={handleDeleteAllOther}
                        className="w-full py-2 bg-[#FEF3F2] text-[#B42318] border border-[#FDA29B] rounded-lg text-[11px] font-bold hover:bg-[#FEE4E2] transition-all flex items-center justify-center gap-2 shadow-sm"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Move All "Other" to Trash
                      </button>
                    )}
                  </div>

                  {emails.filter(e => !e.isDeleted).filter(canAccessEmail).length === 0 ? (
                    <div className="p-12 text-center flex flex-col items-center gap-4">
                      <div className="w-12 h-12 bg-[#F9FAFB] rounded-full flex items-center justify-center">
                        <Mail className="w-6 h-6 text-[#98A2B3]" />
                      </div>
                      <p className="text-sm font-medium text-[#475467]">Your inbox is empty</p>
                    </div>
                  ) : (
                    emails
                      .filter(e => !e.isDeleted)
                      .filter(canAccessEmail)
                      .filter(e => {
                        if (!emailSearchTerm) return true;
                        const term = emailSearchTerm.toLowerCase();
                        return (
                          e.subject?.toLowerCase().includes(term) ||
                          e.from?.toLowerCase().includes(term) ||
                          e.body?.toLowerCase().includes(term)
                        );
                      })
                      .filter(e => emailFilter === 'ALL' || !e.isRead)
                      .filter(e => emailCategoryFilter === 'ALL' || e.aiClassification === emailCategoryFilter)
                      .map((email) => (
                      <div 
                        key={email.id}
                        onClick={async () => {
                          setSelectedEmail(email);
                          setReplyPrompt('');
                          setAiReplyDraft(null);
                          if (!email.isRead) {
                            try {
                              await updateDoc(doc(db, 'emails', email.id), { isRead: true });
                            } catch (err) {
                              console.error('Failed to mark as read:', err);
                            }
                          }
                        }}
                        className={`p-5 border-b border-[#EAECF0] cursor-pointer transition-all hover:bg-[#F9FAFB] group relative ${selectedEmail?.id === email.id ? 'bg-[#F9F5FF] border-l-4 border-l-[#7F56D9]' : ''}`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div 
                              className={`w-2 h-2 rounded-full transition-all ${!email.isRead ? 'bg-[#7F56D9] scale-125' : 'bg-[#D0D5DD]'}`} 
                              title={email.isRead ? "Read" : "Unread"}
                            />
                            <span className="text-xs font-medium text-[#667085]">
                              {new Date(email.receivedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {email.aiClassification && (
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                email.aiClassification === 'MEETING' ? 'bg-[#EFF8FF] text-[#175CD3]' :
                                email.aiClassification === 'PROJECT' ? 'bg-[#FFFAEB] text-[#B54708]' :
                                email.aiClassification === 'MARKETING' ? 'bg-[#F9F5FF] text-[#7F56D9]' :
                                email.aiClassification === 'FINANCE' ? 'bg-[#ECFDF3] text-[#027A48]' :
                                email.aiClassification === 'OPPORTUNITY' ? 'bg-[#EEF4FF] text-[#3538CD]' :
                                email.aiClassification === 'REQUEST' ? 'bg-[#FFFAEB] text-[#B54708]' :
                                email.aiClassification === 'SUBMITTED' ? 'bg-[#FDF2FA] text-[#C11574]' :
                                email.aiClassification === 'AWARDED' ? 'bg-[#ECFDF3] text-[#027A48]' :
                                'bg-[#F9FAFB] text-[#344054]'
                              }`}>
                                {email.aiClassification.replace('_', ' ')}
                              </span>
                            )}
                            {isAdmin && (
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteEmail(email.id);
                                }}
                                className="opacity-0 group-hover:opacity-100 p-1 text-[#667085] hover:text-[#F04438] transition-all"
                                title="Delete Email"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                        <h3 className={`text-sm font-bold mb-1 line-clamp-1 ${selectedEmail?.id === email.id ? 'text-[#6941C6]' : 'text-[#101828]'}`}>
                          {email.subject}
                        </h3>
                        <p className="text-xs text-[#475467] mb-2 line-clamp-1">{email.from}</p>
                        <p className="text-xs text-[#667085] line-clamp-2 leading-relaxed opacity-70">
                          {email.summary || email.body.substring(0, 100)}
                        </p>
                      </div>
                    ))
                  )}
                </div>

                {/* Detail */}
                <div className="flex-1 overflow-y-auto bg-[#F9FAFB] p-10">
                  <AnimatePresence mode="wait">
                    {selectedEmail ? (
                      <motion.div 
                        key={selectedEmail.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="max-w-4xl mx-auto space-y-6"
                      >
                        {/* Top Actions Bar */}
                        <div className="bg-white border border-[#EAECF0] p-4 rounded-2xl shadow-sm flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <button 
                              onClick={() => handleDeleteEmail(selectedEmail.id)}
                              className="p-2.5 border border-[#FDA29B] text-[#B42318] rounded-xl hover:bg-[#FEF3F2] transition-all"
                              title="Delete Email"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => handleReAnalyze(selectedEmail)}
                              disabled={isAnalyzing}
                              className="p-2.5 bg-[#F9F5FF] text-[#7F56D9] rounded-xl hover:bg-[#F4EBFF] transition-all disabled:opacity-50"
                              title="AI Re-analyze"
                            >
                              <RefreshCw className={`w-4 h-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
                            </button>
                            <button 
                               onClick={() => handleCreateTaskFromEmail(selectedEmail)}
                               className="p-2.5 border border-[#D0D5DD] text-[#344054] rounded-xl hover:bg-[#F9FAFB] transition-all"
                               title="Create Task"
                             >
                               <CheckSquare className="w-4 h-4" />
                             </button>
                             <button 
                               onClick={() => handleCreateAccountFromEmail(selectedEmail)}
                               className="p-2.5 border border-[#EAECF0] text-[#344054] rounded-xl hover:bg-[#F9FAFB] transition-all shadow-sm"
                               title="Add to VIP"
                             >
                               <Users className="w-4 h-4" />
                             </button>
                              {selectedEmail.aiClassification === 'MEETING' && (
                                <button 
                                  onClick={() => handleConvertEmailToMeeting(selectedEmail)}
                                  className="p-2.5 bg-[#F9F5FF] text-[#7F56D9] border border-[#E9D7FE] rounded-xl hover:bg-[#F4EBFF] transition-all shadow-sm"
                                  title="Convert to Meeting"
                                >
                                  <Calendar className="w-4 h-4" />
                                </button>
                              )}
                              {selectedEmail.aiClassification === 'OPPORTUNITY' && (
                                <button 
                                  onClick={() => handleAnalyzeTenderFromEmail(selectedEmail)}
                                  className="p-2.5 bg-[#7F56D9] text-white rounded-xl hover:bg-[#6941C6] transition-all shadow-sm"
                                  title="Analyze Tender"
                                >
                                  <Layers className="w-4 h-4" />
                                </button>
                              )}
                              {(selectedEmail.aiClassification === 'OPPORTUNITY' || selectedEmail.aiClassification === 'REQUEST') && (
                                <button 
                                  onClick={() => handleCreateProposal(selectedEmail)}
                                  className="p-2.5 bg-[#F9F5FF] text-[#7F56D9] border border-[#E9D7FE] rounded-xl hover:bg-[#F4EBFF] transition-all shadow-sm"
                                  title="Generate Quotation"
                                >
                                  <Sparkles className="w-4 h-4" />
                                </button>
                              )}
                              {selectedEmail.aiClassification === 'AWARDED' && (
                                <button 
                                  onClick={() => handleConvertAwardToAccount(selectedEmail)}
                                  className="p-2.5 bg-[#ECFDF3] text-[#027A48] border border-[#ABEFC6] rounded-xl hover:bg-[#D1FADF] transition-all shadow-sm"
                                  title="Register VIP"
                                >
                                  <Users className="w-4 h-4" />
                                </button>
                              )}
                              <div className="relative">
                                <button 
                                  onClick={() => setShowManualConvert(!showManualConvert)}
                                  className="p-2.5 border border-[#D0D5DD] text-[#344054] rounded-xl hover:bg-[#F9FAFB] transition-all"
                                  title="Manual Actions"
                                >
                                  <Settings className="w-4 h-4" />
                                </button>
                                <AnimatePresence>
                                  {showManualConvert && (
                                    <motion.div 
                                      initial={{ opacity: 0, y: 5 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      exit={{ opacity: 0, y: 5 }}
                                      className="absolute top-full right-0 mt-2 w-48 bg-white border border-[#EAECF0] rounded-xl shadow-xl z-10 overflow-hidden"
                                  >
                                    {['OPPORTUNITY', 'REQUEST', 'SUBMITTED', 'AWARDED'].map((cat) => (
                                      <button 
                                        key={cat}
                                        onClick={() => handleManualConvert(selectedEmail, cat)}
                                        className="w-full text-left px-4 py-2.5 text-sm text-[#344054] hover:bg-[#F9FAFB] transition-colors"
                                      >
                                        Convert to {cat.replace('_', ' ')}
                                      </button>
                                    ))}
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <button 
                              onClick={() => handleConfirm(selectedEmail)}
                              className="px-6 py-2 bg-[#7F56D9] text-white rounded-lg text-sm font-semibold hover:bg-[#6941C6] transition-all shadow-sm shadow-purple-100 flex items-center gap-2"
                            >
                              <CheckCircle className="w-4 h-4" />
                              Convert
                            </button>
                          </div>
                        </div>

                        {/* AI Reply Draft Section (MOVED TO TOP) */}
                        <div className="bg-white border border-[#EAECF0] rounded-2xl shadow-sm overflow-hidden bg-[#F9F5FF]/30">
                          <div className="p-6">
                            <h4 className="text-xs font-bold text-[#6941C6] uppercase tracking-wider mb-4 flex items-center gap-2">
                              <MessageSquare className="w-4 h-4" />
                              AI Reply Generator
                            </h4>
                            
                            <div className="space-y-4">
                              <div className="relative">
                                <textarea 
                                  value={replyPrompt || ''}
                                  onChange={(e) => setReplyPrompt(e.target.value)}
                                  placeholder="Instructions for the reply (e.g., 'Accept the RFI but ask for more documents')..."
                                  className="w-full h-24 p-4 bg-white border border-[#D0D5DD] rounded-xl text-sm focus:ring-4 focus:ring-[#F4EBFF] focus:border-[#7F56D9] outline-none transition-all placeholder:text-[#98A2B3] resize-none"
                                />
                                <button 
                                  onClick={() => handleGenerateReply(selectedEmail)}
                                  disabled={isGeneratingReply || !replyPrompt.trim()}
                                  className="absolute bottom-3 right-3 flex items-center gap-2 px-4 py-2 bg-[#7F56D9] text-white rounded-lg text-xs font-bold hover:bg-[#6941C6] transition-all disabled:opacity-50 shadow-sm"
                                >
                                  <Sparkles className={`w-3.5 h-3.5 ${isGeneratingReply ? 'animate-pulse' : ''}`} />
                                  {isGeneratingReply ? 'Drafting...' : 'Generate Reply'}
                                </button>
                              </div>

                              <AnimatePresence>
                                {aiReplyDraft && (
                                  <motion.div 
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="space-y-3"
                                  >
                                    <div className="p-6 bg-white border border-[#E9D7FE] rounded-xl shadow-sm relative group">
                                      <div className="absolute top-4 right-4 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                        <button 
                                          onClick={() => handleSaveReplyToHistory(selectedEmail, aiReplyDraft)}
                                          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F0F9FF] text-[#026AA2] border border-[#B9E6FE] rounded-lg text-xs font-bold hover:bg-[#E0F2FE] transition-all"
                                          title="Agree & Save to History"
                                        >
                                          <CheckSquare className="w-3.5 h-3.5" />
                                          Save to History
                                        </button>
                                        <button 
                                          onClick={() => {
                                            navigator.clipboard.writeText(aiReplyDraft);
                                            toast.success('Reply draft copied to clipboard');
                                          }}
                                          className="p-1.5 text-[#667085] hover:text-[#7F56D9] hover:bg-[#F9F5FF] rounded-md border border-[#EAECF0]"
                                          title="Copy to Clipboard"
                                        >
                                          <CheckSquare className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                      <div className="prose prose-sm max-w-none text-[#344054] whitespace-pre-wrap font-sans">
                                        {aiReplyDraft}
                                      </div>
                                    </div>
                                    <p className="text-[10px] text-[#667085] flex items-center gap-1">
                                      <AlertCircle className="w-3 h-3" />
                                      AI-generated draft. Please review and refine before sending.
                                    </p>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          </div>
                        </div>

                        {/* Email Card (NOW BELOW REPLY) */}
                        <div className="bg-white border border-[#EAECF0] rounded-2xl shadow-sm overflow-hidden">
                          <div className="p-8 border-b border-[#EAECF0]">
                            <div className="flex items-start justify-between mb-8">
                              <div className="space-y-1">
                                <h2 className="text-3xl font-bold text-[#101828] tracking-tight">{selectedEmail.subject}</h2>
                                <div className="flex items-center gap-3 py-2">
                                  <div className="w-8 h-8 rounded-full bg-[#F2F4F7] flex items-center justify-center text-xs font-bold text-[#475467]">
                                    {selectedEmail.from.charAt(0).toUpperCase()}
                                  </div>
                                  <div className="text-sm">
                                    <span className="font-bold text-[#101828]">{selectedEmail.from}</span>
                                    <span className="mx-2 text-[#D0D5DD]">|</span>
                                    <span className="text-[#667085]">{new Date(selectedEmail.receivedAt).toLocaleString()}</span>
                                  </div>
                                </div>
                              </div>
                              <div className="text-right space-y-1">
                                <p className="text-xs font-bold text-[#667085] uppercase tracking-wider">AI Confidence</p>
                                <div className="flex items-center justify-end gap-2">
                                  <div className="text-3xl font-bold text-[#7F56D9]">
                                    {Math.round((selectedEmail.aiConfidence || 0) * 100)}%
                                  </div>
                                  <div className="w-12 h-1.5 bg-[#F2F4F7] rounded-full overflow-hidden">
                                    <div 
                                      className="h-full bg-[#7F56D9]" 
                                      style={{ width: `${(selectedEmail.aiConfidence || 0) * 100}%` }} 
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* AI Summary */}
                            <div className="bg-[#F9F5FF] p-6 rounded-xl border border-[#E9D7FE] flex flex-col sm:flex-row justify-between gap-4">
                              <div className="flex gap-4">
                                <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow-sm shrink-0">
                                  <AlertCircle className="w-5 h-5 text-[#7F56D9]" />
                                </div>
                                <div className="space-y-1">
                                  <p className="text-sm font-bold text-[#6941C6]">AI Intelligence Summary</p>
                                  <p className="text-sm text-[#7F56D9] leading-relaxed">
                                    {selectedEmail.summary || 'Analyzing email content...'}
                                  </p>
                                </div>
                              </div>
                              
                              <div className="shrink-0 relative">
                                <p className="text-[10px] font-black text-[#98A2B3] uppercase tracking-widest mb-1.5 text-right">Classification</p>
                                <button 
                                  onClick={() => setShowClassificationMenu(!showClassificationMenu)}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-2 transition-all shadow-sm ${
                                    selectedEmail.aiClassification === 'MEETING' ? 'bg-[#EFF8FF] text-[#175CD3] border-[#B2DDFF]' :
                                    selectedEmail.aiClassification === 'PROJECT' ? 'bg-[#FFFAEB] text-[#B54708] border-[#FEDF89]' :
                                    selectedEmail.aiClassification === 'MARKETING' ? 'bg-[#F9F5FF] text-[#7F56D9] border-[#E9D7FE]' :
                                    selectedEmail.aiClassification === 'FINANCE' ? 'bg-[#ECFDF3] text-[#027A48] border-[#ABEFC6]' :
                                    selectedEmail.aiClassification === 'OPPORTUNITY' ? 'bg-[#EEF4FF] text-[#3538CD] border-[#B2CCFF]' :
                                    selectedEmail.aiClassification === 'REQUEST' ? 'bg-[#FFFAEB] text-[#B54708] border-[#FEDF89]' :
                                    selectedEmail.aiClassification === 'SUBMITTED' ? 'bg-[#FDF2FA] text-[#C11574] border-[#FCCEEE]' :
                                    selectedEmail.aiClassification === 'AWARDED' ? 'bg-[#ECFDF3] text-[#027A48] border-[#ABEFC6]' :
                                    'bg-white text-[#344054] border-[#EAECF0]'
                                  }`}
                                >
                                  {selectedEmail.aiClassification?.replace('_', ' ') || 'UNCLASSIFIED'}
                                  <ChevronDown className="w-3 h-3" />
                                </button>
                                
                                <AnimatePresence>
                                  {showClassificationMenu && (
                                    <motion.div 
                                      initial={{ opacity: 0, y: 5 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      exit={{ opacity: 0, y: 5 }}
                                      className="absolute top-full right-0 mt-2 w-48 bg-white border border-[#EAECF0] rounded-xl shadow-xl z-20 overflow-hidden"
                                    >
                                      {['REQUEST_MEETING', 'PROJECT', 'MARKETING', 'FINANCE', 'OPPORTUNITY', 'REQUEST', 'SUBMITTED', 'AWARDED', 'OTHER'].map(cat => (
                                        <button
                                          key={cat}
                                          onClick={() => {
                                            handleUpdateEmailClassification(selectedEmail.id, cat);
                                            setShowClassificationMenu(false);
                                          }}
                                          className={`w-full text-left px-4 py-2.5 text-xs transition-colors hover:bg-[#F9FAFB] ${
                                            selectedEmail.aiClassification === cat ? 'font-bold text-[#7F56D9] bg-[#F9F5FF]' : 'text-[#344054]'
                                          }`}
                                        >
                                          {cat.replace('_', ' ')}
                                        </button>
                                      ))}
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            </div>
                          </div>

                          {/* Extracted Data */}
                          <div className="p-8 grid grid-cols-2 gap-10 bg-[#F9FAFB]/30">
                            <div className="space-y-6">
                              <h4 className="text-xs font-bold text-[#667085] uppercase tracking-wider">Extracted Entities</h4>
                              <div className="space-y-4">
                                <DataField label="Project Name" value={selectedEmail.extractedData?.projectName} icon={<Briefcase className="w-4 h-4" />} />
                                <DataField label="Client Name" value={selectedEmail.extractedData?.clientName} icon={<User className="w-4 h-4" />} />
                                <DataField label="Client Organization" value={selectedEmail.extractedData?.clientOrganization} icon={<Users className="w-4 h-4" />} />
                                <DataField label="Client Email" value={selectedEmail.extractedData?.clientEmail} icon={<Mail className="w-4 h-4" />} />
                                <DataField label="Deadline / Key Date" value={selectedEmail.extractedData?.deadline} icon={<Clock className="w-4 h-4" />} />
                              </div>
                            </div>
                            <div className="space-y-6">
                              <h4 className="text-xs font-bold text-[#667085] uppercase tracking-wider">Commercial Details</h4>
                              <div className="space-y-4">
                                <DataField 
                                  label="Estimated Value" 
                                  value={selectedEmail.extractedData?.estimateValue ? `$${selectedEmail.extractedData.estimateValue.toLocaleString()}` : selectedEmail.extractedData?.amount ? `${selectedEmail.extractedData?.currency || 'HKD'} ${selectedEmail.extractedData?.amount}` : undefined} 
                                  icon={<BarChart2 className="w-4 h-4" />} 
                                />
                                <DataField label="Location" value={selectedEmail.extractedData?.location} icon={<Home className="w-4 h-4" />} />
                              </div>
                            </div>
                          </div>

                          {/* Attachments Section */}
                          {selectedEmail.attachments && selectedEmail.attachments.length > 0 && (
                            <div className="p-8 border-t border-[#EAECF0] bg-[#F9FAFB]/50">
                              <h4 className="text-xs font-bold text-[#667085] uppercase tracking-wider mb-4">Attachments ({selectedEmail.attachments.length})</h4>
                              <div className="flex flex-wrap gap-3">
                                {selectedEmail.attachments.map((att, idx) => (
                                  <div key={idx} className="flex items-center gap-2 px-3 py-2 bg-white border border-[#D0D5DD] rounded-lg shadow-sm">
                                    <FileText className="w-4 h-4 text-[#7F56D9]" />
                                    <span className="text-xs font-medium text-[#344054]">{att.filename}</span>
                                    <span className="text-[10px] text-[#667085]">({Math.round(att.size / 1024)} KB)</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Email Body */}
                          <div className="p-8 border-t border-[#EAECF0]">
                            <h4 className="text-xs font-bold text-[#667085] uppercase tracking-wider mb-6">Original Correspondence</h4>
                            <div className="text-sm text-[#344054] leading-relaxed whitespace-pre-wrap bg-[#F9FAFB] p-6 rounded-xl border border-[#EAECF0]">
                              {selectedEmail.body}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-[#98A2B3] gap-4">
                        <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center shadow-sm border border-[#EAECF0]">
                          <Mail className="w-10 h-10 stroke-[1.5]" />
                        </div>
                        <p className="text-sm font-medium">Select a record to review intelligence</p>
                      </div>
                    )}
                  </AnimatePresence>
                </div>
              </>
            )
          ) : activeTab === 'BUSINESS' ? (
              <div className="flex-1 p-8 overflow-y-auto">
                <div className="max-w-[1200px] mx-auto">
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex flex-wrap gap-3">
                      {['OPPORTUNITY', 'REQUEST', 'SUBMITTED', 'AWARDED'].map(tab => (
                        <button 
                          key={tab}
                          onClick={() => setActiveTemplateSubTab(tab as any)}
                          className={`px-4 py-2 text-xs font-bold rounded-lg transition-all border ${
                            activeTemplateSubTab === tab 
                              ? 'bg-[#7F56D9] text-white border-[#7F56D9] shadow-sm' 
                              : 'bg-white text-[#475467] border-[#EAECF0] hover:bg-[#F9FAFB]'
                          }`}
                        >
                          {tab === 'SUBMITTED' ? 'Issued' : tab.charAt(0) + tab.slice(1).toLowerCase().replace('_', ' ')}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-3">
                      <button className="flex items-center gap-2 px-4 py-2 border border-[#D0D5DD] rounded-lg text-sm font-semibold text-[#344054] bg-white hover:bg-[#F9FAFB]">
                        <RefreshCw className="w-4 h-4" />
                        Bulk Update Status
                      </button>
                      <button className="flex items-center gap-2 px-4 py-2 border border-[#D0D5DD] rounded-lg text-sm font-semibold text-[#344054] bg-white hover:bg-[#F9FAFB]">
                        <FileText className="w-4 h-4" />
                        Export Records
                      </button>
                    </div>
                  </div>

                  <div className="bg-white border border-[#EAECF0] rounded-xl shadow-sm overflow-hidden">
                    <table className="w-full text-left">
                      <thead className="bg-[#F9FAFB] border-b border-[#EAECF0]">
                        <tr>
                          <th className="px-6 py-4 text-xs font-bold text-[#667085] uppercase tracking-wider">Ref Number</th>
                          <th className="px-6 py-4 text-xs font-bold text-[#667085] uppercase tracking-wider">Type</th>
                          <th className="px-6 py-4 text-xs font-bold text-[#667085] uppercase tracking-wider">Project Name</th>
                          <th className="px-6 py-4 text-xs font-bold text-[#667085] uppercase tracking-wider">Client</th>
                          <th className="px-6 py-4 text-xs font-bold text-[#667085] uppercase tracking-wider">Estimate Value</th>
                          <th className="px-6 py-4 text-xs font-bold text-[#667085] uppercase tracking-wider">Date</th>
                          <th className="px-6 py-4 text-xs font-bold text-[#667085] uppercase tracking-wider">Status</th>
                          <th className="px-6 py-4 text-xs font-bold text-[#667085] uppercase tracking-wider text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EAECF0]">
                        {templates.filter(t => t.status === activeTemplateSubTab).length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-6 py-12 text-center text-sm text-[#98A2B3]">
                              No records found in {activeTemplateSubTab.toLowerCase()}
                            </td>
                          </tr>
                        ) : (
                          templates.filter(t => t.status === activeTemplateSubTab).map((template) => (
                            <tr key={template.id} className="hover:bg-[#F9FAFB] transition-colors group">
                              <td className="px-6 py-4">
                                <span className="text-sm font-bold text-[#101828]">{template.referenceNumber}</span>
                              </td>
                              <td className="px-6 py-4">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  template.templateType === 'MEETING' ? 'bg-[#EFF8FF] text-[#175CD3]' :
                                  template.templateType === 'PROJECT' ? 'bg-[#FFFAEB] text-[#B54708]' :
                                  template.templateType === 'MARKETING' ? 'bg-[#F9F5FF] text-[#7F56D9]' :
                                  template.templateType === 'FINANCE' ? 'bg-[#ECFDF3] text-[#027A48]' :
                                  template.templateType === 'OPPORTUNITY' ? 'bg-[#EEF4FF] text-[#3538CD]' :
                                  template.templateType === 'REQUEST' ? 'bg-[#FFFAEB] text-[#B54708]' :
                                  template.templateType === 'SUBMITTED' ? 'bg-[#FDF2FA] text-[#C11574]' :
                                  template.templateType === 'AWARDED' ? 'bg-[#ECFDF3] text-[#027A48]' :
                                  'bg-[#F9FAFB] text-[#344054]'
                                }`}>
                                  {template.templateType?.replace('_', ' ')}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <span className="text-sm text-[#475467]">{template.data?.projectName || 'N/A'}</span>
                              </td>
                              <td className="px-6 py-4">
                                <span className="text-sm text-[#475467]">{template.data?.clientName || 'N/A'}</span>
                                <div className="text-[10px] text-[#98A2B3]">{template.data?.clientEmail}</div>
                              </td>
                              <td className="px-6 py-4">
                                <span className="text-sm font-bold text-[#7F56D9]">
                                  {template.data?.estimateValue ? `$${template.data.estimateValue.toLocaleString()}` : '-'}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <span className="text-sm text-[#667085]">{new Date(template.createdAt).toLocaleDateString()}</span>
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-1.5">
                                  <div className="w-1.5 h-1.5 rounded-full bg-[#027A48]" />
                                  <span className="text-xs font-medium text-[#344054]">{template.status}</span>
                                </div>
                              </td>
                              <td className="px-6 py-4 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <button 
                                    onClick={() => setSelectedTemplate(template)}
                                    className="p-2 text-[#667085] hover:text-[#7F56D9] hover:bg-[#F9F5FF] rounded-lg transition-all"
                                    title="View Record"
                                  >
                                    <FileText className="w-4 h-4" />
                                  </button>
                                  <button 
                                    onClick={() => {
                                      setSelectedTemplate(template);
                                      setEditData(template.data || {});
                                      setIsEditingTemplate(true);
                                    }}
                                    disabled={!isAdmin && !allowUserEditTemplates}
                                    className="p-2 text-[#667085] hover:text-[#7F56D9] hover:bg-[#F9F5FF] rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                                    title="Edit Record"
                                  >
                                    <Settings className="w-4 h-4" />
                                  </button>
                                  {(isAdmin || auth.currentUser?.email === template.assignedTo) && (
                                    <button 
                                      onClick={() => handleDeleteTemplate(template.id)}
                                      className="p-2 text-[#667085] hover:text-[#F04438] hover:bg-[#FEF3F2] rounded-lg transition-all"
                                      title="Delete Record"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : activeTab === 'TENDERS' ? (
              <div className="flex-1 flex overflow-hidden">
                {/* Tenders Sidebar */}
                <div className="w-[350px] border-r border-[#EAECF0] bg-white flex flex-col shrink-0">
                  <div className="p-5 border-b border-[#EAECF0] space-y-4">
                    <button 
                      onClick={() => {
                        setSelectedTender(null);
                        setTenderInput('');
                        setBidDraft(null);
                      }}
                      className="w-full flex items-center justify-center gap-2 bg-[#7F56D9] text-white px-4 py-2.5 rounded-lg font-semibold text-sm hover:bg-[#6941C6] transition-all shadow-sm shadow-purple-100"
                    >
                      <RefreshCw className="w-4 h-4" />
                      New Analysis
                    </button>
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" />
                      <input 
                        type="text" 
                        placeholder="Search tenders..." 
                        className="w-full pl-10 pr-4 py-2 bg-[#F9FAFB] border border-[#D0D5DD] rounded-lg text-sm focus:ring-2 focus:ring-[#F4EBFF] focus:border-[#7F56D9] outline-none transition-all"
                      />
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {tenders.length === 0 ? (
                      <div className="p-8 text-center text-[#98A2B3]">
                        <p className="text-sm">No tender analyses yet</p>
                      </div>
                    ) : (
                      tenders.map((tender) => (
                        <div 
                          key={tender.id}
                          onClick={() => {
                            setSelectedTender(tender);
                            setBidDraft(tender.bidDraft || null);
                          }}
                          className={`p-5 border-b border-[#EAECF0] cursor-pointer transition-all hover:bg-[#F9FAFB] group relative ${selectedTender?.id === tender.id ? 'bg-[#F9F5FF] border-l-4 border-l-[#7F56D9]' : ''}`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium text-[#667085]">
                              {new Date(tender.createdAt).toLocaleDateString()}
                            </span>
                            {(isAdmin || auth.currentUser?.email === tender.createdBy) && (
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteTender(tender.id);
                                }}
                                className="opacity-0 group-hover:opacity-100 p-1 text-[#667085] hover:text-[#F04438] transition-all"
                                title="Delete Record"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          <h3 className={`text-sm font-bold mb-1 line-clamp-1 ${selectedTender?.id === tender.id ? 'text-[#6941C6]' : 'text-[#101828]'}`}>
                            {tender.title}
                          </h3>
                          <p className="text-xs text-[#475467] line-clamp-1">{tender.clientName}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Tenders Detail/Input Area */}
                <div className="flex-1 overflow-y-auto bg-[#F9FAFB] p-10">
                  <div className="max-w-5xl mx-auto">
                    {!selectedTender ? (
                      <div className="bg-white border border-[#EAECF0] rounded-2xl shadow-sm p-8 space-y-6">
                        <div className="space-y-2">
                          <h3 className="text-xl font-bold text-[#101828]">New Tender</h3>
                          <p className="text-sm text-[#475467]">Paste the tender document text below to extract requirements and generate a bid draft.</p>
                        </div>
                        <textarea 
                          value={tenderInput || ''}
                          onChange={(e) => setTenderInput(e.target.value)}
                          placeholder="Paste tender document content here or upload a file..."
                          className="w-full h-[400px] p-4 bg-[#F9FAFB] border border-[#D0D5DD] rounded-xl text-sm focus:ring-2 focus:ring-[#F4EBFF] focus:border-[#7F56D9] outline-none transition-all resize-none"
                        />
                        <div className="flex justify-between items-center">
                          <div className="flex gap-2">
                            <input 
                              type="file" 
                              id="tender-upload" 
                              className="hidden" 
                              accept=".pdf,.docx,.txt"
                              multiple
                              onChange={handleFileUpload}
                            />
                            <label 
                              htmlFor="tender-upload"
                              className="flex items-center gap-2 bg-white border border-[#D0D5DD] text-[#344054] px-4 py-2.5 rounded-lg font-bold text-sm hover:bg-[#F9FAFB] cursor-pointer transition-all shadow-sm"
                            >
                              <Upload className="w-4 h-4" />
                              Upload Documents
                            </label>
                          </div>
                          <button 
                            onClick={handleAnalyzeTender}
                            disabled={isAnalyzingTender || !tenderInput.trim()}
                            className="flex items-center gap-2 bg-[#7F56D9] text-white px-6 py-3 rounded-lg font-bold text-sm hover:bg-[#6941C6] disabled:opacity-50 transition-all shadow-lg shadow-purple-100"
                          >
                            {isAnalyzingTender ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
                            {isAnalyzingTender ? 'Analyzing...' : 'Start AI Analysis'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-8 pb-20">
                        {/* Tender Intelligence Header */}
                        <div className="bg-white border border-[#EAECF0] rounded-3xl shadow-sm p-10 relative overflow-hidden">
                          <div className="absolute top-0 right-0 w-64 h-64 bg-[#F9F5FF] rounded-full -mr-32 -mt-32 blur-3xl opacity-50" />
                          <div className="relative z-10">
                            <div className="flex justify-between items-start mb-8">
                              <div className="space-y-2">
                                <div className="flex items-center gap-3">
                                  <span className="px-3 py-1 bg-[#EEF4FF] border border-[#B2DDFF] text-[#175CD3] text-[10px] font-bold rounded-full uppercase tracking-wider">
                                    {(selectedTender.status || 'draft').replace('_', ' ')}
                                  </span>
                                  <span className="text-[10px] font-bold text-[#667085] uppercase tracking-widest">Added {new Date(selectedTender.createdAt).toLocaleDateString()}</span>
                                </div>
                                <h2 className="text-3xl font-black text-[#101828] leading-tight max-w-2xl">{selectedTender.title}</h2>
                                <p className="text-lg font-medium text-[#475467]">{selectedTender.issuing_org}</p>
                              </div>
                              <div className="flex flex-col items-end gap-3">
                                <div className="text-right">
                                   <p className="text-[10px] font-bold text-[#98A2B3] uppercase tracking-widest mb-1">Win Probability</p>
                                   <div className="flex items-center gap-3">
                                      <div className="text-4xl font-black text-[#12B76A]">{selectedTender.win_probability}%</div>
                                      <div className="w-16 h-1.5 bg-[#F2F4F7] rounded-full overflow-hidden">
                                         <motion.div 
                                           initial={{ width: 0 }}
                                           animate={{ width: `${selectedTender.win_probability}%` }}
                                           className="h-full bg-[#12B76A]" 
                                         />
                                      </div>
                                   </div>
                                </div>
                                <button 
                                  onClick={() => handleCreateBid(selectedTender)}
                                  disabled={isGeneratingBid}
                                  className="flex items-center gap-2 bg-[#7F56D9] text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-[#6941C6] transition-all shadow-lg shadow-purple-100 disabled:opacity-50"
                                >
                                  {isGeneratingBid ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ArrowUpRight className="w-4 h-4" />}
                                  {isGeneratingBid ? 'Generating Draft...' : 'Generate AI Bid Draft'}
                                </button>
                                <button 
                                  onClick={() => handleCreateProposal({ id: selectedTender.opportunity_id || '' }, selectedTender)}
                                  className="flex items-center gap-2 bg-[#F9F5FF] text-[#7F56D9] border border-[#E9D7FE] px-6 py-3 rounded-xl font-bold text-sm hover:bg-[#F4EBFF] transition-all shadow-sm"
                                >
                                  <Sparkles className="w-4 h-4" />
                                  Generate Proposal Content
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-10 pt-10 border-t border-[#F2F4F7]">
                              <div>
                                 <p className="text-[10px] font-bold text-[#98A2B3] uppercase tracking-widest mb-2">Submission Deadline</p>
                                 <div className="flex items-center gap-2 text-[#F04438] font-bold">
                                    <Clock className="w-4 h-4" />
                                    <span>{selectedTender.deadline}</span>
                                 </div>
                              </div>
                              <div>
                                 <p className="text-[10px] font-bold text-[#98A2B3] uppercase tracking-widest mb-2">Budget (Est.)</p>
                                 <div className="flex items-center gap-2 text-[#101828] font-bold">
                                    <BarChart2 className="w-4 h-4 text-[#7F56D9]" />
                                    <span>{selectedTender.value_range?.currency || 'USD'} {selectedTender.value_range?.min?.toLocaleString() || '0'} - {selectedTender.value_range?.max?.toLocaleString() || '0'}</span>
                                 </div>
                              </div>
                              <div>
                                 <p className="text-[10px] font-bold text-[#98A2B3] uppercase tracking-widest mb-2">Key Contact</p>
                                 <div className="flex items-center gap-2 text-[#101828] font-bold">
                                    <Users className="w-4 h-4 text-[#7F56D9]" />
                                    <span>{selectedTender.contacts?.[0]?.name || 'Not Available'}</span>
                                 </div>
                              </div>
                              <div className="flex -space-x-3">
                                 {selectedTender.assigned_team?.map((userId: string, i: number) => (
                                   <div key={i} className="w-10 h-10 rounded-full bg-[#F2F4F7] border-4 border-white flex items-center justify-center text-xs font-bold text-[#475467]">
                                      {userId.charAt(0).toUpperCase()}
                                   </div>
                                 ))}
                                 <button className="w-10 h-10 rounded-full bg-white border-2 border-dashed border-[#EAECF0] flex items-center justify-center text-[#98A2B3] hover:text-[#7F56D9] transition-all">
                                    <Plus className="w-4 h-4" />
                                 </button>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                          {/* Strategic Analysis Column */}
                          <div className="lg:col-span-2 space-y-8">
                             {/* Requirement Intelligence Checklist */}
                             <div className="bg-white border border-[#EAECF0] rounded-3xl shadow-sm overflow-hidden">
                                <div className="p-6 border-b border-[#EAECF0] bg-[#F9FAFB] flex items-center justify-between">
                                   <div className="flex items-center gap-3">
                                      <CheckCircle className="w-5 h-5 text-[#7F56D9]" />
                                      <h3 className="text-lg font-bold text-[#101828]">Requirement Intelligence</h3>
                                   </div>
                                   <span className="text-[10px] font-black bg-white px-3 py-1 border border-[#EAECF0] rounded-lg">
                                      {selectedTender.requirements?.filter((r: any) => r.compliant).length || 0} / {selectedTender.requirements?.length || 0} COMPLIANT
                                   </span>
                                </div>
                                <div className="divide-y divide-[#EAECF0]">
                                   {selectedTender.requirements?.map((req: any, i: number) => (
                                     <div key={i} className="p-6 flex items-start gap-4 hover:bg-[#F9FAFB] transition-all group">
                                        <button 
                                          onClick={() => {
                                            const newReqs = [...selectedTender.requirements];
                                            newReqs[i].compliant = !newReqs[i].compliant;
                                            handleUpdateTender(selectedTender.id, { requirements: newReqs });
                                          }}
                                          className={`mt-1 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-all ${req.compliant ? 'bg-[#12B76A] border-[#12B76A]' : 'bg-white border-[#D0D5DD] group-hover:border-[#7F56D9]'}`}
                                        >
                                           {req.compliant && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                                        </button>
                                        <div className="flex-1 space-y-1">
                                           <div className="flex items-center gap-2">
                                              <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter ${
                                                req.category === 'technical' ? 'bg-[#EFF8FF] text-[#175CD3]' :
                                                req.category === 'commercial' ? 'bg-[#FDF2FA] text-[#C11574]' :
                                                'bg-[#F9FAFB] text-[#475467]'
                                              }`}>
                                                 {req.category}
                                              </span>
                                              {req.mandatory && <span className="text-[8px] font-black text-[#F04438] uppercase">Critical</span>}
                                           </div>
                                           <p className={`text-sm ${req.compliant ? 'text-[#98A2B3] line-through' : 'text-[#344054] font-medium'}`}>{req.text}</p>
                                        </div>
                                     </div>
                                   ))}
                                </div>
                             </div>

                             {/* Evaluation Framework */}
                             <div className="bg-white border border-[#EAECF0] rounded-3xl shadow-sm p-8">
                                <h3 className="text-lg font-bold text-[#101828] mb-6 flex items-center gap-3">
                                   <BarChart2 className="w-5 h-5 text-[#7F56D9]" />
                                   Evaluation Framework
                                </h3>
                                <div className="space-y-6">
                                   {selectedTender.evaluation_criteria?.map((item: any, i: number) => (
                                     <div key={i} className="space-y-2">
                                        <div className="flex justify-between items-center text-sm">
                                           <span className="font-bold text-[#344054]">{item.criterion}</span>
                                           <span className="font-black text-[#101828]">{item.weight_percent}%</span>
                                        </div>
                                        <div className="h-2 bg-[#F2F4F7] rounded-full overflow-hidden">
                                           <motion.div 
                                              initial={{ width: 0 }}
                                              animate={{ width: `${item.weight_percent}%` }}
                                              className="h-full bg-[#7F56D9]" 
                                           />
                                        </div>
                                     </div>
                                   ))}
                                </div>
                             </div>
                          </div>

                          {/* Strategy Sidebar Column */}
                          <div className="space-y-8">
                             {/* Win Themes Heatmap */}
                             <div className="bg-[#101828] rounded-3xl p-8 text-white shadow-xl shadow-gray-200 relative overflow-hidden">
                                <Sparkles className="w-20 h-20 text-white/5 absolute -top-4 -right-4 rotate-12" />
                                <h3 className="text-lg font-bold mb-6 flex items-center gap-3">
                                   <TrendingUp className="w-5 h-5 text-[#D6BBFB]" />
                                   Suggested Win Themes
                                </h3>
                                <div className="space-y-4 relative z-10">
                                   {selectedTender.win_themes?.map((theme: string, i: number) => (
                                     <div key={i} className="p-4 bg-white/5 border border-white/10 rounded-2xl flex items-start gap-3 hover:bg-white/10 transition-all cursor-default">
                                        <div className="w-6 h-6 rounded-lg bg-[#7F56D9] flex items-center justify-center shrink-0 text-xs font-bold">{i+1}</div>
                                        <p className="text-sm text-gray-300 leading-relaxed">{theme}</p>
                                     </div>
                                   ))}
                                </div>
                             </div>

                             {/* Risk Framework */}
                             <div className="bg-white border border-[#EAECF0] rounded-3xl p-8">
                                <h3 className="text-lg font-bold text-[#101828] mb-6 flex items-center gap-3">
                                   <AlertCircle className="w-5 h-5 text-[#F04438]" />
                                   Risk Assessment
                                </h3>
                                <div className="space-y-4">
                                   {selectedTender.risk_assessment?.map((risk: any, i: number) => (
                                     <div key={i} className="p-4 bg-[#FEF3F2] border border-[#FECDCA] rounded-2xl space-y-1">
                                        <div className="flex items-center justify-between">
                                           <span className="text-[10px] font-black text-[#B42318] uppercase tracking-widest">{risk.type}</span>
                                           <span className="px-1.5 py-0.5 bg-[#B42318] text-white text-[8px] font-black rounded uppercase">{risk.severity}</span>
                                        </div>
                                        <p className="text-sm font-bold text-[#912018]">{risk.description}</p>
                                     </div>
                                   ))}
                                </div>
                             </div>

                             {/* Knowledge Base Integration */}
                             <div className="p-6 bg-[#F9FAFB] border-2 border-dashed border-[#EAECF0] rounded-3xl flex flex-col items-center text-center">
                                <div className="w-12 h-12 bg-white rounded-2xl shadow-sm flex items-center justify-center mb-4">
                                   <Search className="w-6 h-6 text-[#98A2B3]" />
                                </div>
                                <h4 className="text-sm font-bold text-[#101828] mb-1">Compare to Past Wins</h4>
                                <p className="text-xs text-[#667085] mb-4">AI identified 3 similar successful proposals in your database.</p>
                                <button className="text-xs font-bold text-[#7F56D9] hover:underline">Review Historical Reference</button>
                             </div>
                          </div>
                        </div>
                      </div>
)}
                  </div>
                </div>
              </div>
            ) : activeTab === 'ACCOUNTS' ? (
              <div className="flex-1 p-8 overflow-y-auto bg-[#F9FAFB]">
                <div className="max-w-7xl mx-auto space-y-8">
                  {/* CRM Header */}
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                    <div>
                      <h3 className="text-2xl font-bold text-[#101828]">VIP Portfolio</h3>
                      <p className="text-sm text-[#475467]">Strategic partnership monitoring and relationship intelligence.</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#98A2B3]" />
                        <input 
                          type="text"
                          placeholder="Search accounts, contacts..."
                          value={accountSearchTerm || ''}
                          onChange={(e) => setAccountSearchTerm(e.target.value)}
                          className="pl-10 pr-4 py-2 bg-white border border-[#D0D5DD] rounded-xl text-sm focus:ring-2 focus:ring-[#7F56D9]/20 focus:border-[#7F56D9] transition-all w-64 shadow-sm"
                        />
                      </div>
                      <button 
                        onClick={() => openAccountModal()}
                        className="flex items-center gap-2 px-4 py-2 bg-[#7F56D9] text-white rounded-xl text-sm font-semibold hover:bg-[#6941C6] transition-all shadow-sm"
                      >
                        <Plus className="w-4 h-4" />
                        Register Account
                      </button>
                      <div className="flex bg-white border border-[#EAECF0] rounded-xl overflow-hidden shadow-sm">
                        <button 
                          onClick={() => setAccountView('GRID')}
                          className={`p-2 transition-all ${accountView === 'GRID' ? 'bg-[#F9F5FF] text-[#7F56D9]' : 'text-[#667085] hover:bg-[#F9FAFB]'}`}
                        >
                          <LayoutGrid className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setAccountView('LIST')}
                          className={`p-2 transition-all ${accountView === 'LIST' ? 'bg-[#F9F5FF] text-[#7F56D9]' : 'text-[#667085] hover:bg-[#F9FAFB]'}`}
                        >
                          <List className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex bg-white border border-[#D0D5DD] rounded-xl overflow-hidden shadow-sm">
                        <button 
                          onClick={() => setAccountView('GRID')}
                          className={`p-2 transition-all ${accountView === 'GRID' ? 'bg-[#F9F5FF] text-[#7F56D9]' : 'text-[#667085] hover:bg-[#F9FAFB]'}`}
                        >
                          <Layers className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setAccountView('LIST')}
                          className={`p-2 transition-all ${accountView === 'LIST' ? 'bg-[#F9F5FF] text-[#7F56D9]' : 'text-[#667085] hover:bg-[#F9FAFB]'}`}
                        >
                          <List className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {selectedAccount ? (
                    <motion.div 
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="grid grid-cols-1 lg:grid-cols-12 gap-8"
                    >
                      {/* Left: Detail Sidebar */}
                      <div className="lg:col-span-4 space-y-6">
                        <div className="bg-white border border-[#EAECF0] rounded-3xl p-6 shadow-sm">
                          <div className="flex items-center justify-between mb-6">
                            <button 
                              onClick={() => setSelectedAccount(null)}
                              className="text-xs font-bold text-[#475467] hover:text-[#101828] flex items-center gap-2"
                            >
                              <ChevronRight className="w-4 h-4 rotate-180" />
                              Back to Register
                            </button>
                            <div className="flex items-center gap-2">
                              <button 
                                onClick={() => openAccountModal(selectedAccount)}
                                className="p-2 text-[#667085] hover:text-[#7F56D9] bg-[#F9FAFB] hover:bg-[#F9F5FF] rounded-xl transition-all"
                                title="Edit Account"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => handleDeleteAccount(selectedAccount.id)}
                                className="p-2 text-[#98A2B3] hover:text-[#F04438] bg-[#F9FAFB] hover:bg-[#FFF1F0] rounded-xl transition-all"
                                title="Delete Account"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          <div className="flex items-center gap-4 mb-6">
                            <div className="w-16 h-16 bg-[#F9F5FF] rounded-2xl flex items-center justify-center text-[#7F56D9] text-2xl font-black">
                              {selectedAccount.name.charAt(0)}
                            </div>
                            <div>
                              <h4 className="text-xl font-bold text-[#101828]">{selectedAccount.name}</h4>
                              <p className="text-sm text-[#667085]">{selectedAccount.industry}</p>
                            </div>
                          </div>

                          <div className="space-y-4">
                            <div className="flex items-center justify-between p-3 bg-[#F9FAFB] rounded-2xl">
                              <span className="text-xs font-bold text-[#475467]">Account Tier</span>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                                selectedAccount.tier === 'strategic' ? 'bg-[#F9F5FF] text-[#7F56D9] border border-[#E9D7FE]' :
                                selectedAccount.tier === 'priority' ? 'bg-[#EFF8FF] text-[#175CD3] border border-[#B2DDFF]' :
                                'bg-[#F9FAFB] text-[#475467] border border-[#EAECF0]'
                              }`}>
                                {selectedAccount.tier}
                              </span>
                            </div>

                            <div className="p-4 bg-[#F9F5FF] border border-[#E9D7FE] rounded-2xl border-dashed">
                              <h5 className="text-[10px] font-black text-[#6941C6] uppercase tracking-widest mb-3">isBIM Account Owner</h5>
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-xs font-bold text-[#7F56D9] shadow-sm">
                                  {allUsers.find(u => u.uid === selectedAccount.owner_id)?.displayName?.charAt(0) || selectedAccount.owner_email?.charAt(0) || 'U'}
                                </div>
                                <div>
                                  <p className="text-sm font-bold text-[#101828]">{allUsers.find(u => u.uid === selectedAccount.owner_id)?.displayName || 'Staff Member'}</p>
                                  <p className="text-xs text-[#7F56D9]">{selectedAccount.owner_email}</p>
                                </div>
                              </div>
                            </div>

                            <div className="p-4 border border-[#EAECF0] rounded-2xl space-y-3">
                              <h5 className="text-[10px] font-black text-[#98A2B3] uppercase tracking-widest">Primary Contact</h5>
                              <div className="space-y-1">
                                <p className="text-sm font-bold text-[#101828]">{selectedAccount.primary_contact?.name || 'No Contact Set'}</p>
                                <p className="text-xs text-[#667085] flex items-center gap-1.5"><Mail className="w-3 h-3" />{selectedAccount.primary_contact?.email}</p>
                                <p className="text-xs text-[#667085] flex items-center gap-1.5"><Briefcase className="w-3 h-3" />{selectedAccount.primary_contact?.position}</p>
                                <p className="text-xs text-[#667085] flex items-center gap-1.5"><Phone className="w-3 h-3" />{selectedAccount.primary_contact?.mobile}</p>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Health Pulse */}
                        <div className="bg-white border border-[#EAECF0] rounded-3xl p-6 shadow-sm overflow-hidden relative">
                          <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-bold text-[#101828]">Account Health</h3>
                            <div className={`w-3 h-3 rounded-full shadow-[0_0_12px] ${
                              (selectedAccount.ai_insights?.health_score || 0) >= 8 ? 'bg-[#12B76A] shadow-[#12B76A]/40' :
                              (selectedAccount.ai_insights?.health_score || 0) >= 4 ? 'bg-[#F79009] shadow-[#F79009]/40' :
                              'bg-[#F04438] shadow-[#F04438]/40'
                            }`} />
                          </div>
                          
                          <div className="flex items-baseline gap-2 mb-2">
                            <span className="text-4xl font-black text-[#101828]">{selectedAccount.ai_insights?.health_score || '-'}</span>
                            <span className="text-sm font-bold text-[#667085]">/ 10</span>
                          </div>
                          
                          <p className="text-xs text-[#475467] mb-6 flex items-center gap-1.5 font-bold uppercase tracking-wider">
                            Trend: 
                            <span className={
                              selectedAccount.ai_insights?.health_trend === 'improving' ? 'text-[#12B76A]' :
                              selectedAccount.ai_insights?.health_trend === 'declining' ? 'text-[#F04438]' :
                              'text-[#475467]'
                            }>
                              {selectedAccount.ai_insights?.health_trend || 'Pending Sync'}
                            </span>
                          </p>

                          <button 
                            onClick={() => handleAnalyzeAccountHealth(selectedAccount.id)}
                            disabled={isAnalyzingAccount}
                            className="w-full flex items-center justify-center gap-2 py-3 bg-[#F9F5FF] text-[#7F56D9] rounded-2xl text-xs font-black uppercase tracking-widest border border-[#E9D7FE] hover:bg-[#F4EBFF] transition-all disabled:opacity-50"
                          >
                            <Sparkles className={`w-4 h-4 ${isAnalyzingAccount ? 'animate-pulse' : ''}`} />
                            {isAnalyzingAccount ? 'Refreshing Insights...' : 'Recalculate Health'}
                          </button>
                        </div>
                      </div>

                      {/* Right: Main Dashboard Content */}
                      <div className="lg:col-span-8 space-y-8">
                        {/* Summary Bento Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                           <div className="bg-white border border-[#EAECF0] rounded-3xl p-6 shadow-sm">
                              <span className="text-[10px] font-black text-[#98A2B3] uppercase tracking-widest block mb-2">Last Contact</span>
                              <div className="flex items-center gap-2">
                                 <Clock className="w-4 h-4 text-[#7F56D9]" />
                                 <span className="text-lg font-bold text-[#101828]">{selectedAccount.last_contact_date ? new Date(selectedAccount.last_contact_date).toLocaleDateString() : 'No log'}</span>
                              </div>
                           </div>
                           <div className="bg-white border border-[#EAECF0] rounded-3xl p-6 shadow-sm">
                              <span className="text-[10px] font-black text-[#98A2B3] uppercase tracking-widest block mb-2">Email Volume (30d)</span>
                              <div className="flex items-center gap-2">
                                 <Mail className="w-4 h-4 text-[#7F56D9]" />
                                 <span className="text-lg font-bold text-[#101828]">{selectedAccount.email_volume_30d || 0} messages</span>
                              </div>
                           </div>
                           <div className="bg-white border border-[#EAECF0] rounded-3xl p-6 shadow-sm">
                              <span className="text-[10px] font-black text-[#98A2B3] uppercase tracking-widest block mb-2">Won Value (YTD)</span>
                              <div className="flex items-center gap-2">
                                 <TrendingUp className="w-4 h-4 text-[#12B76A]" />
                                 <span className="text-lg font-bold text-[#027A48]">HKD {(selectedAccount.won_value_ytd || 0).toLocaleString()}</span>
                              </div>
                           </div>
                           <div className="bg-white border border-[#EAECF0] rounded-3xl p-6 shadow-sm">
                              <span className="text-[10px] font-black text-[#98A2B3] uppercase tracking-widest block mb-2">Active Proposals</span>
                              <div className="flex items-center gap-2">
                                 <FileText className="w-4 h-4 text-[#7F56D9]" />
                                 <span className="text-lg font-bold text-[#101828]">{proposals.filter(p => p.client_id === selectedAccount.id && p.status !== 'rejected').length} documents</span>
                              </div>
                           </div>
                        </div>

                        {/* AI Insights Panel */}
                        {selectedAccount.ai_insights && (
                          <div className="bg-white border border-[#EAECF0] rounded-3xl p-8 shadow-sm relative overflow-hidden">
                             <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
                                <Sparkles className="w-32 h-32 text-[#7F56D9]" />
                             </div>
                             <h4 className="text-lg font-bold text-[#101828] mb-6 flex items-center gap-2">
                                <Sparkles className="w-5 h-5 text-[#7F56D9]" />
                                Relationship Workspace Intelligence
                             </h4>
                             
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="space-y-6">
                                   <div>
                                      <h5 className="text-[10px] font-black text-[#98A2B3] uppercase tracking-widest mb-3">Next Best Action</h5>
                                      <p className="text-sm font-bold text-[#344054] leading-relaxed p-4 bg-[#F9F5FF] rounded-2xl border border-[#E9D7FE]">
                                         {selectedAccount.ai_insights.next_best_action}
                                      </p>
                                   </div>
                                   <div>
                                      <h5 className="text-[10px] font-black text-[#98A2B3] uppercase tracking-widest mb-3">Recommended Tasks</h5>
                                      <div className="space-y-2">
                                         {selectedAccount.ai_insights.recommended_actions.map((action, i) => (
                                           <div key={i} className="flex items-center gap-3 p-3 hover:bg-[#F9FAFB] rounded-xl transition-all border border-transparent hover:border-[#EAECF0] group cursor-pointer">
                                              <div className="w-5 h-5 border-2 border-[#D0D5DD] rounded group-hover:border-[#7F56D9]" />
                                              <span className="text-xs font-bold text-[#475467]">{action}</span>
                                           </div>
                                         ))}
                                      </div>
                                   </div>
                                </div>
                                <div className="space-y-6">
                                   <div>
                                      <h5 className="text-[10px] font-black text-[#98A2B3] uppercase tracking-widest mb-3">Upsell Opportunities</h5>
                                      <div className="flex flex-wrap gap-2">
                                         {selectedAccount.ai_insights.upsell_hints.map((hint, i) => (
                                           <span key={i} className="px-3 py-1 bg-[#ECFDF3] text-[#027A48] text-[10px] font-black rounded-full border border-[#ABEFC6] uppercase tracking-wider">
                                              {hint}
                                           </span>
                                         ))}
                                      </div>
                                   </div>
                                   <div className="p-4 bg-[#FEF3F2] border border-[#FECDCA] rounded-2xl">
                                      <div className="flex items-center gap-2 mb-2">
                                         <AlertCircle className="w-4 h-4 text-[#F04438]" />
                                         <h5 className="text-[10px] font-black text-[#B42318] uppercase tracking-widest">Churn Risk Analysis</h5>
                                      </div>
                                      <p className="text-xs font-bold text-[#912018]">
                                         Account is flagged as <span className="uppercase">{selectedAccount.ai_insights.churn_risk}</span> risk. 
                                         {selectedAccount.ai_insights.churn_risk !== 'low' && ' Proactive executive outreach recommended.'}
                                      </p>
                                   </div>
                                </div>
                             </div>
                          </div>
                        )}

                        {/* Interaction Timeline & Notes */}
                        <div className="bg-white border border-[#EAECF0] rounded-3xl p-8 shadow-sm">
                           <div className="flex items-center justify-between mb-8">
                             <h4 className="text-lg font-bold text-[#101828]">Interaction Timeline</h4>
                             <button 
                               onClick={() => {
                                 const note = prompt('Enter interaction details:');
                                 if (note) handleLogInteraction(selectedAccount.id, note);
                               }}
                               className="px-4 py-2 border border-[#D0D5DD] rounded-xl text-xs font-bold text-[#344054] hover:bg-[#F9FAFB] transition-all flex items-center gap-2 shadow-sm"
                             >
                               <Plus className="w-4 h-4" />
                               Log Interaction
                             </button>
                           </div>

                           <div className="space-y-8 relative before:absolute before:left-3 before:top-2 before:bottom-0 before:w-px before:bg-[#EAECF0]">
                             {selectedAccount.internal_notes?.length === 0 ? (
                               <p className="text-sm text-[#98A2B3] italic text-center py-12">No interactions logged for this account yet.</p>
                             ) : (
                               [...selectedAccount.internal_notes].reverse().map((note, i) => (
                                 <div key={i} className="flex gap-6 relative">
                                    <div className="w-6 h-6 bg-white border-2 border-[#7F56D9] rounded-full flex items-center justify-center shrink-0 z-10">
                                       <div className="w-2 h-2 bg-[#7F56D9] rounded-full" />
                                    </div>
                                    <div className="space-y-1">
                                       <div className="flex items-center gap-2">
                                          <span className="text-xs font-black text-[#101828]">{note.userEmail}</span>
                                          <span className="text-[10px] text-[#98A2B3]">{new Date(note.timestamp).toLocaleString()}</span>
                                       </div>
                                       <p className="text-sm text-[#475467] leading-relaxed">{note.text}</p>
                                    </div>
                                 </div>
                               ))
                             )}
                           </div>
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    <div className="bg-white border border-[#EAECF0] rounded-3xl shadow-sm overflow-hidden">
                      <table className="w-full text-left">
                        <thead className="text-[10px] font-black text-[#667085] uppercase tracking-widest bg-[#F9FAFB] border-b border-[#EAECF0]">
                          <tr>
                            <th className="px-8 py-5">Account & Industry</th>
                            <th className="px-6 py-5">isBIM Owner</th>
                            <th className="px-6 py-5">Stakeholder</th>
                            <th className="px-6 py-5">Contact Details</th>
                            <th className="px-6 py-5">Tier</th>
                            <th className="px-6 py-5">Health</th>
                            <th className="px-6 py-5">Last Activity</th>
                            <th className="px-6 py-5">Pipeline</th>
                            <th className="px-8 py-5 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#EAECF0]">
                          {accounts
                            .filter(a => isAdmin || a.owner_id === auth.currentUser?.uid)
                            .filter(a => {
                              const term = accountSearchTerm.toLowerCase();
                              return (
                                a.name.toLowerCase().includes(term) ||
                                a.industry?.toLowerCase().includes(term) ||
                                (a.primary_contact?.name || '').toLowerCase().includes(term) ||
                                (a.primary_contact?.email || '').toLowerCase().includes(term) ||
                                (a.owner_email || '').toLowerCase().includes(term) ||
                                (allUsers.find(u => u.uid === a.owner_id)?.displayName || '').toLowerCase().includes(term)
                              );
                            })
                            .map((account) => (
                            <tr 
                              key={account.id} 
                              onClick={() => setSelectedAccount(account)}
                              className="hover:bg-[#F9FAFB] transition-all cursor-pointer group"
                            >
                              <td className="px-8 py-6">
                                <div className="flex items-center gap-4">
                                  <div className="w-10 h-10 bg-[#F9F5FF] rounded-xl flex items-center justify-center text-[#7F56D9] font-black text-sm group-hover:scale-110 transition-transform">
                                    {account.name.charAt(0)}
                                  </div>
                                  <div>
                                    <p className="font-bold text-[#101828] group-hover:text-[#7F56D9] transition-colors">{account.name}</p>
                                    <p className="text-xs text-[#667085]">{account.industry || 'Unknown Sector'}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-6 text-sm">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 bg-[#F2F4F7] rounded-full flex items-center justify-center text-[10px] font-bold text-[#475467]">
                                    {allUsers.find(u => u.uid === account.owner_id)?.displayName?.charAt(0) || account.owner_email?.charAt(0) || 'U'}
                                  </div>
                                  <div>
                                    <p className="font-medium text-[#344054] text-xs">{allUsers.find(u => u.uid === account.owner_id)?.displayName || 'Unknown'}</p>
                                    <p className="text-[10px] text-[#98A2B3]">{account.owner_email}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-6 text-sm">
                                <p className="font-bold text-[#344054]">{account.primary_contact?.name || '-'}</p>
                                <p className="text-[10px] text-[#98A2B3] italic">{account.primary_contact?.position || 'No Role'}</p>
                              </td>
                              <td className="px-6 py-6 text-sm">
                                <p className="text-xs text-[#667085] flex items-center gap-1.5"><Mail className="w-3 h-3 text-[#98A2B3]" />{account.primary_contact?.email || '-'}</p>
                                <p className="text-xs text-[#667085] flex items-center gap-1.5"><Phone className="w-3 h-3 text-[#98A2B3]" />{account.primary_contact?.mobile || '-'}</p>
                              </td>
                              <td className="px-6 py-6 text-sm">
                                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                                  account.tier === 'strategic' ? 'bg-[#F9F5FF] text-[#7F56D9] border border-[#E9D7FE]' :
                                  account.tier === 'priority' ? 'bg-[#EFF8FF] text-[#175CD3] border border-[#B2DDFF]' :
                                  'bg-[#F9FAFB] text-[#475467] border border-[#EAECF0]'
                                }`}>
                                  {account.tier || 'Standard'}
                                </span>
                              </td>
                              <td className="px-6 py-6">
                                <div className="flex items-center gap-2">
                                  <div className={`w-2.5 h-2.5 rounded-full ${
                                    (account.ai_insights?.health_score || 0) >= 8 ? 'bg-[#12B76A]' :
                                    (account.ai_insights?.health_score || 0) >= 4 ? 'bg-[#F79009]' :
                                    'bg-[#F04438]'
                                  }`} />
                                  <span className="text-xs font-bold text-[#344054]">{account.ai_insights?.health_score || 'N/A'}</span>
                                </div>
                              </td>
                              <td className="px-6 py-6">
                                <p className="text-xs font-bold text-[#344054]">{account.last_contact_date ? new Date(account.last_contact_date).toLocaleDateString() : 'Never'}</p>
                                <p className="text-[10px] text-[#98A2B3] italic capitalize">{account.sentiment_trend}</p>
                              </td>
                              <td className="px-6 py-6">
                                <div className="flex flex-col gap-1">
                                   <div className="w-24 h-1.5 bg-[#EAECF0] rounded-full overflow-hidden">
                                      <div className="h-full bg-[#12B76A] rounded-full" style={{ width: `${Math.min(100, (account.won_value_ytd || 0) / 10000)}%` }} />
                                   </div>
                                   <span className="text-[10px] font-bold text-[#667085]">HKD {(account.won_value_ytd || 0).toLocaleString()} won</span>
                                </div>
                              </td>
                              <td className="px-8 py-6 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openAccountModal(account);
                                    }}
                                    className="p-1 px-2 text-[#667085] hover:text-[#7F56D9] transition-all flex items-center gap-1 hover:bg-[#F9F5FF] rounded-lg"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                    <span className="text-[10px] font-bold">Edit</span>
                                  </button>
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteAccount(account.id);
                                    }}
                                    className="p-1 px-2 text-[#98A2B3] hover:text-[#F04438] transition-all flex items-center gap-1 hover:bg-[#FFF1F0] rounded-lg"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span className="text-[10px] font-bold">Delete</span>
                                  </button>
                                  <ChevronRight className="w-5 h-5 text-[#98A2B3] group-hover:text-[#7F56D9] group-hover:translate-x-1 transition-all" />
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {accounts.length === 0 && (
                        <div className="p-16 text-center">
                          <div className="w-16 h-16 bg-[#F9FAFB] rounded-2xl flex items-center justify-center mx-auto mb-4">
                            <Users className="w-8 h-8 text-[#98A2B3]" />
                          </div>
                          <h4 className="text-lg font-bold text-[#101828] mb-2">No accounts registered yet</h4>
                          <p className="text-sm text-[#667085] max-w-xs mx-auto mb-8">Start by adding your key strategic partners to track relationship health with AI insights.</p>
                          <button 
                            onClick={() => openAccountModal()}
                            className="px-6 py-2.5 bg-[#7F56D9] text-white rounded-xl text-sm font-bold shadow-sm hover:bg-[#6941C6] transition-all"
                          >
                            Add Your First Account
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : activeTab === 'PROPOSALS' ? (
              <div className="flex-1 p-8 overflow-y-auto bg-[#F9FAFB]">
                <div className="max-w-7xl mx-auto space-y-8">
                  {/* Proposal Header */}
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                    <div>
                      <h3 className="text-2xl font-bold text-[#101828]">Proposal</h3>
                      <p className="text-sm text-[#475467]">Generate and manage client-ready proposals with AI-suggested content.</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#98A2B3]" />
                        <input 
                          type="text"
                          placeholder="Search proposals..."
                          value={proposalSearchTerm || ''}
                          onChange={(e) => setProposalSearchTerm(e.target.value)}
                          className="pl-10 pr-4 py-2 bg-white border border-[#D0D5DD] rounded-xl text-sm focus:ring-2 focus:ring-[#7F56D9]/20 focus:border-[#7F56D9] transition-all w-64 shadow-sm"
                        />
                      </div>
                      <button 
                        onClick={() => toast.info('Please create a proposal from an Opportunity email or Tender.')}
                        className="flex items-center gap-2 px-4 py-2 bg-[#7F56D9] text-white rounded-xl text-sm font-semibold hover:bg-[#6941C6] transition-all shadow-sm"
                      >
                        <Plus className="w-4 h-4" />
                        Create New Quote
                      </button>
                    </div>
                  </div>

                  {selectedProposal ? (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                      {/* Editor Panel */}
                      <div className="lg:col-span-2 space-y-6">
                        <div className="bg-white border border-[#EAECF0] rounded-3xl overflow-hidden shadow-sm">
                          <div className="p-6 border-b border-[#EAECF0] flex items-center justify-between bg-[#F9FAFB]">
                            <div className="flex items-center gap-4">
                              <button onClick={() => setSelectedProposal(null)} className="p-2 hover:bg-[#F2F4F7] rounded-lg">
                                <Archive className="w-5 h-5 text-[#667085]" />
                              </button>
                              <div>
                                <h4 className="font-bold text-[#101828]">{selectedProposal.title}</h4>
                                <p className="text-xs text-[#667085]">Drafting for {selectedProposal.client_name}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button 
                                onClick={() => handleGenerateAIProposal(selectedProposal)}
                                disabled={isGeneratingProposal}
                                className="flex items-center gap-2 px-4 py-2 bg-[#F9F5FF] text-[#7F56D9] border border-[#E9D7FE] rounded-xl text-xs font-bold hover:bg-[#F4EBFF] transition-all disabled:opacity-50"
                              >
                                <Sparkles className={`w-3.5 h-3.5 ${isGeneratingProposal ? 'animate-pulse' : ''}`} />
                                {isGeneratingProposal ? 'AI Drafting...' : 'Regenerate Draft'}
                              </button>
                              <button 
                                onClick={() => {
                                  handleUpdateProposal(selectedProposal.id, { status: 'review' });
                                  toast.success('Sent to Boss for approval');
                                }}
                                className="flex items-center gap-2 px-4 py-2 bg-[#7F56D9] text-white rounded-xl text-xs font-bold hover:bg-[#6941C6] transition-all"
                              >
                                <CheckCircle className="w-3.5 h-3.5" />
                                Send for Approval
                              </button>
                            </div>
                          </div>

                          <div className="p-8 space-y-10">
                            {selectedProposal.sections.length === 0 ? (
                              <div className="py-20 text-center space-y-4">
                                <div className="w-16 h-16 bg-[#F9F5FF] rounded-2xl flex items-center justify-center mx-auto text-[#7F56D9]">
                                  <Sparkles className="w-8 h-8" />
                                </div>
                                <h5 className="font-bold text-[#101828]">Ready to generate your first draft?</h5>
                                <p className="text-sm text-[#667085]">I'll synthesize tender requirements, past projects, and company tone guides.</p>
                                <button 
                                  onClick={() => handleGenerateAIProposal(selectedProposal)}
                                  className="px-6 py-2.5 bg-[#7F56D9] text-white rounded-xl text-sm font-bold shadow-sm hover:bg-[#6941C6]"
                                >
                                  Generate AI Draft
                                </button>
                              </div>
                            ) : (
                              selectedProposal.sections.map((section, idx) => (
                                <motion.div key={section.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.1 }}>
                                  <div className="flex items-start justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                      <h5 className="text-sm font-black text-[#101828] uppercase tracking-wider">{section.title}</h5>
                                      {section.ai_suggested && <span className="px-2 py-0.5 bg-[#F9F5FF] text-[#7F56D9] text-[9px] font-black rounded uppercase tracking-tighter">AI Suggestion</span>}
                                      {section.confidence && section.confidence < 0.7 && (
                                        <div className="flex items-center gap-1 px-2 py-0.5 bg-[#FFF4ED] text-[#C4320A] text-[9px] font-black rounded uppercase">
                                          <AlertCircle className="w-2.5 h-2.5" /> Low Confidence
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-all">
                                      <button 
                                        onClick={async () => {
                                          const inst = prompt('How should I improve this section? (e.g. "Make it more professional", "Add more detail about our BIM services")');
                                          if (inst) {
                                            const improveToast = toast.loading('Improving section...');
                                            try {
                                              const improved = await improveProposalSection(section.content_html, inst);
                                              const newSections = [...selectedProposal.sections];
                                              newSections[idx].content_html = improved || section.content_html;
                                              handleUpdateProposal(selectedProposal.id, { sections: newSections });
                                              toast.success('Section updated with AI.', { id: improveToast });
                                            } catch (error) {
                                              showAIErrorToast({ title: 'Section rewrite failed.', error, id: improveToast });
                                            }
                                          }
                                        }}
                                        className="p-1 px-2 text-[10px] font-bold text-[#7F56D9] hover:bg-[#F9F5FF] rounded"
                                      >
                                        Rewrite with AI
                                      </button>
                                      <button 
                                        onClick={() => {
                                          const newSections = [...selectedProposal.sections];
                                          newSections[idx].approved = !newSections[idx].approved;
                                          handleUpdateProposal(selectedProposal.id, { sections: newSections });
                                        }}
                                        className={`p-1 px-2 text-[10px] font-bold rounded ${section.approved ? 'bg-[#ECFDF3] text-[#027A48]' : 'text-[#667085] hover:bg-[#F9FAFB]'}`}
                                      >
                                        {section.approved ? 'Approved' : 'Approve'}
                                      </button>
                                    </div>
                                  </div>
                                  <textarea 
                                    value={section.content_html || ''}
                                    onChange={(e) => {
                                      const newSections = [...selectedProposal.sections];
                                      newSections[idx].content_html = e.target.value;
                                      handleUpdateProposal(selectedProposal.id, { sections: newSections });
                                    }}
                                    className={`w-full p-6 text-sm text-[#344054] leading-relaxed bg-[#F9FAFB] border rounded-2xl outline-none focus:ring-2 focus:ring-[#7F56D9]/10 transition-all min-h-[120px] ${section.approved ? 'border-[#12B76A]/30' : 'border-[#EAECF0]'}`}
                                  />
                                </motion.div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Pricing & Info Sidebar */}
                      <div className="space-y-6">
                        <div className="bg-white border border-[#EAECF0] rounded-3xl p-6 shadow-sm">
                          <h4 className="text-sm font-black text-[#101828] uppercase tracking-widest mb-6">Commercial Terms</h4>
                          <div className="space-y-4">
                            {selectedProposal.pricing.items.map((item, idx) => (
                              <div key={item.id} className="p-4 bg-[#F9FAFB] rounded-xl border border-[#EAECF0]">
                                <input 
                                  type="text" 
                                  value={item.description || ''}
                                  onChange={(e) => {
                                    const newItems = [...selectedProposal.pricing.items];
                                    newItems[idx].description = e.target.value;
                                    handleUpdateProposal(selectedProposal.id, { pricing: { ...selectedProposal.pricing, items: newItems } });
                                  }}
                                  className="w-full bg-transparent text-xs font-bold text-[#101828] mb-2 outline-none"
                                />
                                <div className="flex items-center justify-between text-xs">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[#667085]">Qty:</span>
                                    <input 
                                      type="number" 
                                      value={item.qty || 0}
                                      onChange={(e) => {
                                        const val = Number(e.target.value);
                                        const newItems = [...selectedProposal.pricing.items];
                                        newItems[idx].qty = val;
                                        newItems[idx].total = val * newItems[idx].unit_price;
                                        const sub = newItems.reduce((acc, it) => acc + it.total, 0);
                                        handleUpdateProposal(selectedProposal.id, { pricing: { ...selectedProposal.pricing, items: newItems, subtotal: sub, total: sub } });
                                      }}
                                      className="w-12 bg-white border border-[#D0D5DD] px-1 rounded"
                                    />
                                  </div>
                                  <div className="text-[#101828] font-bold">
                                    HKD {item.total.toLocaleString()}
                                  </div>
                                </div>
                              </div>
                            ))}
                            <button 
                              onClick={() => {
                                const newItem = { id: `item-${Date.now()}`, description: 'Extra Service', qty: 1, unit_price: 1500, total: 1500 };
                                const newItems = [...selectedProposal.pricing.items, newItem];
                                const sub = newItems.reduce((acc, it) => acc + it.total, 0);
                                handleUpdateProposal(selectedProposal.id, { pricing: { ...selectedProposal.pricing, items: newItems, subtotal: sub, total: sub } });
                              }}
                              className="w-full py-2 border border-dashed border-[#D0D5DD] rounded-xl text-[10px] font-black text-[#667085] hover:bg-[#F9FAFB] transition-all"
                            >
                              + Add Line Item
                            </button>
                            <div className="pt-4 border-t border-[#EAECF0] space-y-2">
                              <div className="flex items-center justify-between text-xs text-[#667085]">
                                <span>Subtotal</span>
                                <span className="font-bold text-[#101828]">HKD {selectedProposal.pricing.subtotal.toLocaleString()}</span>
                              </div>
                              <div className="flex items-center justify-between text-base font-black text-[#101828] pt-2">
                                <span>Total Value</span>
                                <span>HKD {selectedProposal.pricing.total.toLocaleString()}</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Status Panel */}
                        <div className="bg-[#101828] rounded-3xl p-6 text-white">
                          <h4 className="text-[10px] font-black text-[#667085] uppercase tracking-widest mb-4">Document Status</h4>
                          <div className="flex items-center gap-3 mb-6">
                            <div className={`w-3 h-3 rounded-full ${
                              selectedProposal.status === 'draft' ? 'bg-[#FDB022]' :
                              selectedProposal.status === 'review' ? 'bg-[#7F56D9]' :
                              selectedProposal.status === 'sent' ? 'bg-[#2E90FA]' :
                              selectedProposal.status === 'accepted' ? 'bg-[#12B76A]' :
                              'bg-[#F04438]'
                            }`} />
                            <span className="text-sm font-bold uppercase tracking-wider">{selectedProposal.status}</span>
                          </div>
                          {selectedProposal.status === 'review' && isAdmin && (
                             <div className="space-y-2">
                               <button 
                                 onClick={() => {
                                   handleUpdateProposal(selectedProposal.id, { status: 'sent', sent_at: new Date().toISOString() });
                                   logAuditEvent('APPROVE_PROPOSAL', 'PROPOSALS', selectedProposal.id, { total: selectedProposal.pricing.total });
                                   toast.success('Proposal Approved & Sent to Client');
                                 }}
                                 className="w-full py-3 bg-[#12B76A] text-white rounded-xl text-xs font-bold hover:bg-[#0E9355] transition-all"
                               >
                                 Approve & Send
                               </button>
                               <button 
                                 onClick={() => {
                                   handleUpdateProposal(selectedProposal.id, { status: 'draft' });
                                   logAuditEvent('REJECT_PROPOSAL', 'PROPOSALS', selectedProposal.id);
                                 }}
                                 className="w-full py-3 bg-[#F04438] text-white rounded-xl text-xs font-bold hover:bg-[#D93036] transition-all"
                               >
                                 Reject
                               </button>
                             </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white border border-[#EAECF0] rounded-3xl overflow-hidden shadow-sm">
                      <table className="w-full text-left">
                        <thead className="text-[10px] font-black text-[#667085] uppercase tracking-widest bg-[#F9FAFB] border-b border-[#EAECF0]">
                          <tr>
                            <th className="px-8 py-5">Document Title & Version</th>
                            <th className="px-6 py-5">Client</th>
                            <th className="px-6 py-5">Value</th>
                            <th className="px-6 py-5">Status</th>
                            <th className="px-6 py-5">Last Modified</th>
                            <th className="px-8 py-5 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#EAECF0]">
                          {proposals
                            .filter(p => isAdmin || p.uid === auth.currentUser?.uid)
                            .filter(p => p.title.toLowerCase().includes(proposalSearchTerm.toLowerCase())).map((proposal) => (
                            <tr 
                              key={proposal.id} 
                              onClick={() => setSelectedProposal(proposal)}
                              className="hover:bg-[#F9FAFB] transition-all cursor-pointer group"
                            >
                              <td className="px-8 py-6">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 bg-[#F9F5FF] rounded-xl flex items-center justify-center text-[#7F56D9]">
                                    <FileText className="w-5 h-5" />
                                  </div>
                                  <div className="space-y-0.5">
                                    <p className="text-sm font-bold text-[#101828] group-hover:text-[#7F56D9] transition-colors">{proposal.title}</p>
                                    <p className="text-[10px] font-black text-[#667085] uppercase tracking-tighter">v{proposal.version_history.length}.0 • Generated by {proposal.createdBy.split('@')[0]}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-6 text-sm font-bold text-[#344054]">{proposal.client_name}</td>
                              <td className="px-6 py-6 text-sm font-bold text-[#101828]">HKD {proposal.pricing.total.toLocaleString()}</td>
                              <td className="px-6 py-6">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                  proposal.status === 'draft' ? 'bg-[#FFFAEB] text-[#B54708]' :
                                  proposal.status === 'review' ? 'bg-[#F9F5FF] text-[#7F56D9]' :
                                  proposal.status === 'sent' ? 'bg-[#EFF8FF] text-[#175CD3]' :
                                  proposal.status === 'accepted' ? 'bg-[#ECFDF3] text-[#027A48]' :
                                  'bg-[#FEF3F2] text-[#B42318]'
                                }`}>
                                  {proposal.status}
                                </span>
                              </td>
                              <td className="px-6 py-6 text-xs text-[#667085]">{new Date(proposal.updatedAt).toLocaleDateString()}</td>
                              <td className="px-8 py-6 text-right">
                                <ChevronRight className="w-5 h-5 text-[#98A2B3] group-hover:text-[#7F56D9] group-hover:translate-x-1 transition-all ml-auto" />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {proposals.length === 0 && (
                        <div className="p-16 text-center">
                          <div className="w-16 h-16 bg-[#F9FAFB] rounded-2xl flex items-center justify-center mx-auto mb-4 text-[#98A2B3]">
                            <Plus className="w-8 h-8" />
                          </div>
                          <h4 className="text-lg font-bold text-[#101828] mb-2">No documents generated yet</h4>
                          <p className="text-sm text-[#667085] max-w-xs mx-auto">Build your first quote or proposal from an opportunity or tender.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : activeTab === 'CONNECTIONS' ? (
              <div className="flex-1 p-8 overflow-y-auto bg-[#F9FAFB]">
                <div className="max-w-6xl mx-auto space-y-8">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xl font-bold text-[#101828]">Connections</h3>
                      <p className="text-sm text-[#475467]">
                        {isEmailConnectionsLoaded
                          ? `Currently ${emailConnections.length} active email accounts configured for synchronization.`
                          : 'Loading configured email accounts...'}
                      </p>
                    </div>
                    <button 
                      onClick={() => {
                        setSettingsTab('CONNECTIONS');
                        setShowSettings(true);
                      }}
                      className="flex items-center gap-2 px-4 py-2.5 bg-[#F9F5FF] text-[#7F56D9] rounded-lg text-sm font-semibold border border-[#E9D7FE] hover:bg-[#F4EBFF] transition-all"
                    >
                      <Settings className="w-4 h-4" />
                      Manage Connections
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {!isEmailConnectionsLoaded ? (
                      <div className="col-span-full p-12 bg-white border border-[#EAECF0] rounded-2xl flex flex-col items-center justify-center text-center">
                        <RefreshCw className="w-6 h-6 text-[#7F56D9] animate-spin mb-4" />
                        <h4 className="text-sm font-bold text-[#101828] mb-1">Loading Email Connections</h4>
                        <p className="text-xs text-[#667085] max-w-xs">Fetching your saved connection settings from Firestore...</p>
                      </div>
                    ) : emailConnections.length === 0 ? (
                      <div className="col-span-full p-12 bg-white border border-dashed border-[#EAECF0] rounded-2xl flex flex-col items-center justify-center text-center">
                        <div className="w-12 h-12 bg-[#F9FAFB] rounded-full flex items-center justify-center mb-4">
                          <Mail className="w-6 h-6 text-[#98A2B3]" />
                        </div>
                        <h4 className="text-sm font-bold text-[#101828] mb-1">No Email Accounts Connected</h4>
                        <p className="text-xs text-[#667085] max-w-xs mb-6">Connect your work email via IMAP to start automatically classifying incoming business opportunities.</p>
                        <button 
                          onClick={() => {
                            setSettingsTab('CONNECTIONS');
                            setShowSettings(true);
                          }}
                          className="px-4 py-2 bg-[#7F56D9] text-white rounded-lg text-sm font-semibold hover:bg-[#6941C6] transition-all"
                        >
                          Connect Your First Account
                        </button>
                      </div>
                    ) : (
                      emailConnections.map((conn, i) => (
                        <div key={i} className="bg-white border border-[#EAECF0] rounded-2xl shadow-sm overflow-hidden hover:border-[#7F56D9] transition-all group">
                          <div className="p-6">
                            <div className="flex items-start justify-between mb-4">
                              <div className="w-12 h-12 bg-[#F9F5FF] rounded-xl flex items-center justify-center text-[#7F56D9]">
                                <Server className="w-6 h-6" />
                              </div>
                              <span className="flex items-center gap-1 px-2 py-0.5 bg-[#ECFDF3] text-[#027A48] text-[10px] font-bold rounded-full border border-[#ABEFC6]">
                                <div className="w-1 h-1 bg-[#12B76A] rounded-full" />
                                Active
                              </span>
                            </div>
                            <h4 className="font-bold text-[#101828] mb-1">{conn.name || 'Email Account'}</h4>
                            <p className="text-xs text-[#667085] truncate mb-4">{conn.user}</p>
                            
                            <div className="space-y-3 pt-4 border-t border-[#F2F4F7]">
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-[#667085]">Host:</span>
                                <span className="font-medium text-[#344054]">{conn.host}</span>
                              </div>
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-[#667085]">Port:</span>
                                <span className="font-medium text-[#344054]">{conn.port || 993}</span>
                              </div>
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-[#667085]">Security:</span>
                                <span className="font-medium text-[#344054]">{conn.secure !== false ? 'SSL/TLS' : 'None'}</span>
                              </div>
                            </div>
                          </div>
                          <div className="px-6 py-4 bg-[#F9FAFB] border-t border-[#EAECF0] flex items-center justify-between">
                            <button 
                              onClick={() => handleSync([conn])}
                              disabled={isSyncing}
                              className="text-xs font-bold text-[#7F56D9] hover:text-[#6941C6] flex items-center gap-1.5"
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                              Sync Account
                            </button>
                            <button 
                              onClick={() => {
                                setSettingsTab('CONNECTIONS');
                                setShowSettings(true);
                              }}
                              className="text-xs font-medium text-[#667085] hover:text-[#101828]"
                            >
                              Settings
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {emailConnections.length > 0 && (
                    <div className="bg-white border border-[#EAECF0] rounded-2xl p-6 shadow-sm">
                      <h4 className="text-sm font-bold text-[#101828] mb-4 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-[#F79009]" />
                        Connection Health
                      </h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead className="text-[10px] font-bold text-[#667085] uppercase tracking-wider bg-[#F9FAFB]">
                            <tr>
                              <th className="px-4 py-3 border-b border-[#EAECF0]">Account Name</th>
                              <th className="px-4 py-3 border-b border-[#EAECF0]">Provider</th>
                              <th className="px-4 py-3 border-b border-[#EAECF0]">Last Checked</th>
                              <th className="px-4 py-3 border-b border-[#EAECF0]">Status</th>
                              <th className="px-4 py-3 border-b border-[#EAECF0] text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="text-xs text-[#344054] divide-y divide-[#EAECF0]">
                            {emailConnections.map((conn, i) => (
                              <tr key={i} className="hover:bg-[#F9FAFB] transition-colors">
                                <td className="px-4 py-3 font-medium">{conn.name}</td>
                                <td className="px-4 py-3 text-[#667085] font-mono">
                                  {conn.host.includes('gmail') ? 'Google' : conn.host.includes('outlook') ? 'Microsoft' : 'Custom IMAP'}
                                </td>
                                <td className="px-4 py-3 text-[#667085]">Just now</td>
                                <td className="px-4 py-3">
                                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#ECFDF3] text-[#027A48] font-medium border border-[#ABEFC6]">
                                    <div className="w-1 h-1 bg-[#12B76A] rounded-full" />
                                    Operational
                                  </span>
                                </td>
                                <td className="px-4 py-4 text-right">
                                  <button 
                                    onClick={() => handleSync([conn])}
                                    className="px-3 py-1.5 bg-[#F9F5FF] text-[#7F56D9] border border-[#E9D7FE] rounded-lg font-bold hover:bg-[#F4EBFF] transition-all"
                                  >
                                    Test
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : activeTab === 'AI' ? (
              <AiAssistantWorkspace 
                userContext={userContext}
                onSendMessage={handleAiMessage}
                alerts={aiAlerts}
                memory={aiMemory}
              />
            ) : activeTab === 'TEAM' && isAdmin ? (
              <div className="flex-1 p-8 overflow-y-auto bg-[#F9FAFB]">
                <div className="max-w-7xl mx-auto space-y-8">
                  {/* Team Header & Invite Form */}
                  <div className="bg-white border border-[#EAECF0] rounded-3xl p-8 shadow-sm">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
                      <div className="max-w-md">
                        <h3 className="text-xl font-bold text-[#101828] mb-2">Invite Team Members</h3>
                        <p className="text-sm text-[#475467]">
                          Grow your BOS operation by adding new agents or administrators. 
                          Invited users will inherit pre-assigned roles upon their first login.
                        </p>
                      </div>
                      <form onSubmit={handleInviteUser} className="flex-1 max-w-2xl flex items-end gap-3">
                        <div className="flex-1 space-y-1.5">
                          <label className="text-xs font-bold text-[#344054] ml-1 uppercase tracking-tight text-left block">Email Address</label>
                          <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#98A2B3]" />
                            <input 
                              type="email"
                              required
                              placeholder="colleague@isbim.com"
                              value={inviteEmail || ''}
                              onChange={(e) => setInviteEmail(e.target.value)}
                              className="w-full pl-10 pr-4 py-2 bg-[#F9FAFB] border border-[#D0D5DD] rounded-xl text-sm focus:ring-4 focus:ring-[#F4EBFF] focus:border-[#7F56D9] outline-none transition-all"
                            />
                          </div>
                        </div>
                        <div className="w-40 space-y-1.5">
                          <label className="text-xs font-bold text-[#344054] ml-1 uppercase tracking-tight text-left block">Role</label>
                          <select 
                            value={inviteRole || 'sales'}
                            onChange={(e) => setInviteRole(e.target.value as UserRole)}
                            className="w-full px-3 py-2 bg-[#F9FAFB] border border-[#D0D5DD] rounded-xl text-sm focus:ring-4 focus:ring-[#F4EBFF] focus:border-[#7F56D9] outline-none transition-all"
                          >
                            <option value="sales">Sales Agent</option>
                            <option value="boss">Boss (Super Admin)</option>
                          </select>
                        </div>
                        <button 
                          type="submit"
                          disabled={isInviting}
                          className="px-6 py-2 bg-[#7F56D9] text-white rounded-xl text-sm font-bold shadow-sm hover:bg-[#6941C6] transition-all disabled:opacity-50 flex items-center gap-2 h-[42px]"
                        >
                          {isInviting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                          Send Invite
                        </button>
                      </form>
                    </div>
                  </div>

                  {/* Active Members Table */}
                  <div className="bg-white border border-[#EAECF0] rounded-3xl overflow-hidden shadow-sm">
                    <div className="px-8 py-5 border-b border-[#EAECF0] bg-[#F9FAFB] flex items-center justify-between">
                      <h4 className="text-sm font-black text-[#101828] uppercase tracking-widest">Active Team Members</h4>
                      <span className="px-2 py-1 bg-[#F2F4F7] text-[#475467] text-[10px] font-bold rounded-lg">{allUsers.length} Members</span>
                    </div>
                    <table className="w-full text-left">
                      <thead className="text-[10px] font-bold text-[#667085] uppercase tracking-wider bg-[#F9FAFB]/50 border-b border-[#EAECF0]">
                        <tr>
                          <th className="px-8 py-4">User</th>
                          <th className="px-6 py-4">Role</th>
                          <th className="px-6 py-4">Status</th>
                          <th className="px-6 py-4">Joined At</th>
                          <th className="px-8 py-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EAECF0]">
                        {allUsers.map((user) => (
                          <tr key={user.uid} className="hover:bg-[#F9FAFB] transition-colors">
                            <td className="px-8 py-5">
                              <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm ${user.role === 'boss' ? 'bg-[#F9F5FF] text-[#7F56D9]' : 'bg-[#EFF8FF] text-[#175CD3]'}`}>
                                  {user.displayName.charAt(0)}
                                </div>
                                <div>
                                  <p className="text-sm font-bold text-[#101828]">{user.displayName}</p>
                                  <p className="text-xs text-[#667085]">{user.email}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-5">
                              <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-tighter ${user.role === 'boss' ? 'bg-[#F9F5FF] text-[#7F56D9] border border-[#E9D7FE]' : 'bg-[#F2F4F7] text-[#475467]'}`}>
                                {user.role}
                              </span>
                            </td>
                            <td className="px-6 py-5">
                              <div className="flex items-center gap-1.5">
                                <div className="w-1.5 h-1.5 rounded-full bg-[#12B76A]" />
                                <span className="text-xs font-medium text-[#344054]">Active</span>
                              </div>
                            </td>
                            <td className="px-6 py-5 text-xs text-[#667085]">{new Date(user.createdAt).toLocaleDateString()}</td>
                            <td className="px-8 py-5 text-right">
                              <button className="text-xs font-bold text-[#667085] hover:text-[#D04438] transition-colors">Deactivate</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pending Invitations */}
                  <div className="bg-white border border-[#EAECF0] rounded-3xl overflow-hidden shadow-sm">
                    <div className="px-8 py-5 border-b border-[#EAECF0] bg-[#F9FAFB] flex items-center justify-between">
                      <h4 className="text-sm font-black text-[#101828] uppercase tracking-widest">Pending Invitations</h4>
                      <span className="px-2 py-1 bg-[#F9F5FF] text-[#7F56D9] text-[10px] font-bold rounded-lg">{invitations.filter(i => i.status === 'pending').length} Pending</span>
                    </div>
                    <table className="w-full text-left">
                      <thead className="text-[10px] font-bold text-[#667085] uppercase tracking-wider bg-[#F9FAFB]/50 border-b border-[#EAECF0]">
                        <tr>
                          <th className="px-8 py-4">Recipient</th>
                          <th className="px-6 py-4">Target Role</th>
                          <th className="px-6 py-4">Invited By</th>
                          <th className="px-6 py-4">Sent At</th>
                          <th className="px-8 py-4 text-right">Share Link</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EAECF0]">
                        {invitations.filter(i => i.status === 'pending').map((invite) => (
                          <tr key={invite.id} className="hover:bg-[#F9FAFB] transition-colors">
                            <td className="px-8 py-5">
                              <p className="text-sm font-bold text-[#101828]">{invite.email}</p>
                            </td>
                            <td className="px-6 py-5">
                               <span className="px-2 py-1 bg-[#F2F4F7] text-[#475467] text-[10px] font-black uppercase tracking-tighter rounded-lg">
                                 {invite.role}
                               </span>
                            </td>
                            <td className="px-6 py-5 text-xs text-[#667085]">{invite.invitedBy}</td>
                            <td className="px-6 py-5 text-xs text-[#667085]">{new Date(invite.createdAt).toLocaleDateString()}</td>
                            <td className="px-8 py-5 text-right">
                              <button 
                                onClick={() => {
                                  const url = `${window.location.origin}/join?token=${invite.token}`;
                                  navigator.clipboard.writeText(url);
                                  toast.success('Invitation link copied to clipboard');
                                }}
                                className="text-xs font-bold text-[#7F56D9] hover:underline"
                              >
                                Copy Link
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {invitations.filter(i => i.status === 'pending').length === 0 && (
                      <div className="p-12 text-center">
                        <p className="text-sm text-[#667085]">No pending invitations at this time.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : activeTab === 'MEETINGS' ? (
              <div className="flex-1 p-8 overflow-y-auto bg-[#F9FAFB]">
                <div className="max-w-7xl mx-auto space-y-8">
                  <div className="flex items-center justify-between">
                    <div className="flex gap-4">
                      <button 
                        onClick={() => setActiveMeetingSubTab('INTELLIGENCE')}
                        className={`px-4 py-2 text-xs font-bold rounded-lg transition-all border ${
                          activeMeetingSubTab === 'INTELLIGENCE' 
                            ? 'bg-[#7F56D9] text-white border-[#7F56D9] shadow-sm' 
                            : 'bg-white text-[#475467] border-[#EAECF0] hover:bg-[#F9FAFB]'
                        }`}
                      >
                        Intelligence Hub
                      </button>
                      <button 
                        onClick={() => setActiveMeetingSubTab('CALENDAR')}
                        className={`px-4 py-2 text-xs font-bold rounded-lg transition-all border ${
                          activeMeetingSubTab === 'CALENDAR' 
                            ? 'bg-[#7F56D9] text-white border-[#7F56D9] shadow-sm' 
                            : 'bg-white text-[#475467] border-[#EAECF0] hover:bg-[#F9FAFB]'
                        }`}
                      >
                        Calendar View
                      </button>
                      <button 
                        onClick={() => setActiveMeetingSubTab('LIST')}
                        className={`px-4 py-2 text-xs font-bold rounded-lg transition-all border ${
                          activeMeetingSubTab === 'LIST' 
                            ? 'bg-[#7F56D9] text-white border-[#7F56D9] shadow-sm' 
                            : 'bg-white text-[#475467] border-[#EAECF0] hover:bg-[#F9FAFB]'
                        }`}
                      >
                        Meeting List
                      </button>
                    </div>
                    <button 
                      onClick={() => {
                        const title = prompt('Meeting Title:');
                        if (!title) return;
                        const date = prompt('Meeting Date (YYYY-MM-DD):', new Date().toISOString().split('T')[0]);
                        if (!date) return;
                        handleCreateMeeting({ title, date });
                      }}
                      className="flex items-center gap-2 px-4 py-2 border border-[#EAECF0] text-[#344054] rounded-lg text-sm font-semibold hover:bg-[#F9FAFB] transition-all bg-white shadow-sm"
                    >
                      <Calendar className="w-4 h-4" />
                      Add to Calendar
                    </button>
                    <button 
                      onClick={() => {
                        const title = prompt('Task Title:');
                        if (!title) return;
                        const dueDate = prompt('Due Date (YYYY-MM-DD):', new Date().toISOString().split('T')[0]);
                        if (!dueDate) return;
                        addDoc(collection(db, 'tasks'), {
                          uid: auth.currentUser?.uid || 'anonymous',
                          title,
                          due_date: dueDate,
                          status: 'todo',
                          priority: { score: 3, reason: 'Manual entry' },
                          source: { module: 'manual' },
                          owner_id: auth.currentUser?.uid || 'anonymous',
                          collaborators: [],
                          dependencies: [],
                          alerts: [],
                          createdAt: new Date().toISOString(),
                          updatedAt: new Date().toISOString()
                        });
                        toast.success('Task added successfully');
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-[#7F56D9] text-white rounded-lg text-sm font-semibold hover:bg-[#6941C6] transition-all shadow-sm"
                    >
                      <Plus className="w-4 h-4" />
                      Quick Task
                    </button>
                  </div>

                  {activeMeetingSubTab === 'CALENDAR' ? (
                    <div className="bg-white border border-[#EAECF0] rounded-3xl p-8 shadow-sm h-[700px] flex flex-col">
                      <div className="flex items-center justify-between mb-8">
                         <h3 className="text-xl font-bold text-[#101828]">Meeting Schedule</h3>
                         <div className="flex gap-2">
                            <button className="p-2 border border-[#EAECF0] rounded-lg hover:bg-[#F9FAFB]"><ChevronLeft className="w-4 h-4" /></button>
                            <span className="px-4 py-2 text-sm font-bold border border-[#EAECF0] rounded-lg">April 2026</span>
                            <button className="p-2 border border-[#EAECF0] rounded-lg hover:bg-[#F9FAFB]"><ChevronRight className="w-4 h-4" /></button>
                         </div>
                      </div>
                      <div className="grid grid-cols-7 gap-px bg-[#EAECF0] border border-[#EAECF0] rounded-xl overflow-hidden flex-1">
                         {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                           <div key={day} className="bg-[#F9FAFB] p-2 text-center text-[10px] font-bold text-[#667085] uppercase tracking-widest">{day}</div>
                         ))}
                         {Array.from({ length: 30 }).map((_, i) => {
                           const day = i + 1;
                           const dayMeetings = meetings.filter(m => new Date(m.date).getDate() === day);
                           
                           return (
                             <div key={i} className="bg-white p-2 min-h-[100px] relative group hover:bg-[#F9F5FF] transition-all overflow-y-auto">
                                <span className="text-[10px] font-bold text-[#98A2B3]">{day}</span>
                                <div className="mt-1 space-y-1">
                                  {dayMeetings.map(m => (
                                    <div 
                                      key={m.id}
                                      onClick={() => { setSelectedMeeting(m); setActiveMeetingSubTab('INTELLIGENCE'); }}
                                      className="p-1.5 bg-[#F9F5FF] border border-[#E9D7FE] rounded text-[9px] font-bold text-[#6941C6] cursor-pointer hover:bg-[#F4EBFF] truncate group/item relative"
                                    >
                                      {m.title}
                                      <div className="hidden group-hover/item:flex absolute right-0 top-0 h-full bg-[#E9D7FE] px-1 items-center gap-1 shadow-sm rounded-r">
                                        <button 
                                          onClick={(e) => { 
                                            e.stopPropagation(); 
                                            const newTitle = prompt('New Meeting Title:', m.title);
                                            if (newTitle) handleUpdateMeeting(m.id, { title: newTitle });
                                          }} 
                                          className="text-[#667085] hover:text-[#7F56D9]"
                                        >
                                          <Edit2 className="w-3 h-3" />
                                        </button>
                                        <button 
                                          onClick={(e) => { 
                                            e.stopPropagation(); 
                                            handleDeleteMeeting(m.id); 
                                          }} 
                                          className="text-red-600 hover:text-red-700"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                             </div>
                           );
                         })}
                      </div>
                    </div>
                  ) : activeMeetingSubTab === 'LIST' ? (
                    <div className="bg-white border border-[#EAECF0] rounded-3xl overflow-hidden shadow-sm">
                      <div className="px-8 py-5 border-b border-[#EAECF0] bg-[#F9FAFB] flex items-center justify-between">
                         <h4 className="text-sm font-black text-[#101828] uppercase tracking-widest">Meeting Archives</h4>
                         <span className="px-2 py-1 bg-[#F9F5FF] text-[#7F56D9] text-[10px] font-bold rounded-lg">{meetings.length} Total</span>
                      </div>
                      <table className="w-full text-left">
                         <thead className="text-[10px] font-bold text-[#667085] uppercase tracking-wider bg-[#F9FAFB]/50 border-b border-[#EAECF0]">
                            <tr>
                               <th className="px-8 py-4">Meeting Intelligence</th>
                               <th className="px-6 py-4">Sentiment</th>
                               <th className="px-6 py-4">Date</th>
                               <th className="px-6 py-4 text-center">Actions</th>
                               <th className="px-8 py-4 text-right">Owner</th>
                            </tr>
                         </thead>
                         <tbody className="divide-y divide-[#EAECF0]">
                            {meetings.map((m) => (
                              <tr key={m.id} className="hover:bg-[#F9FAFB] transition-colors group">
                                <td className="px-8 py-5">
                                   <button 
                                     onClick={() => { setSelectedMeeting(m); setActiveMeetingSubTab('INTELLIGENCE'); }}
                                     className="text-left group/item"
                                   >
                                     <p className="text-sm font-bold text-[#101828] group-hover/item:text-[#7F56D9] transition-colors">{m.title}</p>
                                     <p className="text-[10px] text-[#667085] line-clamp-1 max-w-xs">{m.summary}</p>
                                   </button>
                                </td>
                                <td className="px-6 py-5">
                                   <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${
                                     m.sentimentSummary.toLowerCase().includes('productive') ? 'bg-[#ECFDF3] text-[#027A48]' : 'bg-[#F9FAFB] text-[#667085]'
                                   }`}>
                                     {m.sentimentSummary}
                                   </span>
                                </td>
                                <td className="px-6 py-5 text-xs text-[#667085] font-medium">{new Date(m.date).toLocaleDateString()}</td>
                                <td className="px-6 py-5 text-center">
                                   <span className="px-2 py-1 bg-[#F9F5FF] text-[#7F56D9] text-[10px] font-bold rounded-lg">{m.actions.length} Tasks</span>
                                </td>
                                <td className="px-8 py-5 text-right">
                                   <div className="flex items-center justify-end gap-2">
                                      <button 
                                        onClick={() => {
                                          const newTitle = prompt('New Title:', m.title);
                                          if (newTitle) handleUpdateMeeting(m.id, { title: newTitle });
                                        }}
                                        className="p-1.5 text-[#667085] hover:text-[#7F56D9] transition-all bg-white border border-[#EAECF0] rounded-lg shadow-sm"
                                        title="Edit Title"
                                      >
                                         <Edit2 className="w-3.5 h-3.5" />
                                      </button>
                                      <button 
                                        onClick={() => handleDeleteMeeting(m.id)}
                                        className="p-1.5 text-[#667085] hover:text-red-600 transition-all bg-white border border-[#EAECF0] rounded-lg shadow-sm opacity-0 group-hover:opacity-100"
                                        title="Delete Meeting"
                                      >
                                         <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                   </div>
                                </td>
                              </tr>
                            ))}
                         </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                      {/* Left Sidebar: Meeting List & Add */}
                      <div className="lg:col-span-4 space-y-6">
                        {activeMeetingSubTab === 'INTELLIGENCE' && (
                          <>
                            <div className="bg-white p-6 rounded-2xl border border-[#EAECF0] shadow-sm">
                              <div className="flex items-center gap-2 mb-4">
                                <MessageSquare className="w-5 h-5 text-[#7F56D9]" />
                                <h3 className="text-lg font-bold text-[#101828]">Meeting Creation</h3>
                              </div>
                              <p className="text-xs text-[#667085] mb-4 leading-relaxed">
                                Analyze emails or documents to extract intelligence.
                              </p>
                              
                              <div className="flex flex-col gap-3">
                                 <button 
                                   onClick={() => setShowEmailSelectorForMeeting(!showEmailSelectorForMeeting)}
                                   className={`w-full px-4 py-3 border rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-sm ${
                                     showEmailSelectorForMeeting ? 'bg-[#F9F5FF] border-[#7F56D9] text-[#7F56D9]' : 'border-[#D0D5DD] text-[#344054] hover:bg-[#F9FAFB]'
                                   }`}
                                 >
                                    <Mail className="w-4 h-4" />
                                    Select From Email
                                 </button>

                                 <div className="relative">
                                    <div className="absolute inset-0 flex items-center" aria-hidden="true">
                                      <div className="w-full border-t border-gray-200"></div>
                                    </div>
                                    <div className="relative flex justify-center text-xs uppercase">
                                      <span className="bg-white px-2 text-gray-500 font-bold">Or Upload</span>
                                    </div>
                                 </div>

                                 <button 
                                   onClick={() => document.getElementById('meeting-file-upload')?.click()}
                                   className="w-full px-4 py-3 border border-[#D0D5DD] rounded-xl text-sm font-bold text-[#344054] hover:bg-[#F9FAFB] transition-all flex items-center justify-center gap-2 shadow-sm"
                                 >
                                    <Upload className="w-4 h-4" />
                                    Upload Meeting Document
                                 </button>
                              </div>
                                 <input 
                                   id="meeting-file-upload"
                                   type="file" 
                                   className="hidden" 
                                   accept=".pdf,.txt,.docx"
                                   onChange={async (e) => {
                                     const file = e.target.files?.[0];
                                     if (!file) return;
                                     const uploadToast = toast.loading('Reading document...');
                                     try {
                                       const reader = new FileReader();
                                       reader.onload = async (event) => {
                                         try {
                                           const base64 = event.target?.result as string;
                                           const base64Content = base64.split(',')[1];
                                           const extracted = await ocrDocument(base64Content, file.type, geminiConfig);
                                           setMeetingNotesInput(extracted);
                                           toast.success('Document read successfully!', { id: uploadToast });
                                         } catch (error) {
                                           showAIErrorToast({ title: 'Document OCR failed.', error, id: uploadToast });
                                         }
                                       };
                                       reader.readAsDataURL(file);
                                     } catch (err) {
                                       toast.error('Failed to read file.', { id: uploadToast });
                                     }
                                   }}
                                 />
                              </div>

                              {showEmailSelectorForMeeting && (
                                <div className="mb-4 p-4 bg-[#F9FAFB] border border-[#EAECF0] rounded-xl space-y-3">
                                  <div className="flex items-center justify-between">
                                    <h4 className="text-[10px] font-black text-[#475467] uppercase tracking-widest">Select Email to Convert</h4>
                                    <button onClick={() => setShowEmailSelectorForMeeting(false)} className="text-[#98A2B3] hover:text-[#667085]">
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                  <div className="max-h-48 overflow-y-auto space-y-2">
                                    {emails.length === 0 ? (
                                      <p className="text-[10px] text-[#98A2B3] text-center py-4">No emails available.</p>
                                    ) : (
                                      emails.filter(e => e.aiClassification === 'MEETING').slice(0, 5).map(email => (
                                        <button
                                          key={email.id}
                                          onClick={() => handleConvertEmailToMeeting(email)}
                                          className="w-full text-left p-2 hover:bg-white border border-transparent hover:border-[#EAECF0] rounded-lg transition-all group"
                                        >
                                          <p className="text-xs font-bold text-[#344054] truncate group-hover:text-[#7F56D9]">{email.subject}</p>
                                          <p className="text-[10px] text-[#667085] truncate">{email.from}</p>
                                        </button>
                                      ))
                                    )}
                                  </div>
                                  {emails.filter(e => e.aiClassification === 'MEETING').length === 0 && (
                                      <p className="text-[10px] text-[#667085] bg-[#FFF4ED] p-2 rounded-lg border border-[#FFF4ED]">
                                        No meetings classified yet. Please check the Inbox.
                                      </p>
                                  )}
                                </div>
                              )}

                              <textarea
                                value={meetingNotesInput || ''}
                                onChange={(e) => setMeetingNotesInput(e.target.value)}
                                placeholder="Paste meeting notes or transcript here..."
                                className="w-full h-48 px-4 py-3 bg-[#F9FAFB] border border-[#D0D5DD] rounded-xl text-sm focus:ring-2 focus:ring-[#F4EBFF] focus:border-[#7F56D9] outline-none transition-all resize-none mb-4"
                              />
                              <button
                                onClick={handleAnalyzeMeeting}
                                disabled={isAnalyzingMeeting || !meetingNotesInput.trim()}
                                className="w-full bg-[#7F56D9] text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-[#6941C6] transition-all disabled:opacity-50"
                              >
                                {isAnalyzingMeeting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                                {isAnalyzingMeeting ? 'Analyzing...' : 'Generate Intelligence'}
                              </button>
                            </>
                          )}

                        <div className="bg-white rounded-2xl border border-[#EAECF0] shadow-sm overflow-hidden text-left">
                          <div className="p-4 border-b border-[#EAECF0] bg-[#F9FAFB]">
                            <h3 className="text-sm font-bold text-[#101828]">Recent Meetings</h3>
                          </div>
                          <div className="max-h-[500px] overflow-y-auto">
                            {meetings.length === 0 ? (
                              <div className="p-8 text-center">
                                <Calendar className="w-8 h-8 text-[#D0D5DD] mx-auto mb-2" />
                                <p className="text-xs text-[#667085]">No meetings analyzed yet.</p>
                              </div>
                            ) : (
                              meetings.map((m) => (
                                <button
                                  key={m.id}
                                  onClick={() => setSelectedMeeting(m)}
                                  className={`w-full text-left p-4 hover:bg-[#F9FAFB] transition-all border-b border-[#EAECF0] group ${selectedMeeting?.id === m.id ? 'bg-[#F9F5FF]' : ''}`}
                                >
                                  <div className="flex items-center justify-between gap-3 mb-1">
                                    <h4 className={`text-sm font-bold truncate ${selectedMeeting?.id === m.id ? 'text-[#7F56D9]' : 'text-[#101828]'}`}>
                                      {m.title}
                                    </h4>
                                    <span className="text-[10px] text-[#98A2B3] flex-shrink-0">
                                      {new Date(m.date).toLocaleDateString()}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <div className="flex -space-x-1">
                                      {m.participants.slice(0, 3).map((p, i) => (
                                        <div key={i} className="w-5 h-5 rounded-full bg-[#F2F4F7] border-2 border-white flex items-center justify-center text-[8px] font-bold text-[#475467]">
                                          {p.charAt(0).toUpperCase()}
                                        </div>
                                      ))}
                                      {m.participants.length > 3 && (
                                        <div className="w-5 h-5 rounded-full bg-[#F2F4F7] border-2 border-white flex items-center justify-center text-[8px] font-bold text-[#475467]">
                                          +{m.participants.length - 3}
                                        </div>
                                      )}
                                    </div>
                                    <div className="h-1 flex-1 bg-[#F2F4F7] rounded-full overflow-hidden">
                                       <div className="h-full bg-[#12B76A] w-1/3 opacity-50" />
                                    </div>
                                  </div>
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right Panel: Meeting */}
                      <div className="lg:col-span-8">
                       <AnimatePresence mode="wait">
                          {selectedMeeting ? (
                            <motion.div
                              key={selectedMeeting.id}
                              initial={{ opacity: 0, y: 20 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -20 }}
                              className="space-y-6"
                            >
                              {/* Header Card */}
                              <div className="bg-white p-8 rounded-2xl border border-[#EAECF0] shadow-sm relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-4">
                                  <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                    selectedMeeting.sentimentSummary.toLowerCase().includes('productive') ? 'bg-[#ECFDF3] text-[#027A48]' : 'bg-[#F9F5FF] text-[#7F56D9]'
                                  }`}>
                                    {selectedMeeting.sentimentSummary}
                                  </div>
                                </div>
                                <h2 className="text-2xl font-bold text-[#101828] mb-2">{selectedMeeting.title}</h2>
                                <div className="flex items-center gap-4 text-sm text-[#667085] mb-6">
                                  <div className="flex items-center gap-2">
                                    <Clock className="w-4 h-4" />
                                    {new Date(selectedMeeting.date).toLocaleDateString()}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Users className="w-4 h-4" />
                                    {selectedMeeting.participants.length} Participants
                                  </div>
                                </div>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-6 border-t border-[#EAECF0]">
                                   <div>
                                      <h4 className="text-xs font-bold text-[#475467] uppercase tracking-widest mb-4">Decisions Made</h4>
                                      <div className="space-y-3">
                                        {selectedMeeting.decisions.map((d, i) => (
                                          <div key={i} className="flex gap-3 p-3 bg-[#F9FAFB] rounded-xl border border-[#EAECF0]">
                                            <CheckCircle className="w-4 h-4 text-[#12B76A] mt-0.5 shrink-0" />
                                            <div>
                                              <p className="text-sm font-bold text-[#101828]">{d.text}</p>
                                              <p className="text-xs text-[#667085] mt-1">{d.context}</p>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                   </div>
                                   <div>
                                      <h4 className="text-xs font-bold text-[#475467] uppercase tracking-widest mb-4">Open Questions</h4>
                                      <div className="space-y-2">
                                        {selectedMeeting.openQuestions.map((q, i) => (
                                          <div key={i} className="flex gap-2 items-center p-2 text-sm text-[#475467]">
                                            <HelpCircle className="w-4 h-4 text-[#7F56D9]" />
                                            {q}
                                          </div>
                                        ))}
                                      </div>
                                   </div>
                                </div>
                              </div>

                              {/* Action Items */}
                              <div className="bg-white rounded-2xl border border-[#EAECF0] shadow-sm overflow-hidden text-left">
                                <div className="p-6 border-b border-[#EAECF0] flex items-center justify-between">
                                  <h3 className="text-lg font-bold text-[#101828]">Action items</h3>
                                  <div className="flex gap-2">
                                     <button 
                                       onClick={() => {
                                         selectedMeeting.actions.forEach(action => handleCreateTaskFromMeetingSelection(selectedMeeting, action));
                                       }}
                                       className="text-xs font-bold text-[#7F56D9] hover:underline"
                                     >
                                       Sync All to Tasks →
                                     </button>
                                  </div>
                                </div>
                                <div className="divide-y divide-[#EAECF0]">
                                  {selectedMeeting.actions.map((action, i) => (
                                    <div key={i} className="p-6 flex items-center justify-between gap-6 hover:bg-[#F9FAFB] transition-all group">
                                      <div className="flex-1">
                                         <div className="flex items-center gap-3 mb-1">
                                            <span className={`w-2 h-2 rounded-full ${
                                              action.priority >= 4 ? 'bg-[#F04438]' : 'bg-[#7F56D9]'
                                            }`} />
                                            <p className="text-sm font-bold text-[#101828]">{action.description}</p>
                                         </div>
                                         <p className="text-xs text-[#667085] ml-5">Assignee: {action.ownerEmail || 'Unassigned'} • Due: {new Date(action.dueDate).toLocaleDateString()}</p>
                                      </div>
                                      <div className="flex items-center gap-2">
                                         <button className="p-2 text-[#667085] hover:bg-white hover:text-[#7F56D9] border border-transparent hover:border-[#EAECF0] rounded-lg transition-all group-hover:bg-[#F9FAFB]">
                                            <Clock className="w-4 h-4" />
                                         </button>
                                         <button 
                                           onClick={() => handleCreateTaskFromMeetingSelection(selectedMeeting, action)}
                                           className="px-3 py-1.5 bg-[#F9F5FF] text-[#7F56D9] rounded-lg text-xs font-bold border border-[#E9D7FE] hover:bg-[#F4EBFF]"
                                         >
                                            Create Task
                                         </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Follow-up Emails */}
                              <div className="bg-white rounded-2xl border border-[#EAECF0] shadow-sm overflow-hidden text-left">
                                <div className="p-6 border-b border-[#EAECF0] bg-[#F9FAFB]">
                                  <h3 className="text-lg font-bold text-[#101828]">Draft Follow-ups</h3>
                                </div>
                                <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                                   {selectedMeeting.followUpEmails.map((email, i) => (
                                     <div key={i} className="bg-[#F9FAFB] border border-[#EAECF0] p-5 rounded-2xl flex flex-col justify-between">
                                        <div>
                                           <div className="flex items-center gap-2 mb-3">
                                              <div className="w-8 h-8 rounded-lg bg-[#E0F2FE] text-[#026AA2] flex items-center justify-center font-bold text-xs uppercase">
                                                 {email.recipient.charAt(0)}
                                              </div>
                                              <div>
                                                 <p className="text-xs font-bold text-[#101828] truncate">{email.recipient}</p>
                                                 <p className="text-[10px] text-[#667085]">{email.subjectHint}</p>
                                              </div>
                                           </div>
                                           <ul className="space-y-2 mb-6 text-[11px] text-[#475467] border-l-2 border-[#D0D5DD] pl-3 py-1">
                                              {email.keyPoints.map((point, pi) => (
                                                <li key={pi}>{point}</li>
                                              ))}
                                           </ul>
                                        </div>
                                        <button 
                                          onClick={() => handleCreateFollowUpDraft(email)}
                                          className="w-full bg-white border border-[#D0D5DD] text-[#344054] py-2 rounded-xl text-xs font-bold hover:bg-[#F9FAFB] transition-all flex items-center justify-center gap-2 shadow-sm"
                                        >
                                           <Send className="w-3 h-3" />
                                           Send Follow-up
                                        </button>
                                     </div>
                                   ))}
                                </div>
                              </div>
                            </motion.div>
                          ) : (
                            <div className="h-full flex flex-col items-center justify-center bg-white rounded-3xl border border-[#EAECF0] p-12 text-center">
                               <div className="w-20 h-20 bg-[#F9F5FF] rounded-3xl flex items-center justify-center mb-6">
                                  <Calendar className="w-10 h-10 text-[#7F56D9]" />
                               </div>
                               <h2 className="text-xl font-bold text-[#101828] mb-2">No Meeting Selected</h2>
                               <p className="text-sm text-[#667085] max-w-sm">Select a meeting from the sidebar to view intelligence, or upload new notes to generate fresh insights.</p>
                            </div>
                          )}
                       </AnimatePresence>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === 'TASKS' ? (
              <div className="flex-1 flex overflow-hidden bg-[#F9FAFB]">
                {/* Tasks Sidebar */}
                <div className="w-80 border-r border-[#EAECF0] bg-white flex flex-col shrink-0">
                  <div className="p-6 border-b border-[#EAECF0] shrink-0">
                    <button 
                      onClick={() => {
                        const title = prompt('Enter Task Title:');
                        if (title) handleCreateTask({ title });
                      }}
                      className="w-full bg-[#7F56D9] text-white py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-[#6941C6] transition-all shadow-md shadow-purple-100 mb-4"
                    >
                      <Plus className="w-4 h-4" />
                      Add New Task
                    </button>
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#98A2B3]" />
                      <input 
                        type="text" 
                        placeholder="Filter tasks..." 
                        value={taskSearchTerm || ''}
                        onChange={(e) => setTaskSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-[#F9FAFB] border border-[#D0D5DD] rounded-xl text-xs focus:ring-4 focus:ring-[#F4EBFF] focus:border-[#7F56D9] outline-none transition-all"
                      />
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-6">
                    <div>
                      <h4 className="px-2 text-[10px] font-bold text-[#98A2B3] uppercase tracking-widest mb-3">Views</h4>
                      <div className="space-y-1">
                        <button 
                          onClick={() => setTaskView('KANBAN')}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-bold transition-all ${taskView === 'KANBAN' ? 'bg-[#F9F5FF] text-[#7F56D9]' : 'text-[#475467] hover:bg-[#F9FAFB]'}`}
                        >
                          <Layers className="w-4 h-4" />
                          Kanban Board
                        </button>
                        <button 
                          onClick={() => setTaskView('LIST')}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-bold transition-all ${taskView === 'LIST' ? 'bg-[#F9F5FF] text-[#7F56D9]' : 'text-[#475467] hover:bg-[#F9FAFB]'}`}
                         >
                           <CheckSquare className="w-4 h-4" />
                           List View
                         </button>
                       </div>
                     </div>

                     <div>
                       <h4 className="px-2 text-[10px] font-bold text-[#98A2B3] uppercase tracking-widest mb-3">Priority Filters</h4>
                       <div className="space-y-1">
                         <button 
                           onClick={() => setTaskFocusMode(!taskFocusMode)}
                           className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-bold transition-all ${taskFocusMode ? 'bg-[#FEF3F2] text-[#B42318]' : 'text-[#475467] hover:bg-[#F9FAFB]'}`}
                         >
                           <div className="flex items-center gap-3">
                             <AlertCircle className="w-4 h-4" />
                             Focus Mode
                           </div>
                           {taskFocusMode && <div className="w-2 h-2 rounded-full bg-[#F04438]" />}
                         </button>
                       </div>
                     </div>

                     <div>
                        <h4 className="px-2 text-[10px] font-bold text-[#98A2B3] uppercase tracking-widest mb-3">By Source</h4>
                        <div className="space-y-1">
                           <button 
                             onClick={() => setTaskSourceFilter('all')}
                             className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-bold transition-all ${taskSourceFilter === 'all' ? 'bg-[#F9F5FF] text-[#7F56D9]' : 'text-[#475467] hover:bg-[#F9FAFB]'}`}
                           >
                              <div className="w-2 h-2 rounded-full bg-[#EAECF0]" />
                              All Sources
                           </button>
                           {['email', 'meeting', 'manual'].map(source => (
                             <button 
                               key={source} 
                               onClick={() => setTaskSourceFilter(source as any)}
                               className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-bold transition-all capitalize ${taskSourceFilter === source ? 'bg-[#F9F5FF] text-[#7F56D9]' : 'text-[#475467] hover:bg-[#F9FAFB]'}`}
                             >
                                <div className={`w-2 h-2 rounded-full ${source === 'email' ? 'bg-blue-400' : source === 'meeting' ? 'bg-purple-400' : 'bg-gray-400'}`} />
                                {source}s
                             </button>
                           ))}
                        </div>
                     </div>
                  </div>
                </div>

                {/* Task Dashboard Content */}
                <div className="flex-1 overflow-y-auto p-8">
                  <div className="max-w-7xl mx-auto space-y-8">
                     {taskView === 'KANBAN' ? (
                       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                          {['todo', 'in_progress', 'review', 'done'].map((status) => {
                             const filteredTasks = tasks.filter(t => 
                               t.status === status && 
                               (!taskFocusMode || t.priority.score >= 4) &&
                               (taskSourceFilter === 'all' || t.source?.module === taskSourceFilter) &&
                               (t.title.toLowerCase().includes(taskSearchTerm.toLowerCase()))
                             );
                             return (
                               <div key={status} className="space-y-4">
                                  <div className="flex items-center justify-between px-2">
                                     <h3 className="text-xs font-bold text-[#475467] uppercase tracking-widest flex items-center gap-2">
                                        {status.replace('_', ' ')}
                                        <span className="w-5 h-5 bg-[#EAECF0] rounded-md flex items-center justify-center text-[10px]">{filteredTasks.length}</span>
                                     </h3>
                                     <button className="text-[#98A2B3] hover:text-[#101828]">
                                        <Plus className="w-4 h-4" />
                                     </button>
                                  </div>
                                  <div className="space-y-3">
                                     {filteredTasks.map(task => (
                                       <motion.div
                                         key={task.id}
                                         layoutId={task.id}
                                         onClick={() => setSelectedTask(task)}
                                         className={`bg-white border rounded-2xl p-4 shadow-sm hover:shadow-md transition-all cursor-pointer group ${selectedTask?.id === task.id ? 'border-[#7F56D9] ring-2 ring-[#F4EBFF]' : 'border-[#EAECF0]'}`}
                                       >
                                          <div className="flex items-start justify-between gap-3 mb-2">
                                             <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${task.priority.score >= 4 ? 'bg-[#FEF3F2] text-[#B42318] border-[#FECDCA]' : 'bg-[#F9F5FF] text-[#6941C6] border-[#E9D7FE]'}`}>
                                                P{task.priority.score}
                                             </div>
                                                                                           <div className="flex items-center gap-1">
                                                <button 
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    const newTitle = prompt('Edit Task Title:', task.title);
                                                    if (newTitle) handleUpdateTask(task.id, { title: newTitle });
                                                  }}
                                                  className="p-1 text-[#98A2B3] hover:text-[#7F56D9] transition-all opacity-0 group-hover:opacity-100 placeholder-edit"
                                                >
                                                  <Edit2 className="w-3 h-3" />
                                                </button>
                                                <span className="text-[10px] text-[#98A2B3] font-medium">{new Date(task.due_date).toLocaleDateString()}</span>
                                              </div>
                                          </div>
                                          <h4 className="text-sm font-bold text-[#101828] mb-2 line-clamp-2 leading-tight group-hover:text-[#7F56D9] transition-colors">{task.title}</h4>
                                          <div className="flex items-center justify-between mt-4">
                                             <div className="flex -space-x-2">
                                                <div className="w-6 h-6 rounded-full bg-[#F2F4F7] border-2 border-white flex items-center justify-center text-[8px] font-bold text-[#475467]">
                                                   {task.assignee?.charAt(0).toUpperCase() || 'U'}
                                                </div>
                                             </div>
                                             <div className="flex items-center gap-2 text-[#98A2B3]">
                                                {task.dependencies?.length > 0 && <Clock className="w-3 h-3 text-[#F79009]" />}
                                                {task.source?.module === 'email' && <Mail className="w-3 h-3" />}
                                                {task.source?.module === 'meeting' && <MessageSquare className="w-3 h-3" />}
                                             </div>
                                          </div>
                                       </motion.div>
                                     ))}
                                  </div>
                               </div>
                             );
                          })}
                       </div>
                     ) : (
                       <div className="bg-white rounded-2xl border border-[#EAECF0] shadow-sm overflow-hidden">
                          <table className="w-full text-left border-collapse">
                             <thead>
                                <tr className="bg-[#F9FAFB] border-b border-[#EAECF0]">
                                   <th className="px-6 py-4 text-[10px] font-bold text-[#667085] uppercase tracking-widest">Task Name</th>
                                   <th className="px-6 py-4 text-[10px] font-bold text-[#667085] uppercase tracking-widest">Status</th>
                                   <th className="px-6 py-4 text-[10px] font-bold text-[#667085] uppercase tracking-widest">Priority</th>
                                   <th className="px-6 py-4 text-[10px] font-bold text-[#667085] uppercase tracking-widest">Due Date</th>
                                   <th className="px-6 py-4 text-[10px] font-bold text-[#667085] uppercase tracking-widest text-right">Owner</th>
                                </tr>
                             </thead>
                             <tbody className="divide-y divide-[#EAECF0]">
                                {tasks.filter(t => 
                                  (!taskFocusMode || t.priority.score >= 4) &&
                                  (taskSourceFilter === 'all' || t.source?.module === taskSourceFilter) &&
                                  (t.title.toLowerCase().includes(taskSearchTerm.toLowerCase()))
                                ).length === 0 ? (
                                  <tr>
                                    <td colSpan={5} className="px-6 py-12 text-center text-sm text-[#98A2B3]">
                                       No tasks found matching your criteria
                                    </td>
                                  </tr>
                                ) : (
                                  tasks.filter(t => 
                                    (!taskFocusMode || t.priority.score >= 4) &&
                                    (taskSourceFilter === 'all' || t.source?.module === taskSourceFilter) &&
                                    (t.title.toLowerCase().includes(taskSearchTerm.toLowerCase()))
                                  ).map(task => (
                                    <tr 
                                      key={task.id} 
                                      className={`hover:bg-[#F9FAFB] group transition-colors ${selectedTask?.id === task.id ? 'bg-[#F9F5FF]' : ''}`}
                                    >
                                       <td className="px-6 py-4" onClick={() => setSelectedTask(task)}>
                                          <div className="flex items-center gap-3 cursor-pointer">
                                             <div className={`p-1.5 rounded-lg ${task.source?.module === 'email' ? 'bg-[#EFF8FF] text-[#175CD3]' : task.source?.module === 'meeting' ? 'bg-[#F9F5FF] text-[#7F56D9]' : 'bg-[#F2F4F7] text-[#475467]'}`}>
                                                {task.source?.module === 'email' ? <Mail className="w-4 h-4" /> : task.source?.module === 'meeting' ? <MessageSquare className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                                             </div>
                                             <span className="text-sm font-bold text-[#101828]">{task.title}</span>
                                          </div>
                                       </td>
                                       <td className="px-6 py-4">
                                          <select 
                                            value={task.status || 'todo'}
                                            onChange={(e) => handleUpdateTask(task.id, { status: e.target.value as any })}
                                            className={`px-2.5 py-1 rounded-full text-[10px] font-bold border shadow-sm outline-none bg-transparent cursor-pointer ${
                                              task.status === 'done' ? 'bg-[#ECFDF3] text-[#027A48] border-[#ABEFC6]' :
                                              task.status === 'in_progress' ? 'bg-[#EFF8FF] text-[#175CD3] border-[#B2DDFF]' :
                                              'bg-[#F9FAFB] text-[#475467] border-[#EAECF0]'
                                            }`}
                                          >
                                             <option value="todo">To Do</option>
                                             <option value="in_progress">In Progress</option>
                                             <option value="review">Review</option>
                                             <option value="done">Done</option>
                                          </select>
                                       </td>
                                       <td className="px-6 py-4">
                                          <div className="flex items-center gap-2">
                                             <div className={`w-2 h-2 rounded-full ${task.priority.score >= 4 ? 'bg-[#F04438]' : task.priority.score >= 2 ? 'bg-[#F79009]' : 'bg-[#12B76A]'}`} />
                                             <span className="text-xs font-bold text-[#101828]">P{task.priority.score}</span>
                                          </div>
                                       </td>
                                       <td className="px-6 py-4">
                                          <span className="text-xs text-[#667085]">{new Date(task.due_date).toLocaleDateString()}</span>
                                       </td>
                                       <td className="px-6 py-4 text-right">
                                          <div className="flex items-center justify-end gap-3">
                                             <span className="text-xs font-bold text-[#344054] underline decoration-dotted decoration-[#D0D5DD]">{task.assignee || 'Unassigned'}</span>
                                             <button 
                                               onClick={() => handleDeleteTask(task.id)}
                                               className="p-1.5 text-[#667085] hover:text-[#F04438] transition-all opacity-0 group-hover:opacity-100"
                                             >
                                                <Trash2 className="w-4 h-4" />
                                             </button>
                                          </div>
                                       </td>
                                    </tr>
                                  ))
                                )}
                             </tbody>
                          </table>
                       </div>
                     )}
                  </div>
                </div>

                {/* Task Details Modal (Right Panel) */}
                <AnimatePresence>
                   {selectedTask && (
                     <motion.div 
                       initial={{ x: 400, opacity: 0 }}
                       animate={{ x: 0, opacity: 1 }}
                       exit={{ x: 400, opacity: 0 }}
                       className="w-1/3 bg-white border-l border-[#EAECF0] shadow-2xl flex flex-col shrink-0 relative overflow-y-auto"
                     >
                        <div className="p-8 border-b border-[#EAECF0] flex items-center justify-between sticky top-0 bg-white z-10 backdrop-blur-md bg-white/90">
                           <div className="flex items-center gap-3">
                              <CheckSquare className="w-6 h-6 text-[#7F56D9]" />
                              <h3 className="text-xl font-bold text-[#101828]">Task Details</h3>
                           </div>
                           <button onClick={() => setSelectedTask(null)} className="p-2 text-[#667085] hover:bg-[#F9FAFB] rounded-lg">
                              <X className="w-6 h-6" />
                           </button>
                        </div>

                        <div className="p-8 space-y-8">
                           <div>
                              <div className="flex items-center justify-between mb-2">
                                 <span className="text-[10px] font-bold text-[#98A2B3] uppercase tracking-widest">Source Module</span>
                                 <div className="px-2 py-0.5 bg-[#F9FAFB] border border-[#EAECF0] rounded-md text-[10px] font-bold text-[#475467] uppercase">
                                    {selectedTask.source?.module || 'manual'}
                                 </div>
                              </div>
                              <h2 className="text-2xl font-bold text-[#101828] mb-4 leading-tight">{selectedTask.title}</h2>
                              <div className="p-5 bg-[#F9FAFB] rounded-2xl border border-[#EAECF0] text-sm text-[#475467] leading-relaxed italic">
                                 "{selectedTask.description}"
                              </div>
                           </div>

                           <div className="grid grid-cols-2 gap-6">
                              <div className="space-y-2">
                                 <label className="text-[10px] font-bold text-[#98A2B3] uppercase tracking-widest block">Status</label>
                                 <select 
                                   value={selectedTask.status || ''}
                                   onChange={(e) => handleUpdateTask(selectedTask.id, { status: e.target.value as any })}
                                   className="w-full px-4 py-2 bg-white border border-[#D0D5DD] rounded-xl text-sm font-bold text-[#344054] outline-none shadow-sm focus:ring-2 focus:ring-[#F4EBFF]"
                                 >
                                    <option value="todo">To Do</option>
                                    <option value="in_progress">In Progress</option>
                                    <option value="review">Review</option>
                                    <option value="done">Done</option>
                                 </select>
                              </div>
                              <div className="space-y-2">
                                 <label className="text-[10px] font-bold text-[#98A2B3] uppercase tracking-widest block">Due Date</label>
                                 <div className="flex items-center gap-2 px-4 py-2 bg-[#F9FAFB] border border-[#EAECF0] rounded-xl">
                                    <Calendar className="w-4 h-4 text-[#667085]" />
                                    <span className="text-sm font-bold text-[#344054]">{new Date(selectedTask.due_date).toLocaleDateString()}</span>
                                 </div>
                              </div>
                           </div>

                           {/* Priority & AI Rational Card */}
                           <div className="bg-[#101828] rounded-2xl p-6 text-white shadow-xl shadow-gray-200">
                              <div className="flex items-center justify-between mb-4">
                                 <div className="flex items-center gap-2">
                                    <Sparkles className="w-5 h-5 text-[#D6BBFB]" />
                                    <h4 className="text-lg font-bold">AI Priority Intelligence</h4>
                                 </div>
                                 <button 
                                   onClick={() => handlePrioritizeTask(selectedTask)}
                                   disabled={isPrioritizing}
                                   className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-all text-white disabled:opacity-50"
                                 >
                                    <RefreshCw className={`w-4 h-4 ${isPrioritizing ? 'animate-spin' : ''}`} />
                                 </button>
                              </div>
                              <div className="space-y-4">
                                 <div className="flex items-center gap-4">
                                    <div className="text-4xl font-black text-[#D6BBFB]">P{selectedTask.priority.score}</div>
                                    <p className="text-xs text-gray-400 leading-relaxed">{selectedTask.priority.reason}</p>
                                 </div>
                                 {selectedTask.ai_suggestions && (
                                   <div className="pt-4 border-t border-white/10 space-y-4">
                                      <div>
                                         <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Suggested Timeline</p>
                                         <div className="flex items-center gap-2">
                                            <Clock className="w-4 h-4 text-gray-500" />
                                            <span className="text-sm font-bold">{selectedTask.ai_suggestions.time_estimate}</span>
                                         </div>
                                      </div>
                                      <div>
                                         <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Intelligent Subtasks</p>
                                         <div className="space-y-2">
                                            {selectedTask.ai_suggestions.subtasks.map((s, si) => (
                                              <div key={si} className="flex items-center gap-3 bg-white/5 p-3 rounded-xl border border-white/10 group/sub">
                                                 <div className="w-4 h-4 rounded border border-white/20 flex-shrink-0" />
                                                 <span className="text-xs text-gray-300">{s}</span>
                                              </div>
                                            ))}
                                         </div>
                                      </div>
                                   </div>
                                 )}
                              </div>
                           </div>

                           {/* Dependencies */}
                           <div className="bg-white rounded-2xl border border-[#EAECF0] p-6">
                              <h4 className="text-sm font-bold text-[#101828] mb-4 flex items-center gap-2">
                                 <Layers className="w-4 h-4 text-[#7F56D9]" />
                                 Dependencies
                              </h4>
                              {selectedTask.dependencies?.length > 0 ? (
                                <div className="space-y-3">
                                   {selectedTask.dependencies.map(depId => {
                                     const depTask = tasks.find(t => t.id === depId);
                                     return (
                                       <div key={depId} className="flex items-center justify-between p-3 bg-[#FEF3F2] border border-[#FECDCA] rounded-xl">
                                          <div className="flex items-center gap-3 min-w-0">
                                             <AlertCircle className="w-4 h-4 text-[#B42318]" />
                                             <span className="text-xs font-bold text-[#B42318] truncate">{depTask?.title || 'Unknown Task'}</span>
                                          </div>
                                          <span className="text-[10px] font-bold text-[#B42318] uppercase shrink-0">Blocking</span>
                                       </div>
                                     );
                                   })}
                                </div>
                              ) : (
                                <p className="text-sm text-[#98A2B3] text-center py-4 border-2 border-dashed border-[#EAECF0] rounded-2xl">No active dependencies identified.</p>
                              )}
                           </div>
                        </div>
                     </motion.div>
                   )}
                </AnimatePresence>
              </div>
            ) : activeTab === 'SUPPORT' ? (
              <div className="flex-1 p-8 overflow-y-auto bg-[#F9FAFB]">
                <div className="max-w-5xl mx-auto space-y-8">
                  {/* Support Hero */}
                  <div className="bg-white border border-[#EAECF0] rounded-3xl p-10 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-[#F9F5FF] rounded-full -mr-32 -mt-32 blur-3xl opacity-50" />
                    <div className="relative z-10 max-w-2xl">
                      <h3 className="text-3xl font-bold text-[#101828] mb-4">How can we help you today?</h3>
                      <p className="text-[#475467] mb-8 text-lg">Search our knowledge base or browse common topics below to get the most out of isBIM BOS.</p>
                      <div className="relative max-w-xl">
                        <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-[#667085]" />
                        <input 
                          type="text" 
                          placeholder="Search for help articles, tutorials, and more..." 
                          className="w-full pl-12 pr-4 py-4 bg-[#F9FAFB] border border-[#D0D5DD] rounded-2xl text-sm focus:ring-4 focus:ring-[#F4EBFF] focus:border-[#7F56D9] outline-none transition-all shadow-sm"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Help Categories */}
                    <div className="lg:col-span-2 space-y-6">
                      <h4 className="text-lg font-bold text-[#101828]">Popular Topics</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {[
                          { title: 'Getting Started', desc: 'Learn the basics of isBIM BOS and how to set up your account.', icon: <Home className="w-5 h-5 text-[#7F56D9]" /> },
                          { title: 'Email Classification', desc: 'How our AI categorizes your incoming business emails.', icon: <Mail className="w-5 h-5 text-[#2E90FA]" /> },
                          { title: 'Tender', desc: 'Master the art of extracting requirements from complex PDFs.', icon: <Layers className="w-5 h-5 text-[#F79009]" /> },
                          { title: 'Bid Generation', desc: 'Tips for creating persuasive bid drafts with AI.', icon: <FileText className="w-5 h-5 text-[#12B76A]" /> },
                        ].map((item, i) => (
                          <button key={i} className="text-left p-6 bg-white border border-[#EAECF0] rounded-2xl hover:border-[#7F56D9] hover:shadow-md transition-all group">
                            <div className="w-10 h-10 bg-[#F9FAFB] rounded-xl flex items-center justify-center mb-4 group-hover:bg-[#F9F5FF] transition-colors">
                              {item.icon}
                            </div>
                            <h5 className="font-bold text-[#101828] mb-1">{item.title}</h5>
                            <p className="text-xs text-[#475467] leading-relaxed">{item.desc}</p>
                          </button>
                        ))}
                      </div>

                      <div className="bg-white border border-[#EAECF0] rounded-2xl p-6">
                        <h4 className="text-lg font-bold text-[#101828] mb-4">Frequently Asked Questions</h4>
                        <div className="space-y-4">
                          {[
                            'How do I update my Google App Password?',
                            'Can I export my business records to Excel?',
                            'How accurate is the AI tender processing?',
                            'What file formats are supported for OCR?'
                          ].map((q, i) => (
                            <button key={i} className="w-full flex items-center justify-between p-4 bg-[#F9FAFB] rounded-xl hover:bg-[#F2F4F7] transition-all group">
                              <span className="text-sm font-medium text-[#344054]">{q}</span>
                              <ChevronRight className="w-4 h-4 text-[#98A2B3] group-hover:text-[#7F56D9] transition-colors" />
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Sidebar Support Info */}
                    <div className="space-y-6">
                      {/* System Status Preview */}
                      <div className="bg-white border border-[#EAECF0] rounded-2xl p-6 shadow-sm">
                        <h4 className="text-sm font-bold text-[#101828] mb-4 flex items-center justify-between">
                          System Status
                          <span className="flex items-center gap-1.5 px-2 py-0.5 bg-[#ECFDF3] border border-[#ABEFC6] rounded-full">
                            <div className="w-1.5 h-1.5 bg-[#12B76A] rounded-full" />
                            <span className="text-[10px] font-bold text-[#027A48]">All Systems Operational</span>
                          </span>
                        </h4>
                        <div className="space-y-4">
                          {[
                            { label: 'AI Engine', status: 'Operational' },
                            { label: 'Email Sync', status: 'Operational' },
                            { label: 'Database', status: 'Operational' },
                            { label: 'OCR Service', status: 'Operational' },
                          ].map((s, i) => (
                            <div key={i} className="flex items-center justify-between text-xs">
                              <span className="text-[#667085]">{s.label}</span>
                              <span className="font-bold text-[#027A48]">{s.status}</span>
                            </div>
                          ))}
                        </div>
                        <button className="w-full mt-6 py-2 text-xs font-bold text-[#7F56D9] border border-[#F4EBFF] rounded-lg hover:bg-[#F9F5FF] transition-all">
                          View Detailed Logs
                        </button>
                      </div>

                      {/* Contact Support */}
                      <div className="bg-[#101828] rounded-2xl p-6 text-white shadow-xl shadow-gray-200">
                        <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center mb-4">
                          <Bell className="w-6 h-6 text-white" />
                        </div>
                        <h4 className="text-lg font-bold mb-2">Need more help?</h4>
                        <p className="text-sm text-gray-400 mb-6 leading-relaxed">Our support team is available 24/7 to help you with any technical issues or questions.</p>
                        <button className="w-full py-3 bg-[#7F56D9] text-white rounded-xl font-bold text-sm hover:bg-[#6941C6] transition-all shadow-lg shadow-purple-900/20">
                          Contact Support
                        </button>
                        <p className="text-center mt-4 text-[10px] text-gray-500">Average response time: &lt; 2 hours</p>
                      </div>

                      {/* Version Info */}
                      <div className="text-center p-4">
                        <p className="text-[10px] text-[#98A2B3] font-medium uppercase tracking-widest">isBIM BOS v2.4.0-stable</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : activeTab === 'SKILLS' ? (
              <div className="flex-1 p-8 overflow-y-auto bg-[#F9FAFB]">
                <div className="max-w-7xl mx-auto space-y-8">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                    <div>
                      <h3 className="text-2xl font-bold text-[#101828]">AI Skill Management</h3>
                      <p className="text-sm text-[#475467]">Relocated advanced controls for Gemini behavioral rules and data parsing templates.</p>
                    </div>
                    <div className="flex bg-white p-1 rounded-xl border border-[#EAECF0] shadow-sm">
                      <button 
                        onClick={() => setActiveSkillSubTab('PROMPTS')}
                        className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                          activeSkillSubTab === 'PROMPTS' ? 'bg-[#F9F5FF] text-[#7F56D9] shadow-sm' : 'text-[#667085] hover:text-[#344054]'
                        }`}
                      >
                        AI Prompts
                      </button>
                      <button 
                        onClick={() => setActiveSkillSubTab('TEMPLATES')}
                        className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                          activeSkillSubTab === 'TEMPLATES' ? 'bg-[#F9F5FF] text-[#7F56D9] shadow-sm' : 'text-[#667085] hover:text-[#344054]'
                        }`}
                      >
                        Form Templates
                      </button>
                    </div>
                  </div>

                  {activeSkillSubTab === 'PROMPTS' ? (
                    <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
                      <div className="xl:col-span-4 space-y-6">
                        <div className="bg-amber-50 border border-amber-200 rounded-3xl p-6">
                          <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center mb-4 shadow-sm">
                            <Sparkles className="w-6 h-6 text-amber-600" />
                          </div>
                          <h4 className="text-lg font-bold text-amber-900 mb-2">Prompt Optimization</h4>
                          <p className="text-sm text-amber-800 leading-relaxed mb-4">
                            These prompts define how Gemini interacts with your data. Use precision language to improve extraction quality.
                          </p>
                          <div className="space-y-2">
                             <div className="text-xs font-bold text-amber-900 flex items-center gap-2">
                               <div className="w-1.5 h-1.5 bg-amber-600 rounded-full" />
                               Use markdown format in responses
                             </div>
                             <div className="text-xs font-bold text-amber-900 flex items-center gap-2">
                               <div className="w-1.5 h-1.5 bg-amber-600 rounded-full" />
                               Don't remove existing variables
                             </div>
                          </div>
                        </div>
                      </div>

                      <div className="xl:col-span-8 space-y-6">
                         <div className="bg-white border border-[#EAECF0] rounded-3xl p-8 shadow-sm space-y-8">
                            <div className="flex gap-4 border-b border-[#EAECF0] pb-1">
                              <button 
                                onClick={() => setActivePromptTab('CLASSIFY')}
                                className={`px-4 py-2 text-sm font-bold transition-all relative ${
                                  activePromptTab === 'CLASSIFY' ? 'text-[#7F56D9]' : 'text-[#667085] hover:text-[#344054]'
                                }`}
                              >
                                Email Classification
                                {activePromptTab === 'CLASSIFY' && <div className="absolute bottom-[-4px] left-0 right-0 h-1 bg-[#7F56D9] rounded-full" />}
                              </button>
                              <button 
                                onClick={() => setActivePromptTab('TENDER')}
                                className={`px-4 py-2 text-sm font-bold transition-all relative ${
                                  activePromptTab === 'TENDER' ? 'text-[#F79009]' : 'text-[#667085] hover:text-[#344054]'
                                }`}
                              >
                                Tender Analysis
                                {activePromptTab === 'TENDER' && <div className="absolute bottom-[-4px] left-0 right-0 h-1 bg-[#F79009] rounded-full" />}
                              </button>
                              <button 
                                onClick={() => setActivePromptTab('BID')}
                                className={`px-4 py-2 text-sm font-bold transition-all relative ${
                                  activePromptTab === 'BID' ? 'text-[#12B76A]' : 'text-[#667085] hover:text-[#344054]'
                                }`}
                              >
                                Bid Generation
                                {activePromptTab === 'BID' && <div className="absolute bottom-[-4px] left-0 right-0 h-1 bg-[#12B76A] rounded-full" />}
                              </button>
                            </div>

                            <div className="space-y-6">
                              {activePromptTab === 'CLASSIFY' && (
                                <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                                  <div className="space-y-2">
                                    <label className="text-sm font-bold text-[#344054] flex items-center gap-2">
                                      <Mail className="w-4 h-4 text-[#7F56D9]" />
                                      Behavioral Rule: Classification
                                    </label>
                                    <p className="text-xs text-[#667085]">Gemini will use this logic to categorize incoming business correspondence. Valid placeholders: &#123;&#123;from&#125;&#125;, &#123;&#123;subject&#125;&#125;, &#123;&#123;body&#125;&#125;, &#123;&#123;attachments&#125;&#125;</p>
                                    <textarea 
                                      rows={12}
                                      value={promptSettings.classifyEmail || ''}
                                      onChange={(e) => setPromptSettings({...promptSettings, classifyEmail: e.target.value})}
                                      className="w-full px-4 py-3 text-xs font-mono bg-[#F9FAFB] border border-[#D0D5DD] rounded-2xl focus:ring-4 focus:ring-[#F4EBFF] focus:border-[#7F56D9] transition-all"
                                    />
                                  </div>
                                  <div className="pt-4 border-t border-[#EAECF0]">
                                    <button 
                                      onClick={handleSavePromptSettings}
                                      className="px-6 py-3 bg-[#7F56D9] text-white rounded-xl font-bold text-sm shadow-lg hover:shadow-purple-200 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center gap-2"
                                    >
                                      <CheckCircle className="w-4 h-4" />
                                      Update Classification Logic
                                    </button>
                                  </div>
                                </div>
                              )}

                              {activePromptTab === 'TENDER' && (
                                <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                                  <div className="space-y-2">
                                    <label className="text-sm font-bold text-[#344054] flex items-center gap-2">
                                      <Layers className="w-4 h-4 text-[#F79009]" />
                                      Behavioral Rule: Analysis
                                    </label>
                                    <p className="text-xs text-[#667085]">Defines how Gemini extracts line items, pricing, and requirements from tender documents. Valid placeholders: &#123;&#123;text&#125;&#125;</p>
                                    <textarea 
                                      rows={12}
                                      value={promptSettings.analyzeTender || ''}
                                      onChange={(e) => setPromptSettings({...promptSettings, analyzeTender: e.target.value})}
                                      className="w-full px-4 py-3 text-xs font-mono bg-[#F9FAFB] border border-[#D0D5DD] rounded-2xl focus:ring-4 focus:ring-[#F4EBFF] focus:border-[#F79009] transition-all"
                                    />
                                  </div>
                                  <div className="pt-4 border-t border-[#EAECF0]">
                                    <button 
                                      onClick={handleSavePromptSettings}
                                      className="px-6 py-3 bg-[#F79009] text-white rounded-xl font-bold text-sm shadow-lg hover:shadow-orange-200 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center gap-2"
                                    >
                                      <CheckCircle className="w-4 h-4" />
                                      Update Analysis Logic
                                    </button>
                                  </div>
                                </div>
                              )}

                              {activePromptTab === 'BID' && (
                                <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                                  <div className="space-y-2">
                                    <label className="text-sm font-bold text-[#344054] flex items-center gap-2">
                                      <FileText className="w-4 h-4 text-[#12B76A]" />
                                      Behavioral Rule: Generation
                                    </label>
                                    <p className="text-xs text-[#667085]">Instructions for drafting proposal responses based on tender analysis. Valid placeholders: &#123;&#123;analysis&#125;&#125;</p>
                                    <textarea 
                                      rows={12}
                                      value={promptSettings.createBidDraft || ''}
                                      onChange={(e) => setPromptSettings({...promptSettings, createBidDraft: e.target.value})}
                                      className="w-full px-4 py-3 text-xs font-mono bg-[#F9FAFB] border border-[#D0D5DD] rounded-2xl focus:ring-4 focus:ring-[#F6FEF9] focus:border-[#12B76A] transition-all"
                                    />
                                  </div>
                                  <div className="pt-4 border-t border-[#EAECF0]">
                                    <button 
                                      onClick={handleSavePromptSettings}
                                      className="px-6 py-3 bg-[#12B76A] text-white rounded-xl font-bold text-sm shadow-lg hover:shadow-green-200 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center gap-2"
                                    >
                                      <CheckCircle className="w-4 h-4" />
                                      Update Generation Logic
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                         </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-8">
                       <div className="bg-blue-50 border border-blue-200 rounded-3xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
                          <div className="flex gap-4">
                            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shrink-0 shadow-sm">
                              <Layers className="w-6 h-6 text-blue-600" />
                            </div>
                            <div>
                               <h4 className="text-lg font-bold text-blue-900">Form Template Mapping</h4>
                               <p className="text-sm text-blue-800">Control how AI extracted data points map into your business record fields.</p>
                            </div>
                          </div>
                          <button className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold shadow-md hover:bg-blue-700 transition-all flex items-center gap-2">
                            <Plus className="w-4 h-4" />
                            New Template Type
                          </button>
                       </div>

                       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                          {Object.entries(formTemplateSettings).map(([key, config]: [string, any]) => (
                             <div key={key} className="bg-white border border-[#EAECF0] rounded-3xl p-6 shadow-sm hover:shadow-md transition-all group/card">
                               <div className="flex items-center justify-between mb-6">
                                  <div className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border" style={{ borderColor: config.color, color: config.color, backgroundColor: config.color + '10' }}>
                                    {config.label}
                                  </div>
                                  <input 
                                    type="color" 
                                    value={config.color || '#000000'}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setFormTemplateSettings((prev: any) => ({
                                        ...prev,
                                        [key]: { ...prev[key], color: val }
                                      }));
                                    }}
                                    className="w-6 h-6 rounded-lg cursor-pointer border-none bg-transparent"
                                  />
                               </div>

                               <div className="space-y-3 mb-6">
                                  <label className="text-[10px] font-black text-[#98A2B3] uppercase tracking-widest block">Mapped Schema</label>
                                  {config.fields.map((f: string, idx: number) => (
                                    <div key={idx} className="flex items-center gap-2 group/field">
                                       <div className="flex-1 px-3 py-2 bg-[#F9FAFB] border border-[#EAECF0] rounded-xl text-xs font-semibold text-[#344054] flex items-center gap-2">
                                          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: config.color }} />
                                          <input 
                                            type="text"
                                            value={f || ''}
                                            onChange={(e) => {
                                              const newFields = [...config.fields];
                                              newFields[idx] = e.target.value;
                                              setFormTemplateSettings((prev: any) => ({
                                                ...prev,
                                                [key]: { ...prev[key], fields: newFields }
                                              }));
                                            }}
                                            className="bg-transparent border-none outline-none w-full"
                                          />
                                       </div>
                                       <button 
                                          onClick={() => {
                                            const newFields = config.fields.filter((_: any, i: number) => i !== idx);
                                            setFormTemplateSettings((prev: any) => ({
                                              ...prev,
                                              [key]: { ...prev[key], fields: newFields }
                                            }));
                                          }}
                                          className="p-1.5 text-gray-400 hover:text-red-500 opacity-0 group-hover/field:opacity-100 transition-all"
                                       >
                                          <X className="w-3.5 h-3.5" />
                                       </button>
                                    </div>
                                  ))}
                               </div>

                               <div className="relative">
                                  <input 
                                    type="text"
                                    placeholder="Add field..."
                                    className="w-full pl-3 pr-10 py-2.5 bg-[#F9FAFB] border border-dashed border-[#D0D5DD] rounded-xl text-xs outline-none focus:border-[#7F56D9] transition-all"
                                    onKeyDown={(e: any) => {
                                      if (e.key === 'Enter') {
                                        const val = e.target.value;
                                        if (val) {
                                          setFormTemplateSettings((prev: any) => ({
                                            ...prev,
                                            [key]: { ...prev[key], fields: [...config.fields, val] }
                                          }));
                                          e.target.value = '';
                                        }
                                      }
                                    }}
                                  />
                                  <Plus className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                               </div>
                             </div>
                          ))}
                       </div>

                       <div className="bg-white border border-[#EAECF0] rounded-3xl p-8 flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className="p-3 bg-green-50 rounded-xl">
                              <CheckCircle className="w-6 h-6 text-green-600" />
                            </div>
                            <div>
                               <h4 className="font-bold text-[#101828]">Deploy Changes</h4>
                               <p className="text-sm text-[#667085]">Save your template configurations to the system.</p>
                            </div>
                          </div>
                          <button 
                            onClick={handleSaveFormSettings}
                            className="px-6 py-3 bg-[#101828] text-white rounded-xl font-bold shadow-lg hover:shadow-black/20 transition-all active:scale-95"
                          >
                            Sync Templates
                          </button>
                       </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-[#98A2B3]">
                <p className="text-sm">Section under development</p>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[#0C111D]/70 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl p-8 max-w-2xl w-full shadow-2xl border border-[#EAECF0]"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#F9F5FF] rounded-lg flex items-center justify-center">
                    <Settings className="text-[#7F56D9] w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-[#101828]">System Configuration</h3>
                    <p className="text-xs text-[#475467]">Manage your BOS system settings and AI behavior.</p>
                  </div>
                </div>
                <button onClick={() => setShowSettings(false)} className="p-2 text-[#667085] hover:bg-[#F9FAFB] rounded-lg transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Settings Tabs */}
              <div className="flex border-b border-[#EAECF0] mb-6">
                {[
                  { id: 'GENERAL', label: 'General', icon: <Settings className="w-4 h-4" /> },
                  { id: 'CONNECTIONS', label: 'Connections', icon: <RefreshCw className="w-4 h-4" /> },
                  { id: 'AI', label: 'AI Models', icon: <Sparkles className="w-4 h-4" /> }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setSettingsTab(tab.id as any)}
                    className={`flex items-center gap-2 px-6 py-3 border-b-2 transition-all text-sm font-semibold ${
                      settingsTab === tab.id 
                        ? 'border-[#7F56D9] text-[#7F56D9]' 
                        : 'border-transparent text-[#667085] hover:text-[#344054]'
                    }`}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="max-h-[60vh] overflow-y-auto pr-2">
                {settingsTab === 'GENERAL' && (
                  <div className="space-y-6">
                    <div className="space-y-3">
                      <h4 className="text-sm font-bold text-[#101828]">System Access</h4>
                      <label className="flex items-center gap-3 p-3 bg-[#F9FAFB] border border-[#D0D5DD] rounded-xl cursor-pointer hover:bg-[#F2F4F7] transition-all">
                        <input 
                          type="checkbox" 
                          checked={allowUserEditTemplates}
                          onChange={(e) => setAllowUserEditTemplates(e.target.checked)}
                          className="w-4 h-4 rounded border-[#D0D5DD] text-[#7F56D9] focus:ring-[#7F56D9]"
                        />
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-[#344054]">Allow users to edit templates</p>
                          <p className="text-[11px] text-[#667085]">When disabled, only super admins can edit records.</p>
                        </div>
                      </label>
                    </div>

                    <div className="pt-4 border-t border-[#EAECF0]">
                      <button 
                        onClick={handleSaveGeneralSettings}
                        className="w-full bg-[#7F56D9] text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#6941C6] transition-all flex items-center justify-center gap-2 shadow-sm"
                      >
                        Save Configuration
                      </button>
                    </div>
                  </div>
                )}

                {settingsTab === 'CONNECTIONS' && (
                  <div className="space-y-6">
                    <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl mb-4">
                      <div className="flex gap-3">
                        <RefreshCw className="w-5 h-5 text-indigo-600 shrink-0" />
                        <div>
                          <p className="text-xs font-bold text-indigo-800 mb-1">Email Accounts</p>
                          <p className="text-[11px] text-indigo-700 leading-relaxed">
                            Connect multiple email accounts via IMAP to sync data across providers (Gmail, Outlook, custom IMAP).
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {emailConnections.map((conn, idx) => (
                        <div key={idx} className="p-4 bg-[#F9FAFB] border border-[#EAECF0] rounded-xl relative group">
                          <button 
                            onClick={() => {
                              const newConns = emailConnections.filter((_, i) => i !== idx);
                              setEmailConnections(newConns);
                              handleSaveEmailConnections(newConns);
                            }}
                            className="absolute top-4 right-4 p-2 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all border border-transparent hover:bg-red-50 rounded-lg"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-[#667085] uppercase">Connection Name</label>
                              <input 
                                type="text"
                                value={conn.name || ''}
                                onChange={(e) => {
                                  const newConns = [...emailConnections];
                                  newConns[idx].name = e.target.value;
                                  setEmailConnections(newConns);
                                }}
                                className="w-full px-3 py-2 bg-white border border-[#D0D5DD] rounded-lg text-sm"
                                placeholder="e.g. Work Gmail"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-[#667085] uppercase">IMAP Host</label>
                              <input 
                                type="text"
                                value={conn.host || ''}
                                onChange={(e) => {
                                  const newConns = [...emailConnections];
                                  newConns[idx].host = e.target.value;
                                  setEmailConnections(newConns);
                                }}
                                className="w-full px-3 py-2 bg-white border border-[#D0D5DD] rounded-lg text-sm"
                                placeholder="imap.gmail.com"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-[#667085] uppercase">Email Address</label>
                              <input 
                                type="text"
                                value={conn.user || ''}
                                onChange={(e) => {
                                  const newConns = [...emailConnections];
                                  newConns[idx].user = e.target.value;
                                  setEmailConnections(newConns);
                                }}
                                className="w-full px-3 py-2 bg-white border border-[#D0D5DD] rounded-lg text-sm"
                                placeholder="you@domain.com"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-[#667085] uppercase">Password / App Password</label>
                              <input 
                                type="password"
                                value={conn.password || ''}
                                onChange={(e) => {
                                  const newConns = [...emailConnections];
                                  newConns[idx].password = e.target.value;
                                  setEmailConnections(newConns);
                                }}
                                className="w-full px-3 py-2 bg-white border border-[#D0D5DD] rounded-lg text-sm"
                                placeholder="••••••••••••••••"
                              />
                            </div>
                          </div>
                          
                          <div className="mt-3 flex items-center justify-between">
                            <div className="flex gap-4">
                               <div className="flex items-center gap-2">
                                 <input 
                                   type="number"
                                   value={conn.port || 993}
                                   onChange={(e) => {
                                      const newConns = [...emailConnections];
                                      newConns[idx].port = parseInt(e.target.value);
                                      setEmailConnections(newConns);
                                   }}
                                   className="w-16 px-2 py-1 bg-white border border-[#D0D5DD] rounded text-xs"
                                 />
                                 <span className="text-[10px] font-medium text-[#667085]">Port</span>
                               </div>
                               <label className="flex items-center gap-2 cursor-pointer">
                                 <input 
                                   type="checkbox"
                                   checked={conn.secure !== false}
                                   onChange={(e) => {
                                      const newConns = [...emailConnections];
                                      newConns[idx].secure = e.target.checked;
                                      setEmailConnections(newConns);
                                   }}
                                   className="w-3 h-3 rounded text-[#7F56D9]"
                                 />
                                 <span className="text-[10px] font-medium text-[#667085]">SSL</span>
                               </label>
                            </div>
                            
                            <button 
                              onClick={async () => {
                                const toastId = toast.loading(`Testing ${conn.user}...`);
                                try {
                                  const response = await apiFetch('/api/emails/sync', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ connection: conn })
                                  });
                                  const data = await response.json();
                                  if (response.ok) {
                                    toast.success(`${conn.user} connected successfully!`, { id: toastId });
                                  } else {
                                    toast.error(`Connection failed for ${conn.user}`, { description: data.error + ': ' + data.details, id: toastId });
                                  }
                                } catch (err: any) {
                                  toast.error(`Test failed: ${err.message}`, { id: toastId });
                                }
                              }}
                              className="text-[10px] font-bold text-[#7F56D9] hover:text-[#6941C6] px-3 py-1 bg-white border border-[#D0D5DD] rounded-md transition-all shadow-sm"
                            >
                              Test Connection
                            </button>
                          </div>
                        </div>
                      ))}

                      <button 
                        onClick={() => {
                          const newConn = { name: '', host: 'imap.gmail.com', user: '', password: '', port: 993, secure: true };
                          setEmailConnections([...emailConnections, newConn]);
                        }}
                        className="w-full py-3 border-2 border-dashed border-[#D0D5DD] rounded-xl text-sm font-semibold text-[#667085] hover:border-[#7F56D9] hover:text-[#7F56D9] transition-all flex items-center justify-center gap-2"
                      >
                        <Upload className="w-4 h-4 rotate-180" />
                        Add Connection
                      </button>
                    </div>

                    <div className="pt-4 border-t border-[#EAECF0]">
                      <button 
                        onClick={() => handleSaveEmailConnections(emailConnections)}
                        className="w-full py-3 bg-[#101828] text-white rounded-xl font-bold text-sm hover:bg-black transition-all"
                      >
                        Save Connections
                      </button>
                    </div>
                  </div>
                )}

                {settingsTab === 'AI' && (
                  <div className="space-y-6">
                    <div className="p-4 bg-purple-50 border border-purple-200 rounded-xl mb-4">
                      <div className="flex gap-3">
                        <Sparkles className="w-5 h-5 text-purple-600 shrink-0" />
                        <div>
                          <p className="text-xs font-bold text-purple-800 mb-1">AI Provider Configuration</p>
                          <p className="text-[11px] text-purple-700 leading-relaxed">
                            Configure which model family the app should use. Gemini can use a saved key here, while Qwen reads its API key from backend environment variables only.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-[#E4E7EC] bg-white p-4 space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h4 className="text-sm font-bold text-[#101828]">Runtime Status</h4>
                          <p className="text-[11px] text-[#667085] mt-1 leading-relaxed">
                            Current backend: <span className="font-semibold text-[#101828]">{API_BASE_URL || 'same-origin /api'}</span>
                          </p>
                          <p className="text-[11px] text-[#667085] mt-2">
                            Saved provider: <span className="font-semibold text-[#101828] uppercase">{geminiConfig.provider}</span>
                          </p>
                        </div>
                        <button
                          onClick={async () => {
                            setIsCheckingAIHealth(true);
                            try {
                              const status = await getAIHealth();
                              setAiHealthStatus(status);
                            } catch (error: any) {
                              toast.error('Failed to refresh AI health.', { description: error?.message || 'Unknown error' });
                            } finally {
                              setIsCheckingAIHealth(false);
                            }
                          }}
                          className="px-3 py-2 bg-white border border-[#D0D5DD] rounded-lg text-xs font-semibold text-[#344054] hover:bg-[#F9FAFB] transition-all"
                        >
                          {isCheckingAIHealth ? 'Checking...' : 'Refresh Status'}
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="rounded-lg border border-[#EAECF0] bg-[#F9FAFB] p-3">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-[#667085]">Default Runtime Keys</p>
                          <p className={`mt-1 text-sm font-bold ${aiHealthStatus?.configured ? 'text-[#027A48]' : 'text-[#B42318]'}`}>
                            {aiHealthStatus ? (aiHealthStatus.configured ? 'Configured' : 'Missing') : 'Unknown'}
                          </p>
                          <p className="mt-2 text-[11px] text-[#667085]">
                            Gemini env: <span className="font-semibold text-[#101828]">{aiHealthStatus?.defaultProviderConfigured?.gemini ? 'Yes' : 'No'}</span>
                            {' '}• Qwen env: <span className="font-semibold text-[#101828]">{aiHealthStatus?.defaultProviderConfigured?.qwen ? 'Yes' : 'No'}</span>
                          </p>
                          <p className="mt-2 text-[11px] text-[#667085] break-all">
                            Qwen endpoint: <span className="font-semibold text-[#101828]">{aiHealthStatus?.qwenBaseUrl || 'Unknown'}</span>
                          </p>
                        </div>
                        <div className="rounded-lg border border-[#EAECF0] bg-[#F9FAFB] p-3">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-[#667085]">Saved API Key</p>
                          <p className="mt-1 text-sm font-bold text-[#101828]">
                            {geminiConfig.provider === 'qwen'
                              ? 'Qwen uses backend env only'
                              : geminiConfig.apiKey
                                ? 'Stored in Firestore config'
                                : 'Using backend env only'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-4 rounded-lg border border-[#EAECF0] bg-[#FCFCFD] p-3">
                        <div>
                          <p className="text-sm font-semibold text-[#101828]">Runtime connectivity test</p>
                          <p className="text-[11px] text-[#667085] mt-1">
                            Run a live backend test against <span className="font-medium text-[#344054]">{getApiUrl('/api/ai/test')}</span> before deployment handoff.
                          </p>
                        </div>
                        <button
                          onClick={handleTestAIConnection}
                          disabled={isTestingAIConnection}
                          className="px-4 py-2 bg-[#101828] text-white rounded-lg text-sm font-semibold hover:bg-black transition-all disabled:opacity-60"
                        >
                          {isTestingAIConnection ? 'Testing...' : 'Test AI'}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-sm font-semibold text-[#344054]">AI Provider</label>
                        <div className="grid grid-cols-1 gap-3">
                          {[
                            { id: 'gemini', name: 'Gemini', desc: 'Google Gemini API key and Gemini model family.' },
                            { id: 'qwen', name: 'Qwen', desc: 'Alibaba Cloud DashScope compatible API for Qwen models. API key is managed in backend env.' }
                          ].map((provider) => (
                            <button
                              key={provider.id}
                              onClick={() => {
                                const nextProvider = provider.id as 'gemini' | 'qwen';
                                setGeminiConfig({
                                  ...geminiConfig,
                                  provider: nextProvider,
                                  model: getDefaultAIModel(nextProvider),
                                  apiKey: nextProvider === 'qwen' ? '' : geminiConfig.apiKey
                                });
                              }}
                              className={`p-4 rounded-xl border-2 text-left transition-all ${
                                geminiConfig.provider === provider.id
                                  ? 'border-[#7F56D9] bg-[#F9F5FF]'
                                  : 'border-[#EAECF0] hover:border-[#D0D5DD]'
                              }`}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-bold text-[#101828]">{provider.name}</span>
                                {geminiConfig.provider === provider.id && <CheckCircle className="w-4 h-4 text-[#7F56D9]" />}
                              </div>
                              <p className="text-[11px] text-[#667085] leading-tight">{provider.desc}</p>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-sm font-semibold text-[#344054]">Model Selection</label>
                        <div className="grid grid-cols-1 gap-3">
                          {AI_MODELS_BY_PROVIDER[geminiConfig.provider].map((m) => (
                            <button
                              key={m.id}
                              onClick={() => setGeminiConfig({...geminiConfig, model: m.id})}
                              className={`p-4 rounded-xl border-2 text-left transition-all ${
                                geminiConfig.model === m.id 
                                  ? 'border-[#7F56D9] bg-[#F9F5FF]' 
                                  : 'border-[#EAECF0] hover:border-[#D0D5DD]'
                              }`}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-bold text-[#101828]">{m.name}</span>
                                {geminiConfig.model === m.id && <CheckCircle className="w-4 h-4 text-[#7F56D9]" />}
                              </div>
                              <p className="text-[11px] text-[#667085] leading-tight">{m.desc}</p>
                            </button>
                          ))}
                        </div>
                      </div>

                      {geminiConfig.provider === 'gemini' ? (
                        <div className="space-y-1.5">
                          <label className="text-sm font-semibold text-[#344054]">API Key</label>
                          <input
                            type="password"
                            value={geminiConfig.apiKey || ''}
                            onChange={(e) => setGeminiConfig({ ...geminiConfig, apiKey: e.target.value })}
                            className="w-full px-3 py-2 bg-white border border-[#D0D5DD] rounded-lg text-sm"
                            placeholder="Enter Gemini API key"
                          />
                          <p className="text-[11px] text-[#667085]">
                            Leave this empty if you want to keep using backend environment variables. If you fill it here, it will be saved to Firestore config for admin-controlled runtime use.
                          </p>
                        </div>
                      ) : (
                        <div className="rounded-xl border border-[#D0D5DD] bg-[#F9FAFB] p-4">
                          <p className="text-sm font-semibold text-[#344054]">Qwen API Key</p>
                          <p className="mt-1 text-[11px] text-[#667085] leading-relaxed">
                            Qwen API access is managed from backend environment variables only. Set <span className="font-semibold text-[#344054]">QWEN_API_KEY</span> or <span className="font-semibold text-[#344054]">DASHSCOPE_API_KEY</span> on the server, then choose the model here.
                          </p>
                        </div>
                      )}

                      <label className="flex items-center gap-3 p-3 bg-[#F9FAFB] border border-[#D0D5DD] rounded-xl cursor-pointer hover:bg-[#F2F4F7] transition-all">
                        <input
                          type="checkbox"
                          checked={geminiConfig.autoClassifyOnSync ?? false}
                          onChange={(e) => setGeminiConfig({ ...geminiConfig, autoClassifyOnSync: e.target.checked })}
                          className="w-4 h-4 rounded border-[#D0D5DD] text-[#7F56D9] focus:ring-[#7F56D9]"
                        />
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-[#344054]">Auto AI classify on sync</p>
                          <p className="text-[11px] text-[#667085]">When enabled, every newly synced email will immediately run through the current AI model. Keep this off if you want to save quota.</p>
                        </div>
                      </label>
                    </div>

                    <div className="pt-4 border-t border-[#EAECF0]">
                      <button 
                        onClick={handleSaveGeminiSettings}
                        className="w-full py-3 bg-[#7F56D9] text-white rounded-xl font-bold text-sm hover:bg-[#6941C6] transition-all"
                      >
                        Save AI Configuration
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Template Detail/Edit Modal */}
      <AnimatePresence>
        {selectedTemplate && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[#0C111D]/70 backdrop-blur-sm z-50 flex items-center justify-center p-0 md:p-6"
          >
            <motion.div 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              className="bg-white w-full h-full md:h-auto md:max-h-[90vh] md:rounded-2xl shadow-2xl border border-[#EAECF0] flex flex-col overflow-hidden"
            >
              {/* Modal Header */}
              <div className="px-6 py-4 border-b border-[#EAECF0] bg-white flex items-center justify-between sticky top-0 z-10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#F9F5FF] rounded-lg flex items-center justify-center">
                    <FileText className="text-[#7F56D9] w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-[#101828]">{selectedTemplate.referenceNumber}</h3>
                    <p className="text-xs text-[#475467]">{selectedTemplate.templateType?.replace('_', ' ')} Record</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!isEditingTemplate && (isAdmin || allowUserEditTemplates) && (
                    <button 
                      onClick={() => {
                        setEditData(selectedTemplate.data || {});
                        setIsEditingTemplate(true);
                      }}
                      className="px-4 py-2 bg-white border border-[#D0D5DD] rounded-lg text-sm font-semibold text-[#344054] hover:bg-[#F9FAFB] transition-all flex items-center gap-2"
                    >
                      <Settings className="w-4 h-4" />
                      Edit
                    </button>
                  )}
                  <button 
                    onClick={() => { setSelectedTemplate(null); setIsEditingTemplate(false); }} 
                    className="p-2 text-[#667085] hover:bg-[#F9FAFB] rounded-lg transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto p-6 md:p-8">
                {isEditingTemplate ? (
                  <div className="max-w-4xl mx-auto space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-[#344054] uppercase tracking-wider">Project Name</label>
                        <input 
                          type="text" 
                          value={editData.projectName || ''} 
                          onChange={(e) => setEditData({ ...editData, projectName: e.target.value })}
                          className="w-full px-4 py-3 border border-[#D0D5DD] rounded-xl text-sm focus:ring-4 focus:ring-[#F4EBFF] focus:border-[#7F56D9] outline-none transition-all"
                          placeholder="Enter project name"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-[#344054] uppercase tracking-wider">Client Name</label>
                        <input 
                          type="text" 
                          value={editData.clientName || ''} 
                          onChange={(e) => setEditData({ ...editData, clientName: e.target.value })}
                          className="w-full px-4 py-3 border border-[#D0D5DD] rounded-xl text-sm focus:ring-4 focus:ring-[#F4EBFF] focus:border-[#7F56D9] outline-none transition-all"
                          placeholder="Enter client contact name"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-[#344054] uppercase tracking-wider">Client Organization</label>
                        <input 
                          type="text" 
                          value={editData.clientOrganization || ''} 
                          onChange={(e) => setEditData({ ...editData, clientOrganization: e.target.value })}
                          className="w-full px-4 py-3 border border-[#D0D5DD] rounded-xl text-sm focus:ring-4 focus:ring-[#F4EBFF] focus:border-[#7F56D9] outline-none transition-all"
                          placeholder="Enter company name"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-[#344054] uppercase tracking-wider">Client Email</label>
                        <input 
                          type="text" 
                          value={editData.clientEmail || ''} 
                          onChange={(e) => setEditData({ ...editData, clientEmail: e.target.value })}
                          className="w-full px-4 py-3 border border-[#D0D5DD] rounded-xl text-sm focus:ring-4 focus:ring-[#F4EBFF] focus:border-[#7F56D9] outline-none transition-all"
                          placeholder="Enter client email"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-[#344054] uppercase tracking-wider">Deadline</label>
                        <input 
                          type="text" 
                          value={editData.deadline || ''} 
                          onChange={(e) => setEditData({ ...editData, deadline: e.target.value })}
                          className="w-full px-4 py-3 border border-[#D0D5DD] rounded-xl text-sm focus:ring-4 focus:ring-[#F4EBFF] focus:border-[#7F56D9] outline-none transition-all"
                          placeholder="e.g. 2024-12-31"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-[#344054] uppercase tracking-wider">Location</label>
                        <input 
                          type="text" 
                          value={editData.location || ''} 
                          onChange={(e) => setEditData({ ...editData, location: e.target.value })}
                          className="w-full px-4 py-3 border border-[#D0D5DD] rounded-xl text-sm focus:ring-4 focus:ring-[#F4EBFF] focus:border-[#7F56D9] outline-none transition-all"
                          placeholder="Enter location"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-[#344054] uppercase tracking-wider">Additional Details</label>
                      <textarea 
                        rows={6}
                        value={editData.details || ''} 
                        onChange={(e) => setEditData({ ...editData, details: e.target.value })}
                        className="w-full px-4 py-3 border border-[#D0D5DD] rounded-xl text-sm focus:ring-4 focus:ring-[#F4EBFF] focus:border-[#7F56D9] outline-none transition-all resize-none"
                        placeholder="Enter any additional information..."
                      />
                    </div>
                  </div>
                ) : (
                  <div className="max-w-4xl mx-auto space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      <DataField label="Project Name" value={selectedTemplate.data?.projectName} icon={<Briefcase className="w-4 h-4" />} />
                      <DataField label="Client Name" value={selectedTemplate.data?.clientName} icon={<User className="w-4 h-4" />} />
                      <DataField label="Client Organization" value={selectedTemplate.data?.clientOrganization} icon={<Users className="w-4 h-4" />} />
                      <DataField label="Client Email" value={selectedTemplate.data?.clientEmail} icon={<Mail className="w-4 h-4" />} />
                      <DataField label="Deadline" value={selectedTemplate.data?.deadline} icon={<Clock className="w-4 h-4" />} />
                      <DataField label="Location" value={selectedTemplate.data?.location} icon={<Home className="w-4 h-4" />} />
                      <DataField label="Status" value={selectedTemplate.status} icon={<CheckCircle className="w-4 h-4" />} />
                      <DataField label="Assigned To" value={selectedTemplate.assignedTo} icon={<Users className="w-4 h-4" />} />
                    </div>

                    {selectedTemplate.data?.details && (
                      <div className="p-6 bg-[#F9FAFB] rounded-2xl border border-[#EAECF0]">
                        <h4 className="text-xs font-bold text-[#344054] uppercase tracking-wider mb-4">Additional Details</h4>
                        <p className="text-sm text-[#475467] leading-relaxed whitespace-pre-wrap">{selectedTemplate.data.details}</p>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="p-6 bg-white rounded-2xl border border-[#EAECF0] shadow-sm">
                        <h4 className="text-xs font-bold text-[#344054] uppercase tracking-wider mb-4">Metadata</h4>
                        <div className="space-y-3">
                          <div className="flex justify-between text-xs">
                            <span className="text-[#667085]">Created At</span>
                            <span className="text-[#101828] font-medium">{new Date(selectedTemplate.createdAt).toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-[#667085]">Reference ID</span>
                            <span className="text-[#101828] font-medium">{selectedTemplate.id}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 border-t border-[#EAECF0] bg-white sticky bottom-0 z-10">
                <div className="max-w-4xl mx-auto flex gap-3">
                  <button 
                    onClick={() => { setSelectedTemplate(null); setIsEditingTemplate(false); }}
                    className="flex-1 px-4 py-2.5 border border-[#D0D5DD] rounded-lg text-sm font-semibold text-[#344054] hover:bg-[#F9FAFB] transition-all"
                  >
                    {isEditingTemplate ? 'Cancel' : 'Close'}
                  </button>
                  {isEditingTemplate ? (
                    <button 
                      onClick={handleSaveTemplateEdit}
                      className="flex-1 bg-[#7F56D9] text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#6941C6] transition-all shadow-sm shadow-purple-100"
                    >
                      Save Changes
                    </button>
                  ) : (
                    <div className="flex-1 flex gap-3">
                      {(isAdmin || auth.currentUser?.email === selectedTemplate.assignedTo) && (
                        <button 
                          onClick={() => {
                            handleDeleteTemplate(selectedTemplate.id);
                            setSelectedTemplate(null);
                          }}
                          className="px-4 py-2.5 border border-[#FDA29B] text-[#B42318] rounded-lg text-sm font-semibold hover:bg-[#FEF3F2] transition-all flex items-center justify-center gap-2"
                        >
                          <Trash2 className="w-4 h-4" />
                          Delete
                        </button>
                      )}
                      {selectedTemplate.status !== 'AWARDED' && (
                        <button 
                          onClick={() => {
                            const nextStatus = 
                              selectedTemplate.status === 'OPPORTUNITIES' ? 'REQUEST' : 
                              selectedTemplate.status === 'REQUEST' ? 'SUBMITTED' : 'AWARDED';
                            handleUpdateTemplateStatus(selectedTemplate.id, nextStatus);
                            setSelectedTemplate(null);
                          }}
                          className="flex-1 bg-[#7F56D9] text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#6941C6] transition-all shadow-sm shadow-purple-100"
                        >
                          Promote to {
                            selectedTemplate.status === 'OPPORTUNITIES' ? 'Request' : 
                            selectedTemplate.status === 'REQUEST' ? 'Submitted' : 'Awarded'
                          }
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}

        {isAccountModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[#0c111d]/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              className="bg-white rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden border border-[#EAECF0]"
            >
              <div className="p-8 border-b border-[#EAECF0] flex items-center justify-between bg-gradient-to-r from-white to-[#F9F5FF]">
                <div>
                  <h3 className="text-xl font-bold text-[#101828]">{editingAccount ? 'Edit VIP Account' : 'Register New VIP'}</h3>
                  <p className="text-sm text-[#667085]">Define strategic relationship parameters and metadata.</p>
                </div>
                <button 
                  onClick={() => setIsAccountModalOpen(false)}
                  className="p-2 hover:bg-[#F9FAFB] rounded-xl transition-all"
                >
                  <X className="w-5 h-5 text-[#98A2B3]" />
                </button>
              </div>

              <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2 col-span-2">
                    <label className="text-xs font-black text-[#475467] uppercase tracking-widest pl-1">Account Name</label>
                    <input 
                      type="text"
                      value={accountForm.name || ''}
                      onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
                      placeholder="Enter company name..."
                      className="w-full px-4 py-3 bg-[#F9FAFB] border border-[#EAECF0] rounded-2xl text-sm focus:ring-4 focus:ring-[#7F56D9]/10 focus:border-[#7F56D9] transition-all outline-none font-medium"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-black text-[#475467] uppercase tracking-widest pl-1">Industry vertical</label>
                    <input 
                      type="text"
                      value={accountForm.industry || ''}
                      onChange={(e) => setAccountForm({ ...accountForm, industry: e.target.value })}
                      placeholder="e.g. Construction, Finance..."
                      className="w-full px-4 py-3 bg-[#F9FAFB] border border-[#EAECF0] rounded-2xl text-sm focus:ring-4 focus:ring-[#7F56D9]/10 focus:border-[#7F56D9] transition-all outline-none font-medium"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-black text-[#475467] uppercase tracking-widest pl-1">Strategic Tier</label>
                    <select 
                      value={accountForm.tier || 'standard'}
                      onChange={(e) => setAccountForm({ ...accountForm, tier: e.target.value as Account['tier'] })}
                      className="w-full px-4 py-3 bg-[#F9FAFB] border border-[#EAECF0] rounded-2xl text-sm focus:ring-4 focus:ring-[#7F56D9]/10 focus:border-[#7F56D9] transition-all outline-none font-medium appearance-none"
                    >
                      <option value="standard">Standard Account</option>
                      <option value="priority">Priority Hub</option>
                      <option value="strategic">Strategic VIP</option>
                    </select>
                  </div>

                  <div className="space-y-2 col-span-2">
                    <label className="text-xs font-black text-[#475467] uppercase tracking-widest pl-1">Account Owner (isBIM Staff)</label>
                    <select 
                      value={accountForm.owner_id || ''}
                      onChange={(e) => setAccountForm({ ...accountForm, owner_id: e.target.value })}
                      className="w-full px-4 py-3 bg-[#F9FAFB] border border-[#EAECF0] rounded-2xl text-sm focus:ring-4 focus:ring-[#7F56D9]/10 focus:border-[#7F56D9] transition-all outline-none font-medium appearance-none"
                    >
                      {allUsers.map(user => (
                        <option key={user.uid} value={user.uid}>
                          {user.displayName} ({user.email}) - {user.role.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="pt-4 border-t border-[#EAECF0] space-y-4">
                  <h4 className="text-sm font-bold text-[#101828] flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#7F56D9]" />
                    Primary Stakeholder Contact
                  </h4>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-[10px] font-black text-[#98A2B3] uppercase tracking-widest pl-1">Full Name</label>
                      <input 
                        type="text"
                        value={accountForm.primary_contact_name || ''}
                        onChange={(e) => setAccountForm({ ...accountForm, primary_contact_name: e.target.value })}
                        className="w-full px-4 py-2.5 bg-[#F9FAFB] border border-[#EAECF0] rounded-xl text-sm outline-none focus:border-[#7F56D9] transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-[#98A2B3] uppercase tracking-widest pl-1">Email Address</label>
                      <input 
                        type="email"
                        value={accountForm.primary_contact_email || ''}
                        onChange={(e) => setAccountForm({ ...accountForm, primary_contact_email: e.target.value })}
                        className="w-full px-4 py-2.5 bg-[#F9FAFB] border border-[#EAECF0] rounded-xl text-sm outline-none focus:border-[#7F56D9] transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-[#98A2B3] uppercase tracking-widest pl-1">Mobile Number</label>
                      <input 
                        type="text"
                        value={accountForm.primary_contact_mobile || ''}
                        onChange={(e) => setAccountForm({ ...accountForm, primary_contact_mobile: e.target.value })}
                        className="w-full px-4 py-2.5 bg-[#F9FAFB] border border-[#EAECF0] rounded-xl text-sm outline-none focus:border-[#7F56D9] transition-all"
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-[10px] font-black text-[#98A2B3] uppercase tracking-widest pl-1">Position / Role</label>
                      <input 
                        type="text"
                        value={accountForm.primary_contact_position || ''}
                        onChange={(e) => setAccountForm({ ...accountForm, primary_contact_position: e.target.value })}
                        className="w-full px-4 py-2.5 bg-[#F9FAFB] border border-[#EAECF0] rounded-xl text-sm outline-none focus:border-[#7F56D9] transition-all"
                        placeholder="e.g. Procurement Lead, Project Manager"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-8 bg-[#F9FAFB] border-t border-[#EAECF0] flex gap-3">
                <button 
                  onClick={() => setIsAccountModalOpen(false)}
                  className="flex-1 py-3 border border-[#D0D5DD] text-[#344054] rounded-2xl text-sm font-bold hover:bg-white transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleAccountSubmit}
                  className="flex-[2] py-3 bg-[#7F56D9] text-white rounded-2xl text-sm font-bold shadow-lg shadow-purple-100 hover:bg-[#6941C6] transition-all flex items-center justify-center gap-2"
                >
                  {editingAccount ? <RefreshCw className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  {editingAccount ? 'Update Strategic VIP' : 'Register VIP Account'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <CommandPalette 
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onAction={handleCommandPaletteAction}
      />
    </>
  );
}

function StatCard({ title, value, icon, trend }: { title: string, value: string | number, icon: React.ReactNode, trend?: string }) {
  return (
    <div className="bg-white p-6 rounded-2xl border border-[#EAECF0] shadow-sm hover:shadow-md transition-all group">
      <div className="flex items-center justify-between mb-4">
        <div className="w-12 h-12 bg-[#F9FAFB] rounded-xl flex items-center justify-center group-hover:bg-[#F9F5FF] transition-colors">
          {icon}
        </div>
        {trend && (
          <div className="flex items-center gap-1 px-2 py-1 bg-[#ECFDF3] rounded-full">
            <ArrowUpRight className="w-3 h-3 text-[#027A48]" />
            <span className="text-[10px] font-bold text-[#027A48]">{trend}</span>
          </div>
        )}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-[#667085]">{title}</p>
        <h3 className="text-2xl font-bold text-[#101828]">{value}</h3>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthGuard>
      <Toaster position="top-right" richColors />
      <BOSApp />
    </AuthGuard>
  );
}

function NavItem({ icon, label, active, onClick, badge, status, hasSubmenu }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void, badge?: number, status?: string, hasSubmenu?: boolean }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold transition-all group ${active ? 'bg-[#F9F5FF] text-[#7F56D9]' : 'text-[#344054] hover:bg-[#F9FAFB]'}`}
    >
      <span className={`${active ? 'text-[#7F56D9]' : 'text-[#667085] group-hover:text-[#344054]'}`}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="px-2 py-0.5 bg-[#F9F5FF] text-[#7F56D9] border border-[#E9D7FE] rounded-full text-[10px] font-bold">
          {badge}
        </span>
      )}
      {status && (
        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-[#ECFDF3] border border-[#ABEFC6] rounded-full">
          <div className="w-1.5 h-1.5 bg-[#12B76A] rounded-full" />
          <span className="text-[10px] font-bold text-[#027A48]">{status}</span>
        </div>
      )}
      {hasSubmenu && (
        <ChevronRight className={`w-4 h-4 transition-transform ${active ? 'rotate-90' : ''}`} />
      )}
    </button>
  );
}

function SubNavItem({ label, active, onClick, icon }: { label: string, active?: boolean, onClick: () => void, icon?: React.ReactNode }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${active ? 'text-[#7F56D9] bg-[#F9F5FF]' : 'text-[#475467] hover:bg-[#F9FAFB]'}`}
    >
      {icon ? (
        <span className={`${active ? 'text-[#7F56D9]' : 'text-[#98A2B3]'}`}>{icon}</span>
      ) : (
        <div className={`w-1 h-1 rounded-full ${active ? 'bg-[#7F56D9]' : 'bg-[#D0D5DD]'}`} />
      )}
      {label}
    </button>
  );
}

function DataField({ label, value, icon }: { label: string, value?: string, icon: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-[#475467] flex items-center gap-2">
        {icon}
        {label}
      </label>
      <div className="px-4 py-2.5 bg-[#F9FAFB] border border-[#EAECF0] rounded-lg text-sm font-medium text-[#101828] min-h-[40px] flex items-center">
        {value || <span className="text-[#98A2B3] italic">Not detected</span>}
      </div>
    </div>
  );
}
