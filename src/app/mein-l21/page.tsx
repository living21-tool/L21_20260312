'use client'

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useL21Workspace } from '@/lib/l21-workspace'
import { L21Conversation, L21TaskStatus } from '@/lib/l21-types'
import { useLocations, useProperties } from '@/lib/store'
import { supabase } from '@/lib/supabase'
import { parseTaskPortfolioCommand } from '@/lib/task-portfolio-parser'
import { cn, formatDate } from '@/lib/utils'
import {
  Archive,
  CheckCircle2,
  ClipboardList,
  LogIn,
  MessageSquare,
  MessageSquareMore,
  PlusSquare,
  Send,
  Trash2,
  X,
  UserRound,
} from 'lucide-react'

type WorkspaceTab = 'tasks' | 'chat'
type TaskSort = 'due_asc' | 'due_desc'

const statusMeta: Record<L21TaskStatus, { label: string; className: string }> = {
  offen: { label: 'Offen', className: 'bg-rose-100 text-rose-700' },
  in_bearbeitung: { label: 'In Bearbeitung', className: 'bg-amber-100 text-amber-700' },
  wartet: { label: 'Wartet', className: 'bg-slate-200 text-slate-700' },
  erledigt: { label: 'Erledigt', className: 'bg-emerald-100 text-emerald-700' },
}

const primaryTaskStatuses: L21TaskStatus[] = ['offen', 'in_bearbeitung', 'erledigt']

function getConversationLabel(
  conversation: L21Conversation,
  currentProfileId: string,
  getProfile: (profileId: string) => { fullName: string; email: string; role: string } | undefined,
) {
  if (conversation.type === 'task') {
    return conversation.title
  }

  const others = conversation.participantIds
    .filter(profileId => profileId !== currentProfileId)
    .map(profileId => {
      const profile = getProfile(profileId)
      if (!profile) {
        return null
      }

      return profile.fullName.trim() || profile.email.trim() || profile.role
    })
    .filter(Boolean)

  return others.join(', ') || conversation.title || 'Direktchat'
}

