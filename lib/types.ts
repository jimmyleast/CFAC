export interface ProcessStep {
  id: number
  name: string
  action: string
  owner: string
  tool: string
  duration: string
  isDecision: boolean
  handoffTo?: string
  exceptionPath?: string
}

export interface ProcessRole {
  name: string
  raci: 'R' | 'A' | 'C' | 'I'
  department: string
}

export interface ProcessDecision {
  question: string
  yes: string
  no: string
  approvalRequired?: boolean
  bottleneck?: boolean
}

export interface SystemNode {
  id: string
  name: string
  type: 'software' | 'database' | 'service' | 'manual' | 'other'
  owner: string
  description: string
  usedInSteps: number[]
}

export interface Integration {
  from: string
  to: string
  type: 'api' | 'manual' | 'file' | 'email' | 'webhook' | 'other'
  description: string
  isGap: boolean
}

export interface ArchitectureNotes {
  summary: string
  gaps: string[]
  recommendations: string[]
  automationOpportunities: string[]
}

export interface DACIRole {
  decision: string
  driver: string
  approver: string
  contributors: string[]
  informed: string[]
}

export interface SOPData {
  processName: string
  owner: string
  division: string
  category: string
  purpose: string
  scope: string
  steps: ProcessStep[]
  roles: ProcessRole[]
  decisions: ProcessDecision[]
  daciRoles: DACIRole[]
  systems: SystemNode[]
  integrations: Integration[]
  architectureNotes: ArchitectureNotes
  dependencies: string[]
  followups: string[]
  kpis: string[]
  phase: number
  completion: number
}

export interface Process {
  id: string
  name: string
  owner: string | null
  division: string | null
  category: string | null
  status: 'draft' | 'in_progress' | 'complete' | 'archived'
  phase: number
  completion: number
  created_by: string
  created_at: string
  updated_at: string
}

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface UserProfile {
  id: string
  email: string
  display_name: string | null
  is_admin: boolean
  created_at: string
  updated_at: string
}

export interface Squad {
  id: string
  name: string
  description: string | null
  area: string | null
  color: string
  created_by: string | null
  created_at: string
  updated_at: string
  member_count?: number
}

export interface SquadMember {
  id: string
  squad_id: string
  user_id: string
  role: 'lead' | 'member'
  created_at: string
  user?: UserProfile
  squad?: Squad
}

export interface ProcessWithSquad extends Process {
  squad_id: string | null
  squad?: Squad | null
}
