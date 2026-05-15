import 'server-only'

import { supabaseAdmin } from '@/lib/supabase-admin'

interface GenerateResult {
  created: number
  skipped: number
  errors: string[]
}

interface ReconcileResult {
  archived: number
  updated: number
}

const HORIZON_DAYS_DEFAULT = 7

/**
 * Generiert Reinigungsaufgaben für bestätigte Buchungen
 * deren Check-out innerhalb des Horizonts liegt und
 * deren Objekt einer Reinigungskraft zugewiesen ist.
 */
export async function generateCleaningTasks(options?: {
  horizonDays?: number
  propertyId?: string
}): Promise<GenerateResult> {
  const horizon = options?.horizonDays ?? HORIZON_DAYS_DEFAULT
  const result: GenerateResult = { created: 0, skipped: 0, errors: [] }

  // 1. Reinigungszuweisungen laden → Map: propertyId → profileId (erster Treffer)
  let assignmentQuery = supabaseAdmin
    .from('employee_assignments')
    .select('profile_id, property_id')
    .eq('role_type', 'reinigung')

  if (options?.propertyId) {
    assignmentQuery = assignmentQuery.eq('property_id', options.propertyId)
  }

  const { data: assignments, error: assignErr } = await assignmentQuery
  if (assignErr || !assignments?.length) {
    return result
  }

  const cleanerByProperty = new Map<string, string>()
  for (const a of assignments) {
    if (!cleanerByProperty.has(a.property_id)) {
      cleanerByProperty.set(a.property_id, a.profile_id)
    }
  }

  const propertyIds = [...cleanerByProperty.keys()]

  // 2. Bestätigte Buchungen mit Check-out im Horizont laden
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = today.toISOString().slice(0, 10)

  const horizon_date = new Date(today)
  horizon_date.setDate(horizon_date.getDate() + horizon)
  const horizonStr = horizon_date.toISOString().slice(0, 10)

  const { data: bookings, error: bookErr } = await supabaseAdmin
    .from('bookings')
    .select('id, property_id, check_out, booking_number')
    .eq('status', 'bestaetigt')
    .gte('check_out', todayStr)
    .lte('check_out', horizonStr)
    .in('property_id', propertyIds)

  if (bookErr || !bookings?.length) {
    return result
  }

  // 3. Bereits existierende Reinigungs-Tasks (nicht archiviert) laden
  const bookingIds = bookings.map(b => b.id)
  const { data: existingTasks } = await supabaseAdmin
    .from('tasks')
    .select('booking_id')
    .in('booking_id', bookingIds)
    .is('archived_at', null)

  const existingBookingIds = new Set((existingTasks ?? []).map(t => t.booking_id))

  // 4. Properties laden für Task-Titel
  const { data: properties } = await supabaseAdmin
    .from('properties')
    .select('id, name')
    .in('id', propertyIds)

  const propertyNameMap = new Map<string, string>()
  for (const p of (properties ?? [])) {
    propertyNameMap.set(p.id, p.name)
  }

  // 5. Admin-Profil als created_by
  const creatorId = await getSystemCreatorId()
  if (!creatorId) {
    result.errors.push('Kein Admin-Profil gefunden für created_by')
    return result
  }

  // 6. Tasks erstellen
  const tasksToInsert = []
  for (const booking of bookings) {
    if (existingBookingIds.has(booking.id)) {
      result.skipped++
      continue
    }

    const cleanerId = cleanerByProperty.get(booking.property_id)
    if (!cleanerId) continue

    const propName = propertyNameMap.get(booking.property_id) ?? booking.property_id
    const checkOutFormatted = formatDateDE(booking.check_out)
    const dueAt = new Date(`${booking.check_out}T10:00:00`).toISOString()

    tasksToInsert.push({
      title: `Reinigung: ${propName} (Abreise ${checkOutFormatted})`,
      description: `Automatisch erstellt. Buchung ${booking.booking_number}, Abreise am ${checkOutFormatted}.`,
      status: 'offen',
      priority: 'mittel',
      due_at: dueAt,
      assignee_id: cleanerId,
      property_id: booking.property_id,
      booking_id: booking.id,
      created_by: creatorId,
    })
  }

  if (!tasksToInsert.length) return result

  // Einzeln inserieren um Duplikat-Fehler pro Buchung abzufangen
  for (const task of tasksToInsert) {
    const { error } = await supabaseAdmin.from('tasks').insert(task)
    if (error) {
      // Unique-Constraint-Verletzung ist erwartet (Duplikat-Schutz)
      if (error.code === '23505') {
        result.skipped++
      } else {
        result.errors.push(`Booking ${task.booking_id}: ${error.message}`)
      }
    } else {
      result.created++
    }
  }

  return result
}

/**
 * Archiviert Reinigungs-Tasks deren Buchung storniert wurde,
 * und aktualisiert Tasks bei geändertem Check-out-Datum.
 */
export async function reconcileCleaningTasks(): Promise<ReconcileResult> {
  const result: ReconcileResult = { archived: 0, updated: 0 }

  // Alle aktiven Auto-Tasks mit booking_id laden
  const { data: autoTasks } = await supabaseAdmin
    .from('tasks')
    .select('id, booking_id, due_at, title')
    .not('booking_id', 'is', null)
    .is('archived_at', null)

  if (!autoTasks?.length) return result

  const bookingIds = autoTasks.map(t => t.booking_id).filter(Boolean) as string[]
  const { data: bookings } = await supabaseAdmin
    .from('bookings')
    .select('id, status, check_out, booking_number, property_id')
    .in('id', bookingIds)

  if (!bookings) return result

  const bookingMap = new Map(bookings.map(b => [b.id, b]))
  const creatorId = await getSystemCreatorId()

  // Properties für Title-Updates laden
  const propIds = [...new Set(bookings.map(b => b.property_id))]
  const { data: properties } = await supabaseAdmin
    .from('properties')
    .select('id, name')
    .in('id', propIds)
  const propNameMap = new Map((properties ?? []).map(p => [p.id, p.name]))

  for (const task of autoTasks) {
    const booking = bookingMap.get(task.booking_id!)
    if (!booking) continue

    // Stornierte Buchung → Task archivieren
    if (booking.status === 'storniert') {
      await supabaseAdmin
        .from('tasks')
        .update({ archived_at: new Date().toISOString(), archived_by: creatorId })
        .eq('id', task.id)
      result.archived++
      continue
    }

    // Check-out geändert → Task updaten
    const expectedDue = new Date(`${booking.check_out}T10:00:00`).toISOString()
    const currentDue = task.due_at
    if (currentDue !== expectedDue) {
      const propName = propNameMap.get(booking.property_id) ?? booking.property_id
      const checkOutFormatted = formatDateDE(booking.check_out)
      await supabaseAdmin
        .from('tasks')
        .update({
          due_at: expectedDue,
          title: `Reinigung: ${propName} (Abreise ${checkOutFormatted})`,
        })
        .eq('id', task.id)
      result.updated++
    }
  }

  return result
}

async function getSystemCreatorId(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('role', 'admin')
    .eq('is_active', true)
    .limit(1)
    .single()
  return data?.id ?? null
}

function formatDateDE(isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  return `${d}.${m}.${y}`
}
