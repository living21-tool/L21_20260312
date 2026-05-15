import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function GET() {
  const [{ data: locations }, { data: properties }, { data: bookings }] = await Promise.all([
    supabaseServer.from('locations').select('id, name, city'),
    supabaseServer.from('properties').select('id, name, short_code, location_id, beds, active'),
    supabaseServer.from('bookings').select('id, property_id, check_in, check_out, beds_booked, status, source')
      .gte('check_out', '2026-05-15')
      .lte('check_in', '2026-05-20'),
  ])

  return NextResponse.json({
    locations,
    properties,
    bookingsInRange: bookings,
  }, { status: 200 })
}
