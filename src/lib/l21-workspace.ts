'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { EmployeeProfile, L21Conversation, L21Message, L21Task, L21TaskComment, L21TaskStatus } from './l21-types'
import { useAuthProfile } from './auth-client'

function mapProfile(row: Record<string, unknown>): EmployeeProfile {
  const fullName = (row.full_name as string | null) ?? ''

  return {
    id: row.id as string,
    fullName,
    email: (row.email as string | null) ?? '',
    role: row.role as EmployeeProfile['role'],
    avatarColor: (row.avatar_color as string | null) ?? undefined,
    initials: fullName
      .split(' ')
      .map(part => part[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase(),
    isActive: Boolean(row.is_active),
    createdAt: (row.created_at as string | null) ?? undefined,
  }
}

function mapTask(row: Record<string, unknown>): L21Task {
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? '',
    status: row.status as L21Task['status'],
    priority: row.priority as L21Task['priority'],
    dueDate: ((row.due_at as string | null) ?? '').slice(0, 10),
    createdBy: row.created_by as string,
    assigneeId: row.assignee_id as string,
    propertyId: (row.property_id as string | null) ?? undefined,
    locationId: (row.location_id as string | null) ?? undefined,
    unitLabel: (row.unit_label as string | null) ?? undefined,
    conversationId: (row.conversation_id as string | null) ?? undefined,
    archivedAt: (row.archived_at as string | null) ?? undefined,
    archivedBy: (row.archived_by as string | null) ?? undefined,
    createdAt: row.created_at as string,
  }
}

function mapTaskComment(row: Record<string, unknown>): L21TaskComment {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    authorId: row.author_id as string,
    body: row.body as string,
    createdAt: row.created_at as string,
  }
}

function mapConversation(row: Record<string, unknown>, participantIds: string[]): L21Conversation {
  return {
    id: row.id as string,
    title: row.title as string,
    type: row.type as L21Conversation['type'],
    participantIds,
    taskId: (row.task_id as string | null) ?? undefined,
    updatedAt: row.updated_at as string,
    directKey: (row.direct_key as string | null) ?? null,
  }
}

function mapMessage(row: Record<string, unknown>): L21Message {
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    authorId: row.author_id as string,
    body: row.body as string,
    createdAt: row.created_at as string,
  }
}

