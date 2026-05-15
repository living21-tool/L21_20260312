import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import { checkAvailability } from '@/lib/availability-service'

export async function GET() {
  // 1. Berlin properties from DB
  const { data: berlinProps } = await supabaseServer
    .from('properties')
    .select('id, name, short_code, beds, active, location_id')
    .eq('location_id', 'loc-berlin')

  const berlinPropIds = (berlinProps ?? []).map(p => p.id)

  // 2. Bookings for Berlin properties overlapping May 15-20
  const { data: allBookings } = await supabaseServer
    .from('bookings')
    .select('id, property_id, check_in, check_out, beds_booked, status, source')
    .in('property_id', berlinPropIds)
    .gte('check_out', '2026-05-15')
    .lte('check_in', '2026-05-20')

  // 3. Run actual availability check
  let availResult = null
  try {
    availResult = await checkAvailability({
      locationName: 'Berlin',
      checkIn: '2026-05-15',
      checkOut: '2026-05-20',
      bedsNeeded: 5,
    })
  } catch (e: unknown) {
    availResult = { error: e instanceof Error ? e.message : String(e) }
  }

  return NextResponse.json({
    berlinProperties: berlinProps,
    berlinBookingsInRange: allBookings,
    availabilityResult: availResult,
  }, { status: 200 })
}
