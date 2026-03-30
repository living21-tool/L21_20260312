export type EmployeeRole = 'admin' | 'verwaltung' | 'hausmeister' | 'reinigung'

export type L21TaskStatus = 'offen' | 'in_bearbeitung' | 'wartet' | 'erledigt'
export type L21TaskPriority = 'niedrig' | 'mittel' | 'hoch'
export type L21ConversationType = 'direct' | 'task'

export interface EmployeeProfile {
  id: string
  fullName: string
  email: string
  role: EmployeeRole
  avatarColor?: string
  initials?: string
  isActive: boolean
  createdAt?: string
}

export interface L21Task {
  id: string
  title: string
  description: string
  status: L21TaskStatus
  priority: L21TaskPriority
  dueDate: string
  createdBy: string
  assigneeId: string
  propertyId?: string
  locationId?: string
  unitLabel?: string
  conversationId?: string
  archivedAt?: string
  archivedBy?: string
  createdAt: string
}

export interface L21TaskComment {
  id: string
  taskId: string
  authorId: string
  body: string
  createdAt: string
}

export interface L21Conversation {
  id: string
  title: string
  type: L21ConversationType
  participantIds: string[]
  taskId?: string
  updatedAt: string
  directKey?: string | null
}

export interface L21Message {
  id: string
  conversationId: string
  authorId: string
  body: string
  createdAt: string
}