function MeinL21PageContent() {
  const searchParams = useSearchParams()
  const queryConversationId = searchParams.get('conversation') ?? ''
  const {
    ready,
    profile,
    isAdmin,
    tasks,
    profiles,
    myTasks,
    myConversations,
    signOut,
    updateTask,
    archiveTask,
    unarchiveTask,
    deleteTask,
    addTaskComment,
    deleteTaskComment,
    sendMessage,
    createDirectConversation,
    getMessages,
    getTaskComments,
    getProfile,
    reload,
  } = useL21Workspace()
  const { properties } = useProperties()
  const { locations } = useLocations()

  const [activeTab, setActiveTab] = useState<WorkspaceTab>(queryConversationId ? 'chat' : 'tasks')
  const [selectedConversationId, setSelectedConversationId] = useState(queryConversationId)
  const [draft, setDraft] = useState('')
  const [showNewChatPicker, setShowNewChatPicker] = useState(false)
  const [showTaskComposer, setShowTaskComposer] = useState(false)
  const [showArchivedTasks, setShowArchivedTasks] = useState(false)
  const [taskSort, setTaskSort] = useState<TaskSort>('due_asc')
  const [expandedTaskId, setExpandedTaskId] = useState('')
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10))
  const [propertyId, setPropertyId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [unitLabel, setUnitLabel] = useState('')
  const [savingTask, setSavingTask] = useState(false)
  const [taskError, setTaskError] = useState('')
  const [taskActionError, setTaskActionError] = useState('')
  const [taskEditorDirty, setTaskEditorDirty] = useState(false)
  const [taskAutoSaving, setTaskAutoSaving] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [taskEditor, setTaskEditor] = useState({
    title: '',
    description: '',
    status: 'offen' as L21TaskStatus,
    dueDate: new Date().toISOString().slice(0, 10),
    assigneeId: '',
    propertyId: '',
    locationId: '',
    unitLabel: '',
  })

  const visibleTasks = useMemo(() => (isAdmin ? tasks : myTasks), [isAdmin, myTasks, tasks])
  const activeTasks = useMemo(() => visibleTasks.filter(task => !task.archivedAt), [visibleTasks])
  const archivedTasks = useMemo(() => visibleTasks.filter(task => task.archivedAt), [visibleTasks])
  const displayedTasks = useMemo(() => {
    const baseTasks = showArchivedTasks ? archivedTasks : activeTasks

    return [...baseTasks].sort((a, b) => {
      const aDue = a.dueDate ? new Date(`${a.dueDate}T00:00:00`).getTime() : Number.POSITIVE_INFINITY
      const bDue = b.dueDate ? new Date(`${b.dueDate}T00:00:00`).getTime() : Number.POSITIVE_INFINITY

      if (taskSort === 'due_desc') {
        return bDue - aDue
      }

      return aDue - bDue
    })
  }, [activeTasks, archivedTasks, showArchivedTasks, taskSort])
  const selectedTask = visibleTasks.find(task => task.id === expandedTaskId) ?? null

  const selectableProfiles = useMemo(
    () => profiles.filter(item => item.isActive && item.id !== profile?.id),
    [profile?.id, profiles],
  )

  const directConversations = useMemo(
    () => myConversations.filter(conversation => conversation.type === 'direct'),
    [myConversations],
  )

  const sortedConversations = useMemo(
    () => [...directConversations].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [directConversations],
  )

  const activeConversationId = useMemo(() => {
    if (selectedConversationId && sortedConversations.some(conversation => conversation.id === selectedConversationId)) {
      return selectedConversationId
    }

    if (queryConversationId && sortedConversations.some(conversation => conversation.id === queryConversationId)) {
      return queryConversationId
    }

    return sortedConversations[0]?.id ?? ''
  }, [queryConversationId, selectedConversationId, sortedConversations])

  const selectedConversation = useMemo(
    () => sortedConversations.find(conversation => conversation.id === activeConversationId),
    [activeConversationId, sortedConversations],
  )

  const selectedMessages = useMemo(
    () => (selectedConversation ? getMessages(selectedConversation.id) : []),
    [getMessages, selectedConversation],
  )
  const taskPortfolioParse = useMemo(
    () => parseTaskPortfolioCommand(title, properties, locations),
    [locations, properties, title],
  )

  function scrollMessagesToBottom() {
    const container = messagesContainerRef.current
    if (!container) {
      return
    }

    container.scrollTop = container.scrollHeight
  }

  useLayoutEffect(() => {
    scrollMessagesToBottom()

    const frameA = window.requestAnimationFrame(() => {
      scrollMessagesToBottom()
    })
    const frameB = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        scrollMessagesToBottom()
      })
    })
    const timeoutA = window.setTimeout(() => {
      scrollMessagesToBottom()
    }, 40)
    const timeoutB = window.setTimeout(() => {
      scrollMessagesToBottom()
    }, 180)

    return () => {
      window.cancelAnimationFrame(frameA)
      window.cancelAnimationFrame(frameB)
      window.clearTimeout(timeoutA)
      window.clearTimeout(timeoutB)
    }
  }, [activeConversationId, selectedMessages])

  async function createTask() {
    if (!profile) {
      return
    }

    setSavingTask(true)
    setTaskError('')

    const parsedTask = parseTaskPortfolioCommand(title, properties, locations)
    const finalTitle = parsedTask.cleanTitle.trim()
    const finalPropertyId = parsedTask.propertyId ?? propertyId ?? null
    const finalLocationId = parsedTask.locationId ?? locationId ?? null
    const finalUnitLabel = parsedTask.unitLabel ?? unitLabel ?? null

    if (!finalTitle) {
      setTaskError('Bitte gib einen Aufgabentitel ein.')
      setSavingTask(false)
      return
    }

    const { error } = await supabase.from('tasks').insert({
      title: finalTitle,
      description,
      assignee_id: assigneeId,
      created_by: profile.id,
      priority: 'mittel',
      due_at: new Date(`${dueDate}T10:00:00`).toISOString(),
      property_id: finalPropertyId,
      location_id: finalLocationId,
      unit_label: finalUnitLabel,
    })

    if (error) {
      setTaskError(error.message)
      setSavingTask(false)
      return
    }

    setTitle('')
    setDescription('')
    setAssigneeId('')
    setDueDate(new Date().toISOString().slice(0, 10))
    setPropertyId('')
    setLocationId('')
    setUnitLabel('')
    setSavingTask(false)
    setShowTaskComposer(false)
    await reload()
  }

  function updateTaskEditorField(patch: Partial<typeof taskEditor>) {
    setTaskEditor(current => ({ ...current, ...patch }))
    setTaskEditorDirty(true)
  }

  async function handleTaskStatusChange(taskId: string, status: L21TaskStatus) {
    setTaskEditor(current => ({ ...current, status }))

    try {
      setTaskActionError('')
      await updateTask(taskId, { status })
    } catch (error) {
      setTaskActionError(error instanceof Error ? error.message : 'Status konnte nicht gespeichert werden.')
      const currentTask = visibleTasks.find(item => item.id === taskId)
      if (currentTask) {
        setTaskEditor(current => ({ ...current, status: currentTask.status }))
      }
    }
  }

  async function handleAddComment(taskId: string) {
    try {
      setTaskActionError('')
      await addTaskComment(taskId, commentDraft)
      setCommentDraft('')
    } catch (error) {
      setTaskActionError(error instanceof Error ? error.message : 'Kommentar konnte nicht gespeichert werden.')
    }
  }

  function openTask(taskId: string) {
    if (expandedTaskId === taskId) {
      setExpandedTaskId('')
      return
    }

    const task = visibleTasks.find(item => item.id === taskId)
    if (!task) {
      return
    }

    setExpandedTaskId(taskId)
    setTaskEditor({
      title: task.title,
      description: task.description,
      status: task.status,
      dueDate: task.dueDate,
      assigneeId: task.assigneeId,
      propertyId: task.propertyId ?? '',
      locationId: task.locationId ?? '',
      unitLabel: task.unitLabel ?? '',
    })
    setCommentDraft('')
    setTaskActionError('')
    setTaskEditorDirty(false)
    setTaskAutoSaving(false)
  }

  useEffect(() => {
    if (!selectedTask || !taskEditorDirty) {
      return
    }

    const editorMatchesTask =
      taskEditor.title === selectedTask.title &&
      taskEditor.description === selectedTask.description &&
      taskEditor.status === selectedTask.status &&
      taskEditor.dueDate === selectedTask.dueDate &&
      taskEditor.assigneeId === selectedTask.assigneeId &&
      taskEditor.propertyId === (selectedTask.propertyId ?? '') &&
      taskEditor.locationId === (selectedTask.locationId ?? '') &&
      taskEditor.unitLabel === (selectedTask.unitLabel ?? '')

    if (editorMatchesTask) {
      setTaskEditorDirty(false)
      setTaskAutoSaving(false)
      return
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        setTaskActionError('')
        setTaskAutoSaving(true)
        await updateTask(selectedTask.id, {
          title: taskEditor.title,
          description: taskEditor.description,
          status: taskEditor.status,
          dueDate: taskEditor.dueDate,
          assigneeId: taskEditor.assigneeId,
          propertyId: taskEditor.propertyId || null,
          locationId: taskEditor.locationId || null,
          unitLabel: taskEditor.unitLabel || null,
        })
        setTaskEditorDirty(false)
      } catch (error) {
        setTaskActionError(error instanceof Error ? error.message : 'Aufgabe konnte nicht gespeichert werden.')
      } finally {
        setTaskAutoSaving(false)
      }
    }, 450)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [selectedTask, taskEditor, taskEditorDirty, updateTask])

  if (!ready) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="text-center">
          <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-sky-200 border-t-sky-600" />
          <p className="text-sm text-slate-500">Arbeitsbereich wird geladen...</p>
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center p-6">
        <div className="max-w-md rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
            <LogIn size={24} />
          </div>
          <h1 className="mt-5 text-2xl font-semibold text-slate-900">Anmeldung erforderlich</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            Aufgaben und Mitarbeiter-Chats laufen ueber die angemeldeten Benutzerkonten.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-700"
          >
            Jetzt anmelden
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eff6ff_100%)] p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-[24px] border border-slate-200 bg-white px-6 py-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 xl:grid xl:grid-cols-[auto_1fr_auto] xl:items-center">
            <div className="inline-flex rounded-2xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setActiveTab('tasks')}
                className={cn(
                  'rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors',
                  activeTab === 'tasks' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900',
                )}
              >
                Aufgaben
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('chat')}
                className={cn(
                  'rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors',
                  activeTab === 'chat' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900',
                )}
              >
                Chat
              </button>
            </div>

            <div className="grid flex-1 gap-3 md:grid-cols-3 xl:px-2">
              <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                <div className="flex items-center gap-2 text-slate-700">
                  <ClipboardList size={13} />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">Aufgaben</span>
                </div>
                <div className="mt-1.5 flex items-end justify-between gap-2">
                  <p className="text-xl font-semibold text-slate-900">{visibleTasks.length}</p>
                  <p className="text-right text-[11px] leading-4 text-slate-500">
                    {isAdmin ? 'sichtbar gesamt' : 'zugewiesen'}
                  </p>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                <div className="flex items-center gap-2 text-slate-700">
                  <MessageSquare size={13} />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">Chats</span>
                </div>
                <div className="mt-1.5 flex items-end justify-between gap-2">
                  <p className="text-xl font-semibold text-slate-900">{sortedConversations.length}</p>
                  <p className="text-right text-[11px] leading-4 text-slate-500">Direktchats</p>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                <div className="flex items-center gap-2 text-slate-700">
                  <CheckCircle2 size={13} />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">Erledigt</span>
                </div>
                <div className="mt-1.5 flex items-end justify-between gap-2">
                  <p className="text-xl font-semibold text-slate-900">{visibleTasks.filter(task => task.status === 'erledigt').length}</p>
                  <p className="text-right text-[11px] leading-4 text-slate-500">abgeschlossen</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">{profile.fullName}</p>
              <p className="mt-1 text-xs text-slate-500">{profile.email}</p>
              <div className="mt-4 flex items-center gap-3">
                <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
                  {profile.role}
                </span>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100"
                >
                  Abmelden
                </button>
              </div>
            </div>
          </div>
        </section>

        {activeTab === 'tasks' ? (
          <section className="space-y-4">
            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                  <ClipboardList size={20} />
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-semibold text-slate-900">Meine Aufgaben</h2>
                  <p className="text-sm text-slate-500">Zuweisen, kommentieren, bearbeiten, archivieren und abschliessen.</p>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    Sortierung
                  </label>
                  <select
                    value={taskSort}
                    onChange={event => setTaskSort(event.target.value as TaskSort)}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 outline-none transition-colors focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                  >
                    <option value="due_asc">Faelligkeit aufsteigend</option>
                    <option value="due_desc">Faelligkeit absteigend</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => setShowArchivedTasks(current => !current)}
                  className={cn(
                    'rounded-2xl border px-4 py-2.5 text-sm font-semibold transition-colors',
                    showArchivedTasks ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-700 hover:bg-slate-50',
                  )}
                >
                  {showArchivedTasks ? 'Aktive Aufgaben' : 'Archiv anzeigen'}
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setShowTaskComposer(current => !current)}
                    className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-700"
                  >
                    <PlusSquare size={16} />
                    {showTaskComposer ? 'Formular schliessen' : 'Aufgabe erstellen'}
                  </button>
                )}
              </div>

              {isAdmin && showTaskComposer && (
                <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                  <div className="grid gap-4 xl:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Titel</label>
                      <input
                        value={title}
                        onChange={event => setTitle(event.target.value)}
                        placeholder="/BBS6 WE6 - Endreinigung"
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                      />
                      <p className="mt-1.5 text-xs text-slate-500">
                        Mit `/` kannst du ein Objekt direkt referenzieren, z. B. `/BBS6 WE6 - Endreinigung`.
                      </p>
                      {(taskPortfolioParse.matchedProperty || taskPortfolioParse.rawReference) && (
                        <div className={cn(
                          'mt-2 rounded-2xl border px-3 py-2 text-xs',
                          taskPortfolioParse.matchedProperty ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700',
                        )}>
                          {taskPortfolioParse.matchedProperty
                            ? `Erkannt: ${taskPortfolioParse.matchedProperty.name}${taskPortfolioParse.unitLabel ? ` · ${taskPortfolioParse.unitLabel}` : ''}`
                            : taskPortfolioParse.ambiguousMatches?.length
                              ? `Mehrdeutig: "${taskPortfolioParse.rawReference}" passt zu ${taskPortfolioParse.ambiguousMatches.map(property => property.shortCode || property.name).join(', ')}. Bitte Referenz praeziser schreiben.`
                              : `Kein Objekt zu "${taskPortfolioParse.rawReference}" gefunden. Dann gelten die manuellen Felder unten.`}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Mitarbeiter</label>
                      <select
                        value={assigneeId}
                        onChange={event => setAssigneeId(event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                      >
                        <option value="">Bitte waehlen</option>
                        {profiles
                          .filter(item => item.isActive)
                          .map(item => (
                            <option key={item.id} value={item.id}>
                              {item.fullName} - {item.role}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  <div className="mt-4">
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">Beschreibung</label>
                    <textarea
                      value={description}
                      onChange={event => setDescription(event.target.value)}
                      rows={3}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                    />
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Faellig am</label>
                      <input
                        type="date"
                        value={dueDate}
                        onChange={event => setDueDate(event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Standort</label>
                      <select
                        value={locationId}
                        onChange={event => setLocationId(event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                      >
                        <option value="">Optional</option>
                        {locations.map(location => (
                          <option key={location.id} value={location.id}>
                            {location.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Objekt</label>
                      <select
                        value={propertyId}
                        onChange={event => setPropertyId(event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                      >
                        <option value="">Optional</option>
                        {properties.map(propertyItem => (
                          <option key={propertyItem.id} value={propertyItem.id}>
                            {propertyItem.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_auto]">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">Einheit / Wohnung</label>
                      <input
                        value={unitLabel}
                        onChange={event => setUnitLabel(event.target.value)}
                        placeholder="z. B. Wohnung 3"
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="button"
                        disabled={savingTask || !title.trim() || !assigneeId || !dueDate}
                        onClick={() => void createTask()}
                        className="inline-flex w-full items-center justify-center rounded-2xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-700 disabled:bg-sky-300 xl:w-auto"
                      >
                        {savingTask ? 'Speichere Aufgabe...' : 'Aufgabe zuweisen'}
                      </button>
                    </div>
                  </div>

                  {taskError && <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{taskError}</div>}
                </div>
              )}

              <div className="mt-6 space-y-3">
                {displayedTasks.map(task => {
                  const assignee = profiles.find(item => item.id === task.assigneeId)
                  const propertyItem = properties.find(item => item.id === task.propertyId)
                  const location = locations.find(item => item.id === (task.locationId ?? propertyItem?.locationId))
                  const comments = getTaskComments(task.id)
                  const canDeleteFromOverview = isAdmin || task.createdBy === profile.id

                  return (
                    <div
                      key={task.id}
                      onClick={() => openTask(task.id)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          openTask(task.id)
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      className="group w-full rounded-2xl border border-slate-200 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-sky-200 hover:bg-sky-50/40 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-sky-200"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-semibold text-slate-900">{task.title}</h3>
                            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', statusMeta[task.status].className)}>
                              {statusMeta[task.status].label}
                            </span>
                          </div>
                          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                            <div className="rounded-xl bg-slate-50 px-3 py-2">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Verantwortlich</p>
                              <p className="mt-1 truncate text-xs font-medium text-slate-700">{assignee?.fullName ?? '-'}</p>
                            </div>
                            <div className="rounded-xl bg-slate-50 px-3 py-2">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Standort</p>
                              <p className="mt-1 truncate text-xs font-medium text-slate-700">{location?.name ?? '-'}</p>
                            </div>
                            <div className="rounded-xl bg-slate-50 px-3 py-2">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Objekt</p>
                              <p className="mt-1 truncate text-xs font-medium text-slate-700">{propertyItem?.name ?? '-'}</p>
                            </div>
                            <div className="rounded-xl bg-slate-50 px-3 py-2">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Wohnung</p>
                              <p className="mt-1 truncate text-xs font-medium text-slate-700">{task.unitLabel ?? '-'}</p>
                            </div>
                            <div className="rounded-xl bg-slate-50 px-3 py-2">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Faelligkeit</p>
                              <p className="mt-1 text-xs font-medium text-slate-700">{formatDate(task.dueDate)}</p>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          {comments.length > 0 && (
                            <span className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-500">
                              {comments.length} Kommentare
                            </span>
                          )}
                          {canDeleteFromOverview && (
                            <button
                              type="button"
                              onClick={event => {
                                event.stopPropagation()
                                void deleteTask(task.id)
                              }}
                              className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50"
                            >
                              <Trash2 size={14} className="inline-block" /> Loeschen
                            </button>
                          )}
                          <span className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-500 transition-colors group-hover:bg-sky-100 group-hover:text-sky-700">
                            Details
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}

                {displayedTasks.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
                    {showArchivedTasks ? 'Keine archivierten Aufgaben vorhanden.' : 'Noch keine Aufgaben vorhanden.'}
                  </div>
                )}
              </div>
            </div>

            {selectedTask && (() => {
              const selectedAssignee = profiles.find(item => item.id === selectedTask.assigneeId)
              const selectedProperty = properties.find(item => item.id === selectedTask.propertyId)
              const selectedLocation = locations.find(item => item.id === (selectedTask.locationId ?? selectedProperty?.locationId))
              const selectedComments = getTaskComments(selectedTask.id)
              const canUpdateSelectedStatus = isAdmin || selectedTask.assigneeId === profile.id

              return (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                  <div
                    className="absolute inset-0 bg-slate-950/35 backdrop-blur-sm"
                    onClick={() => setExpandedTaskId('')}
                  />
                  <div className="relative max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            value={taskEditor.title}
                            onChange={event => updateTaskEditorField({ title: event.target.value })}
                            className="min-w-[280px] flex-1 rounded-2xl border border-transparent bg-transparent px-3 py-2 text-xl font-semibold text-slate-900 outline-none transition-colors hover:border-slate-200 hover:bg-slate-50 focus:border-sky-300 focus:bg-white focus:ring-2 focus:ring-sky-100"
                          />
                          <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', statusMeta[selectedTask.status].className)}>
                            {statusMeta[selectedTask.status].label}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                          {selectedAssignee && <span>{selectedAssignee.fullName}</span>}
                          {selectedLocation && <span>- {selectedLocation.name}</span>}
                          {selectedProperty && <span>- {selectedProperty.name}</span>}
                          {selectedTask.unitLabel && <span>- {selectedTask.unitLabel}</span>}
                          <span>- Faellig {formatDate(selectedTask.dueDate)}</span>
                        </div>
                      </div>

                      <div className="flex flex-1 flex-wrap items-start justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setExpandedTaskId('')}
                          className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-sky-200 hover:text-sky-700"
                        >
                          Schliessen
                        </button>

                        {canUpdateSelectedStatus && (
                          <div className="flex flex-wrap gap-2">
                            {primaryTaskStatuses.map(status => {
                              const isActiveStatus = taskEditor.status === status

                              return (
                                <button
                                  key={status}
                                  type="button"
                                  onClick={() => void handleTaskStatusChange(selectedTask.id, status)}
                                  className={cn(
                                    'rounded-xl border px-3 py-2 text-xs font-semibold transition-colors',
                                    isActiveStatus
                                      ? status === 'offen'
                                        ? 'border-rose-200 bg-rose-100 text-rose-700'
                                        : status === 'in_bearbeitung'
                                          ? 'border-amber-200 bg-amber-100 text-amber-700'
                                          : 'border-emerald-200 bg-emerald-100 text-emerald-700'
                                      : status === 'offen'
                                        ? 'border-rose-200 text-rose-700 hover:bg-rose-50'
                                        : status === 'in_bearbeitung'
                                          ? 'border-amber-200 text-amber-700 hover:bg-amber-50'
                                          : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50',
                                  )}
                                >
                                  {statusMeta[status].label}
                                </button>
                              )
                            })}
                          </div>
                        )}

                        {isAdmin && (
                          <div className="flex flex-wrap gap-2">
                            {!selectedTask.archivedAt && (
                              <button
                                type="button"
                                onClick={() => void archiveTask(selectedTask.id)}
                                className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-amber-200 hover:text-amber-700"
                              >
                                <Archive size={14} className="inline-block" /> Archivieren
                              </button>
                            )}
                            {selectedTask.archivedAt && (
                              <button
                                type="button"
                                onClick={() => void unarchiveTask(selectedTask.id)}
                                className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-emerald-200 hover:text-emerald-700"
                              >
                                Archiv aufheben
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void deleteTask(selectedTask.id)}
                              className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50"
                            >
                              <Trash2 size={14} className="inline-block" /> Loeschen
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="max-h-[calc(92vh-108px)] overflow-y-auto px-6 py-5">
                      <div className="space-y-5">
                        <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr_1fr]">
                          <div>
                            <label className="mb-1.5 block text-sm font-medium text-slate-700">Mitarbeiter</label>
                            <select
                              value={taskEditor.assigneeId}
                              disabled={!isAdmin}
                              onChange={event => updateTaskEditorField({ assigneeId: event.target.value })}
                              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 disabled:bg-slate-50"
                            >
                              {profiles.filter(item => item.isActive).map(item => (
                                <option key={item.id} value={item.id}>
                                  {item.fullName} - {item.role}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="mb-1.5 block text-sm font-medium text-slate-700">Faelligkeit</label>
                            <input
                              type="date"
                              value={taskEditor.dueDate}
                              onChange={event => updateTaskEditorField({ dueDate: event.target.value })}
                              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                            />
                          </div>
                          <div>
                            <label className="mb-1.5 block text-sm font-medium text-slate-700">Objekt</label>
                            <select
                              value={taskEditor.propertyId}
                              onChange={event => {
                                const nextPropertyId = event.target.value
                                const nextProperty = properties.find(item => item.id === nextPropertyId)
                                updateTaskEditorField({
                                  propertyId: nextPropertyId,
                                  locationId: nextProperty?.locationId ?? taskEditor.locationId,
                                })
                              }}
                              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                            >
                              <option value="">Optional</option>
                              {properties.map(propertyOption => (
                                <option key={propertyOption.id} value={propertyOption.id}>
                                  {propertyOption.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div>
                          <div>
                            <label className="mb-1.5 block text-sm font-medium text-slate-700">Beschreibung</label>
                            <textarea
                              value={taskEditor.description}
                              onChange={event => updateTaskEditorField({ description: event.target.value })}
                              rows={3}
                              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                            />
                          </div>
                        </div>

                        <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                          <h3 className="text-sm font-semibold text-slate-900">Kommentare</h3>
                          <div className="mt-4 space-y-3">
                            {selectedComments.map(comment => {
                              const author = getProfile(comment.authorId)
                              const canDeleteComment = isAdmin || comment.authorId === profile.id
                              return (
                                <div key={comment.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                  <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                                    <div className="flex items-center gap-3">
                                      <span className="font-semibold text-slate-700">{author?.fullName ?? 'Mitarbeiter'}</span>
                                      <span>{new Date(comment.createdAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>
                                    {canDeleteComment && (
                                      <button
                                        type="button"
                                        onClick={() => void deleteTaskComment(comment.id)}
                                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                                        aria-label="Kommentar loeschen"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    )}
                                  </div>
                                  <p className="mt-2 text-sm text-slate-700">{comment.body}</p>
                                </div>
                              )
                            })}
                            {selectedComments.length === 0 && (
                              <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                                Noch keine Kommentare vorhanden.
                              </div>
                            )}
                          </div>

                          <div className="mt-4 flex items-end gap-3">
                            <textarea
                              value={commentDraft}
                              onChange={event => setCommentDraft(event.target.value)}
                              rows={3}
                              placeholder="Kommentar hinzufuegen..."
                              className="min-h-[96px] flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                            />
                            <button
                              type="button"
                              disabled={!commentDraft.trim()}
                              onClick={() => void handleAddComment(selectedTask.id)}
                              className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-600 text-white transition-colors hover:bg-sky-700 disabled:bg-sky-300"
                            >
                              <Send size={16} />
                            </button>
                          </div>
                        </div>

                        <div className="flex justify-end text-xs font-medium text-slate-500">
                          {taskAutoSaving ? 'Speichert...' : taskEditorDirty ? 'Aenderungen werden gespeichert...' : 'Alle Aenderungen gespeichert'}
                        </div>

                        {taskActionError && (
                          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                            {taskActionError}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}
          </section>
        ) : (
          <section className="grid gap-6 xl:grid-cols-[0.7fr_1.3fr]">
            <div className="space-y-6">
              <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm xl:h-[720px]">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                      <MessageSquareMore size={20} />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900">Chats</h2>
                      <p className="text-sm text-slate-500">Alle deine Direktchats mit Mitarbeitern.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowNewChatPicker(current => !current)}
                    className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-700"
                  >
                    <PlusSquare size={16} />
                    Neuer Chat
                  </button>
                </div>

                {showNewChatPicker && (
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-900">Mitarbeiter auswaehlen</p>
                      <button
                        type="button"
                        onClick={() => setShowNewChatPicker(false)}
                        className="rounded-lg p-1 text-slate-500 transition-colors hover:bg-white hover:text-slate-900"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <div className="space-y-2">
                      {selectableProfiles.map(item => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={async () => {
                            const conversationId = await createDirectConversation(item.id)
                            setSelectedConversationId(conversationId)
                            setShowNewChatPicker(false)
                          }}
                          className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left transition-colors hover:border-sky-200 hover:bg-sky-50"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className="flex h-10 w-10 items-center justify-center rounded-2xl text-xs font-bold text-white"
                              style={{ backgroundColor: item.avatarColor ?? '#475569' }}
                            >
                              {item.initials ?? item.fullName.slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{item.fullName}</p>
                              <p className="text-xs text-slate-500">{item.role}</p>
                            </div>
                          </div>
                          <span className="text-xs font-semibold text-sky-700">Oeffnen</span>
                        </button>
                      ))}

                      {selectableProfiles.length === 0 && (
                        <div className="rounded-2xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
                          Keine weiteren aktiven Mitarbeiter verfuegbar.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-4 max-h-[590px] overflow-y-auto">
                  <div className="space-y-2">
                    {sortedConversations.map(conversation => {
                      const conversationMessages = getMessages(conversation.id)
                      const lastMessage = conversationMessages[conversationMessages.length - 1]
                      const active = activeConversationId === conversation.id
                      const label = getConversationLabel(conversation, profile.id, getProfile)

                      return (
                        <button
                          key={conversation.id}
                          type="button"
                          onClick={() => setSelectedConversationId(conversation.id)}
                          className={cn(
                            'w-full rounded-2xl border p-4 text-left transition-colors',
                            active ? 'border-sky-200 bg-sky-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-900">{label}</p>
                              <p className="mt-1 truncate text-xs text-slate-500">{lastMessage?.body ?? 'Noch keine Nachricht'}</p>
                            </div>
                            <span className="text-[11px] text-slate-400">
                              {lastMessage ? new Date(lastMessage.createdAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : ''}
                            </span>
                          </div>
                        </button>
                      )
                    })}

                    {sortedConversations.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
                        Noch keine Direktchats vorhanden.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white shadow-sm xl:h-[720px]">
              {selectedConversation ? (
                <div className="flex h-full flex-col">
                  <div className="border-b border-slate-200 px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-lg font-semibold text-slate-900">
                          {getConversationLabel(selectedConversation, profile.id, getProfile)}
                        </h2>
                      </div>
                    </div>
                  </div>

                  <div
                    ref={messagesContainerRef}
                    className="flex-1 space-y-4 overflow-y-auto bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-5 py-5"
                  >
                    {selectedMessages.map(message => {
                      const isMe = message.authorId === profile.id

                      return (
                        <div key={message.id} className={cn('flex gap-3', isMe ? 'justify-end' : 'justify-start')}>
                          {!isMe && (
                            <div
                              className="flex h-10 w-10 items-center justify-center rounded-2xl text-xs font-bold text-white"
                              style={{ backgroundColor: getProfile(message.authorId)?.avatarColor ?? '#475569' }}
                            >
                              {getProfile(message.authorId)?.initials ?? <UserRound size={16} />}
                            </div>
                          )}
                          <div className={cn('max-w-[72%]', isMe ? 'items-end' : 'items-start')}>
                            <div className={cn('rounded-2xl px-4 py-2.5 shadow-sm', isMe ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-800')}>
                              <p className="text-sm leading-6">{message.body}</p>
                            </div>
                            <div className={cn('mt-1 px-1 text-[10px] leading-none', isMe ? 'text-right text-slate-400' : 'text-left text-slate-400')}>
                              {new Date(message.createdAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        </div>
                      )
                    })}

                    {selectedMessages.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
                        Noch keine Nachrichten. Starte den Chat mit deiner ersten Nachricht.
                      </div>
                    )}
                  </div>

                  <div className="border-t border-slate-200 p-4">
                    <div className="flex items-end gap-3">
                      <textarea
                        value={draft}
                        onChange={event => setDraft(event.target.value)}
                        rows={2}
                        placeholder="Nachricht eingeben..."
                        className="min-h-[76px] flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
                      />
                      <button
                        type="button"
                        disabled={!draft.trim()}
                        onClick={async () => {
                          await sendMessage(selectedConversation.id, draft)
                          setDraft('')
                        }}
                        className="inline-flex h-12 items-center gap-2 rounded-2xl bg-sky-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-sky-700 disabled:bg-sky-300"
                      >
                        Senden <Send size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex h-full min-h-[520px] items-center justify-center p-8 text-center">
                  <div>
                    <MessageSquare size={36} className="mx-auto text-slate-300" />
                    <h2 className="mt-4 text-lg font-semibold text-slate-900">Noch kein Chat gewaehlt</h2>
                    <p className="mt-2 text-sm text-slate-500">Waehle links einen Mitarbeiter oder einen vorhandenen Chat aus.</p>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

      </div>
    </div>
  )
}

function MeinL21PageFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="text-center">
        <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-sky-200 border-t-sky-600" />
        <p className="text-sm text-slate-500">Arbeitsbereich wird geladen...</p>
      </div>
    </div>
  )
}

export default function MeinL21Page() {
  return (
    <Suspense fallback={<MeinL21PageFallback />}>
      <MeinL21PageContent />
    </Suspense>
  )
}
