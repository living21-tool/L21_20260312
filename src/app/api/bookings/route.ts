import { NextRequest, NextResponse } from 'next/server'
import { loadBookingListPage } from '@/lib/booking-data-service'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const data = await loadBookingListPage({
      search: searchParams.get('search') ?? '',
      statusFilter: searchParams.get('statusFilter') ?? 'all',
      locationFilter: searchParams.get('locationFilter') ?? 'all',
      sortBy: (searchParams.get('sortBy') as 'invoiceDesc' | 'createdDesc' | null) ?? 'invoiceDesc',
      viewMode: (searchParams.get('viewMode') as 'invoices' | 'bookings' | null) ?? 'invoices',
      page: Number(searchParams.get('page') ?? '1'),
      pageSize: Number(searchParams.get('pageSize') ?? '50'),
    })

    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Buchungen konnten nicht geladen werden.' },
      { status: 500 },
    )
  }
}