function sortConversationsByUpdatedAt(items: L21Conversation[]) {
  return [...items].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

function applyTaskPatch(task: L21Task, updates: Partial<L21Task>) {
  return {
    ...task,
    ...updates,
  }
}

export function useL21Workspace() {
  const auth = useAuthProfile()
  const [loading, setLoading] = useState(true)
  const [profiles, setProfiles] = useState<EmployeeProfile[]>([])
  const [tasks, setTasks] = useState<L21Task[]>([])
  const [taskComments, setTaskComments] = useState<L21TaskComment[]>([])
  const [conversations, setConversations] = useState<L21Conversation[]>([])
  const [messages, setMessages] = useState<L21Message[]>([])
  const loadPromiseRef = useRef<Promise<void> | null>(null)
  const reloadQueuedRef = useRef(false)
  const reloadTimerRef = useRef<number | null>(null)

  const loadWorkspace = useCallback(async () => {
    const currentProfile = auth.profile

    if (!currentProfile) {
      setProfiles([])
      setTasks([])
      setTaskComments([])
      setConversations([])
      setMessages([])
      setLoading(false)
      return
    }

    if (loadPromiseRef.current) {
      reloadQueuedRef.current = true
      await loadPromiseRef.current
      return
    }

    setLoading(true)

    loadPromiseRef.current = (async () => {
      const [{ data: profilesData }, { data: tasksData }, { data: memberRows }] = await Promise.all([
        supabase.from('profiles').select('*').order('full_name'),
        auth.isAdmin
          ? supabase.from('tasks').select('*').order('created_at', { ascending: false })
          : supabase.from('tasks').select('*').eq('assignee_id', currentProfile.id).order('created_at', { ascending: false }),
        auth.isAdmin
          ? supabase.from('conversation_members').select('conversation_id, profile_id')
          : supabase.from('conversation_members').select('conversation_id, profile_id').eq('profile_id', currentProfile.id),
      ])

      const conversationIds = Array.from(new Set((memberRows ?? []).map(row => row.conversation_id as string)))
      const taskIds = Array.from(new Set((tasksData ?? []).map(row => row.id as string)))
      const [conversationsResult, allConversationMembers, messagesResult, taskCommentsResult] = await Promise.all([
        conversationIds.length > 0
          ? supabase.from('conversations').select('*').in('id', conversationIds).order('updated_at', { ascending: false })
          : Promise.resolve({ data: [] as Record<string, unknown>[] }),
        conversationIds.length > 0
          ? supabase.from('conversation_members').select('conversation_id, profile_id').in('conversation_id', conversationIds)
          : Promise.resolve({ data: [] as Record<string, unknown>[] }),
        conversationIds.length > 0
          ? supabase.from('messages').select('*').in('conversation_id', conversationIds).order('created_at')
          : Promise.resolve({ data: [] as Record<string, unknown>[] }),
        taskIds.length > 0
          ? supabase.from('task_comments').select('*').in('task_id', taskIds).order('created_at')
          : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      ])

      const participantMap = new Map<string, string[]>()
      for (const row of allConversationMembers.data ?? []) {
        const conversationId = row.conversation_id as string
        const list = participantMap.get(conversationId) ?? []
        list.push(row.profile_id as string)
        participantMap.set(conversationId, list)
      }

      setProfiles((profilesData ?? []).map(mapProfile))
      setTasks((tasksData ?? []).map(mapTask))
      setTaskComments((taskCommentsResult.data ?? []).map(mapTaskComment))
      setConversations(sortConversationsByUpdatedAt((conversationsResult.data ?? []).map(row => mapConversation(row, participantMap.get(row.id as string) ?? []))))
      setMessages((messagesResult.data ?? []).map(mapMessage))
    })()

    try {
      await loadPromiseRef.current
    } finally {
      loadPromiseRef.current = null
      setLoading(false)

      if (reloadQueuedRef.current) {
        reloadQueuedRef.current = false
        void loadWorkspace()
      }
    }
  }, [auth.isAdmin, auth.profile])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadWorkspace()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadWorkspace])

  useEffect(() => {
    if (!auth.profile) {
      return
    }

    const scheduleReload = () => {
      if (reloadTimerRef.current !== null) {
        window.clearTimeout(reloadTimerRef.current)
      }

      reloadTimerRef.current = window.setTimeout(() => {
        reloadTimerRef.current = null
        void loadWorkspace()
      }, 150)
    }

    const channel = supabase
      .channel(`l21-workspace-${auth.profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_comments' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, scheduleReload)
      .subscribe()

    return () => {
      if (reloadTimerRef.current !== null) {
        window.clearTimeout(reloadTimerRef.current)
        reloadTimerRef.current = null
      }
      void supabase.removeChannel(channel)
    }
  }, [auth.profile, loadWorkspace])

  const updateTaskStatus = useCallback(async (taskId: string, status: L21TaskStatus) => {
    const previousTasks = tasks
    setTasks(current => current.map(task => task.id === taskId ? applyTaskPatch(task, { status }) : task))

    const { error } = await supabase.from('tasks').update({ status }).eq('id', taskId)

    if (error) {
      setTasks(previousTasks)
      throw error
    }
  }, [tasks])

  const updateTask = useCallback(async (taskId: string, updates: Partial<{
    title: string
    description: string
    status: L21Task['status']
    priority: L21Task['priority']
    dueDate: string
    assigneeId: string
    propertyId: string | null
    locationId: string | null
    unitLabel: string | null
  }>) => {
    const payload: Record<string, string | null> = {}

    if (updates.title !== undefined) payload.title = updates.title
    if (updates.description !== undefined) payload.description = updates.description
    if (updates.status !== undefined) payload.status = updates.status
    if (updates.priority !== undefined) payload.priority = updates.priority
    if (updates.dueDate !== undefined) payload.due_at = new Date(`${updates.dueDate}T10:00:00`).toISOString()
    if (updates.assigneeId !== undefined) payload.assignee_id = updates.assigneeId
    if (updates.propertyId !== undefined) payload.property_id = updates.propertyId
    if (updates.locationId !== undefined) payload.location_id = updates.locationId
    if (updates.unitLabel !== undefined) payload.unit_label = updates.unitLabel

    const previousTasks = tasks
    setTasks(current => current.map(task => task.id === taskId ? applyTaskPatch(task, {
      title: updates.title ?? task.title,
      description: updates.description ?? task.description,
      status: updates.status ?? task.status,
      priority: updates.priority ?? task.priority,
      dueDate: updates.dueDate ?? task.dueDate,
      assigneeId: updates.assigneeId ?? task.assigneeId,
      propertyId: updates.propertyId === undefined ? task.propertyId : updates.propertyId ?? undefined,
      locationId: updates.locationId === undefined ? task.locationId : updates.locationId ?? undefined,
      unitLabel: updates.unitLabel === undefined ? task.unitLabel : updates.unitLabel ?? undefined,
    }) : task))

    const { error } = await supabase.from('tasks').update(payload).eq('id', taskId)

    if (error) {
      setTasks(previousTasks)
      throw error
    }
  }, [tasks])

  const archiveTask = useCallback(async (taskId: string) => {
    if (!auth.profile) {
      throw new Error('Nicht angemeldet.')
    }

    const currentProfile = auth.profile
    const archivedAt = new Date().toISOString()
    const previousTasks = tasks
    setTasks(current => current.map(task => task.id === taskId
      ? applyTaskPatch(task, { archivedAt, archivedBy: currentProfile.id })
      : task))

    const { error } = await supabase
      .from('tasks')
      .update({ archived_at: archivedAt, archived_by: currentProfile.id })
      .eq('id', taskId)

    if (error) {
      setTasks(previousTasks)
      throw error
    }
  }, [auth.profile, tasks])

  const unarchiveTask = useCallback(async (taskId: string) => {
    const previousTasks = tasks
    setTasks(current => current.map(task => task.id === taskId
      ? applyTaskPatch(task, { archivedAt: undefined, archivedBy: undefined })
      : task))

    const { error } = await supabase
      .from('tasks')
      .update({ archived_at: null, archived_by: null })
      .eq('id', taskId)

    if (error) {
      setTasks(previousTasks)
      throw error
    }
  }, [tasks])

  const deleteTask = useCallback(async (taskId: string) => {
    const previousTasks = tasks
    const previousComments = taskComments
    setTasks(current => current.filter(task => task.id !== taskId))
    setTaskComments(current => current.filter(comment => comment.taskId !== taskId))

    const { error } = await supabase.from('tasks').delete().eq('id', taskId)

    if (error) {
      setTasks(previousTasks)
      setTaskComments(previousComments)
      throw error
    }
  }, [taskComments, tasks])

  const addTaskComment = useCallback(async (taskId: string, body: string) => {
    if (!auth.profile || !body.trim()) {
      return
    }

    const currentProfile = auth.profile
    const trimmedBody = body.trim()
    const optimisticComment: L21TaskComment = {
      id: `optimistic-${crypto.randomUUID()}`,
      taskId,
      authorId: currentProfile.id,
      body: trimmedBody,
      createdAt: new Date().toISOString(),
    }

    setTaskComments(current => [...current, optimisticComment])

    const { data, error } = await supabase.from('task_comments').insert({
      task_id: taskId,
      author_id: currentProfile.id,
      body: trimmedBody,
    }).select('*').single()

    if (error) {
      setTaskComments(current => current.filter(comment => comment.id !== optimisticComment.id))
      throw error
    }

    if (data) {
      const confirmedComment = mapTaskComment(data)
      setTaskComments(current => current.map(comment => comment.id === optimisticComment.id ? confirmedComment : comment))
    }
  }, [auth.profile])

  const deleteTaskComment = useCallback(async (commentId: string) => {
    const previousComments = taskComments
    setTaskComments(current => current.filter(comment => comment.id !== commentId))

    const { error } = await supabase.from('task_comments').delete().eq('id', commentId)

    if (error) {
      setTaskComments(previousComments)
      throw error
    }
  }, [taskComments])

  const sendMessage = useCallback(async (conversationId: string, body: string) => {
    if (!auth.profile || !body.trim()) {
      return
    }

    const currentProfile = auth.profile
    const trimmedBody = body.trim()
    const optimisticId = `optimistic-${crypto.randomUUID()}`
    const optimisticCreatedAt = new Date().toISOString()
    const optimisticMessage: L21Message = {
      id: optimisticId,
      conversationId,
      authorId: currentProfile.id,
      body: trimmedBody,
      createdAt: optimisticCreatedAt,
    }

    setMessages(current => [...current, optimisticMessage])
    setConversations(current => sortConversationsByUpdatedAt(current.map(conversation =>
      conversation.id === conversationId
        ? { ...conversation, updatedAt: optimisticCreatedAt }
        : conversation,
    )))

    const { data, error } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      author_id: currentProfile.id,
      body: trimmedBody,
    }).select('*').single()

    if (error || !data) {
      setMessages(current => current.filter(message => message.id !== optimisticId))
      await loadWorkspace()
      throw error ?? new Error('Nachricht konnte nicht gesendet werden.')
    }

    const confirmedMessage = mapMessage(data)
    setMessages(current => current.map(message => message.id === optimisticId ? confirmedMessage : message))
    setConversations(current => sortConversationsByUpdatedAt(current.map(conversation =>
      conversation.id === conversationId
        ? { ...conversation, updatedAt: confirmedMessage.createdAt }
        : conversation,
    )))
  }, [auth.profile, loadWorkspace])

  const createDirectConversation = useCallback(async (otherProfileId: string) => {
    if (!auth.profile || !auth.session?.access_token) {
      throw new Error('Nicht angemeldet.')
    }

    const response = await fetch('/api/l21/direct-conversations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.session.access_token}`,
      },
      body: JSON.stringify({ otherProfileId }),
    })

    const data = (await response.json()) as { conversationId?: string; error?: string }

    if (!response.ok || !data.conversationId) {
      throw new Error(data.error ?? 'Direktchat konnte nicht erstellt werden.')
    }

    await loadWorkspace()

    return data.conversationId
  }, [auth.profile, auth.session, loadWorkspace])

  const myTasks = useMemo(
    () => {
      const currentProfile = auth.profile
      return currentProfile ? tasks.filter(task => task.assigneeId === currentProfile.id) : []
    },
    [auth.profile, tasks],
  )

  const myConversations = useMemo(
    () => {
      const currentProfile = auth.profile
      return currentProfile
        ? conversations.filter(conversation => conversation.participantIds.includes(currentProfile.id))
        : []
    },
    [auth.profile, conversations],
  )
  const messagesByConversationId = useMemo(() => {
    const map = new Map<string, L21Message[]>()
    for (const message of messages) {
      const list = map.get(message.conversationId) ?? []
      list.push(message)
      map.set(message.conversationId, list)
    }
    return map
  }, [messages])
  const taskCommentsByTaskId = useMemo(() => {
    const map = new Map<string, L21TaskComment[]>()
    for (const comment of taskComments) {
      const list = map.get(comment.taskId) ?? []
      list.push(comment)
      map.set(comment.taskId, list)
    }
    return map
  }, [taskComments])
  const profilesById = useMemo(
    () => new Map(profiles.map(profile => [profile.id, profile])),
    [profiles],
  )

  const getMessages = useCallback(
    (conversationId: string) => messagesByConversationId.get(conversationId) ?? [],
    [messagesByConversationId],
  )

  const getTaskByConversation = useCallback(
    (conversationId: string) => tasks.find(task => task.conversationId === conversationId),
    [tasks],
  )

  const getTaskComments = useCallback(
    (taskId: string) => taskCommentsByTaskId.get(taskId) ?? [],
    [taskCommentsByTaskId],
  )

  const getProfile = useCallback(
    (profileId: string) => profilesById.get(profileId),
    [profilesById],
  )

  return {
    ...auth,
    ready: !auth.loading && !loading,
    profiles,
    tasks,
    taskComments,
    conversations,
    messages,
    myTasks,
    myConversations,
    updateTaskStatus,
    updateTask,
    archiveTask,
    unarchiveTask,
    deleteTask,
    addTaskComment,
    deleteTaskComment,
    sendMessage,
    createDirectConversation,
    getMessages,
    getTaskByConversation,
    getTaskComments,
    getProfile,
    reload: loadWorkspace,
  }
}
