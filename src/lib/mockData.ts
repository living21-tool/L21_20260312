import { Location, Property, Customer, Booking } from './types'

export const mockLocations: Location[] = [
  { id: 'loc-1', name: 'Seeblick Resort', city: 'Starnberg', country: 'Deutschland', color: '#3b82f6' },
  { id: 'loc-2', name: 'Bergpanorama', city: 'Garmisch', country: 'Deutschland', color: '#10b981' },
  { id: 'loc-3', name: 'Stadtresidenz', city: 'München', country: 'Deutschland', color: '#f59e0b' },
]

export const mockProperties: Property[] = [
  {
    id: 'prop-1', name: 'Apt. Seeblick A', shortCode: 'SA', aliases: ['Seeblick A'],
    type: 'wohnung', locationId: 'loc-1',
    beds: 2, pricePerBedNight: 180, cleaningFee: 60,
    description: 'Moderne Ferienwohnung mit direktem Seeblick', amenities: ['WLAN', 'Parkplatz', 'Balkon', 'Küche'],
    images: [], active: true
  },
  {
    id: 'prop-2', name: 'Apt. Seeblick B', shortCode: 'SB', aliases: ['Seeblick B'],
    type: 'wohnung', locationId: 'loc-1',
    beds: 3, pricePerBedNight: 220, cleaningFee: 75,
    description: 'Großzügige Ferienwohnung mit Panoramablick', amenities: ['WLAN', 'Parkplatz', 'Terrasse', 'Küche', 'Geschirrspüler'],
    images: [], active: true
  },
  {
    id: 'prop-3', name: 'Haus Bergweg', shortCode: 'HB', aliases: ['Bergweg'],
    type: 'haus', locationId: 'loc-2',
    beds: 4, pricePerBedNight: 350, cleaningFee: 120,
    description: 'Gemütliches Ferienhaus mit Bergpanorama', amenities: ['WLAN', 'Kamin', 'Sauna', 'Garten', 'Garage'],
    images: [], active: true
  },
  {
    id: 'prop-4', name: 'Studio Bergblick', shortCode: 'STB', aliases: ['Bergblick'],
    type: 'studio', locationId: 'loc-2',
    beds: 1, pricePerBedNight: 95, cleaningFee: 40,
    description: 'Romantisches Studio für 2 Personen', amenities: ['WLAN', 'Parkplatz', 'Kitchenette'],
    images: [], active: true
  },
  {
    id: 'prop-5', name: 'City Loft 1', shortCode: 'CL1', aliases: ['Loft 1', 'City 1'],
    type: 'wohnung', locationId: 'loc-3',
    beds: 2, pricePerBedNight: 160, cleaningFee: 55,
    description: 'Stilvolles Loft in der Münchner Innenstadt', amenities: ['WLAN', 'Tiefgarage', 'Klimaanlage'],
    images: [], active: true
  },
  {
    id: 'prop-6', name: 'City Loft 2', shortCode: 'CL2', aliases: ['Loft 2', 'City 2'],
    type: 'wohnung', locationId: 'loc-3',
    beds: 1, pricePerBedNight: 130, cleaningFee: 45,
    description: 'Kompaktes Loft, ideal für Geschäftsreisende', amenities: ['WLAN', 'Tiefgarage', 'Klimaanlage', 'Schreibtisch'],
    images: [], active: true
  },
]

export const mockCustomers: Customer[] = [
  {
    id: 'cust-1', companyName: 'Müller Bau GmbH', firstName: 'Hans', lastName: 'Müller', email: 'hans.mueller@example.com',
    phone: '+49 89 12345678', address: 'Hauptstraße 12', zip: '80331', city: 'München', country: 'Deutschland',
    lexofficeContactId: 'lex-c-001', notes: 'Stammkunde, bevorzugt ruhige Lage', createdAt: '2024-01-15'
  },
  {
    id: 'cust-2', companyName: 'Schmidt Montage', firstName: 'Anna', lastName: 'Schmidt', email: 'anna.schmidt@example.com',
    phone: '+49 176 98765432', address: 'Parkweg 8', zip: '20095', city: 'Hamburg', country: 'Deutschland',
    lexofficeContactId: 'lex-c-002', notes: 'Reist oft mit Familie', createdAt: '2024-02-01'
  },
  {
    id: 'cust-3', companyName: 'Weber Elektro', firstName: 'Thomas', lastName: 'Weber', email: 't.weber@business.de',
    phone: '+49 89 55566677', address: 'Industriestr. 44', zip: '86150', city: 'Augsburg', country: 'Deutschland',
    lexofficeContactId: 'lex-c-003', notes: 'Geschäftsreisender', createdAt: '2024-03-10'
  },
  {
    id: 'cust-4', companyName: 'Bauer Sanitär', firstName: 'Maria', lastName: 'Bauer', email: 'maria.bauer@web.de',
    phone: '+49 172 11223344', address: 'Gartenstraße 3', zip: '83022', city: 'Rosenheim', country: 'Deutschland',
    notes: '', createdAt: '2024-04-20'
  },
  {
    id: 'cust-5', companyName: 'Fischer Holzbau', firstName: 'Klaus', lastName: 'Fischer', email: 'k.fischer@email.com',
    phone: '+49 89 99887766', address: 'Bergweg 17', zip: '6020', city: 'Innsbruck', country: 'Österreich',
    lexofficeContactId: 'lex-c-005', notes: 'Kommt jedes Jahr im Winter', createdAt: '2023-11-05'
  },
  {
    id: 'cust-6', companyName: 'Hoffmann Dach', firstName: 'Julia', lastName: 'Hoffmann', email: 'julia.h@gmx.de',
    phone: '+49 151 44556677', address: 'Lindenallee 22', zip: '90402', city: 'Nürnberg', country: 'Deutschland',
    notes: 'Kommt mit Hund', createdAt: '2024-06-12'
  },
]

export const mockBookings: Booking[] = [
  // Dezember 2025 (importiert aus Lexoffice)
  {
    id: 'book-1', bookingNumber: 'BU-2025-001', propertyId: 'prop-1', customerId: 'cust-1',
    checkIn: '2025-12-01', checkOut: '2025-12-06', nights: 5, bedsBooked: 2,
    status: 'abgeschlossen', paymentStatus: 'bezahlt',
    pricePerBedNight: 180, cleaningFee: 60, totalPrice: 960, notes: '',
    lexofficeInvoiceId: 'lex-inv-001', invoiceNumber: 'RE-2025-089',
    createdAt: '2025-11-20', updatedAt: '2025-12-06', source: 'lexoffice_import'
  },
  {
    id: 'book-2', bookingNumber: 'BU-2025-002', propertyId: 'prop-3', customerId: 'cust-5',
    checkIn: '2025-12-15', checkOut: '2025-12-23', nights: 8, bedsBooked: 6,
    status: 'abgeschlossen', paymentStatus: 'bezahlt',
    pricePerBedNight: 350, cleaningFee: 120, totalPrice: 2920, notes: 'Weihnachtsaufenthalt',
    lexofficeInvoiceId: 'lex-inv-002', invoiceNumber: 'RE-2025-092',
    createdAt: '2025-11-01', updatedAt: '2025-12-23', source: 'lexoffice_import'
  },
  {
    id: 'book-3', bookingNumber: 'BU-2025-003', propertyId: 'prop-5', customerId: 'cust-3',
    checkIn: '2025-12-02', checkOut: '2025-12-05', nights: 3, bedsBooked: 1,
    status: 'abgeschlossen', paymentStatus: 'bezahlt',
    pricePerBedNight: 160, cleaningFee: 55, totalPrice: 535, notes: 'Geschäftsreise Messe',
    lexofficeInvoiceId: 'lex-inv-003', invoiceNumber: 'RE-2025-090',
    createdAt: '2025-11-28', updatedAt: '2025-12-05', source: 'lexoffice_import'
  },
  {
    id: 'book-4', bookingNumber: 'BU-2025-004', propertyId: 'prop-2', customerId: 'cust-2',
    checkIn: '2025-12-26', checkOut: '2026-01-02', nights: 7, bedsBooked: 4,
    status: 'abgeschlossen', paymentStatus: 'bezahlt',
    pricePerBedNight: 220, cleaningFee: 75, totalPrice: 1615, notes: 'Silvester',
    lexofficeInvoiceId: 'lex-inv-004', invoiceNumber: 'RE-2025-095',
    createdAt: '2025-11-15', updatedAt: '2026-01-02', source: 'lexoffice_import'
  },
  // Januar 2026 (importiert)
  {
    id: 'book-5', bookingNumber: 'BU-2026-001', propertyId: 'prop-4', customerId: 'cust-4',
    checkIn: '2026-01-10', checkOut: '2026-01-14', nights: 4, bedsBooked: 2,
    status: 'abgeschlossen', paymentStatus: 'bezahlt',
    pricePerBedNight: 95, cleaningFee: 40, totalPrice: 420, notes: '',
    lexofficeInvoiceId: 'lex-inv-005', invoiceNumber: 'RE-2026-003',
    createdAt: '2025-12-20', updatedAt: '2026-01-14', source: 'lexoffice_import'
  },
  {
    id: 'book-6', bookingNumber: 'BU-2026-002', propertyId: 'prop-1', customerId: 'cust-6',
    checkIn: '2026-01-18', checkOut: '2026-01-25', nights: 7, bedsBooked: 2,
    status: 'abgeschlossen', paymentStatus: 'bezahlt',
    pricePerBedNight: 180, cleaningFee: 60, totalPrice: 1320, notes: 'Mit Hund',
    lexofficeInvoiceId: 'lex-inv-006', invoiceNumber: 'RE-2026-008',
    createdAt: '2025-12-10', updatedAt: '2026-01-25', source: 'lexoffice_import'
  },
  {
    id: 'book-7', bookingNumber: 'BU-2026-003', propertyId: 'prop-3', customerId: 'cust-1',
    checkIn: '2026-01-05', checkOut: '2026-01-12', nights: 7, bedsBooked: 5,
    status: 'abgeschlossen', paymentStatus: 'bezahlt',
    pricePerBedNight: 350, cleaningFee: 120, totalPrice: 2570, notes: '',
    lexofficeInvoiceId: 'lex-inv-007', invoiceNumber: 'RE-2026-001',
    createdAt: '2025-12-01', updatedAt: '2026-01-12', source: 'lexoffice_import'
  },
  // Februar 2026 (importiert)
  {
    id: 'book-8', bookingNumber: 'BU-2026-004', propertyId: 'prop-2', customerId: 'cust-5',
    checkIn: '2026-02-07', checkOut: '2026-02-14', nights: 7, bedsBooked: 5,
    status: 'abgeschlossen', paymentStatus: 'bezahlt',
    pricePerBedNight: 220, cleaningFee: 75, totalPrice: 1615, notes: 'Winterurlaub',
    lexofficeInvoiceId: 'lex-inv-008', invoiceNumber: 'RE-2026-015',
    createdAt: '2026-01-10', updatedAt: '2026-02-14', source: 'lexoffice_import'
  },
  {
    id: 'book-9', bookingNumber: 'BU-2026-005', propertyId: 'prop-5', customerId: 'cust-3',
    checkIn: '2026-02-17', checkOut: '2026-02-20', nights: 3, bedsBooked: 1,
    status: 'abgeschlossen', paymentStatus: 'bezahlt',
    pricePerBedNight: 160, cleaningFee: 55, totalPrice: 535, notes: 'Geschäftsreise',
    lexofficeInvoiceId: 'lex-inv-009', invoiceNumber: 'RE-2026-019',
    createdAt: '2026-02-01', updatedAt: '2026-02-20', source: 'lexoffice_import'
  },
  // März 2026 - aktuell laufende & bevorstehende Buchungen
  {
    id: 'book-10', bookingNumber: 'BU-2026-006', propertyId: 'prop-1', customerId: 'cust-2',
    checkIn: '2026-03-01', checkOut: '2026-03-08', nights: 7, bedsBooked: 3,
    status: 'bestaetigt', paymentStatus: 'offen',
    pricePerBedNight: 180, cleaningFee: 60, totalPrice: 1320, notes: '',
    lexofficeQuotationId: 'lex-quot-010', invoiceNumber: 'AN-2026-022',
    createdAt: '2026-02-15', updatedAt: '2026-02-15', source: 'manual'
  },
  {
    id: 'book-11', bookingNumber: 'BU-2026-007', propertyId: 'prop-3', customerId: 'cust-4',
    checkIn: '2026-03-15', checkOut: '2026-03-22', nights: 7, bedsBooked: 4,
    status: 'bestaetigt', paymentStatus: 'offen',
    pricePerBedNight: 350, cleaningFee: 120, totalPrice: 2570, notes: 'Osterferien',
    createdAt: '2026-02-20', updatedAt: '2026-02-20', source: 'manual'
  },
  {
    id: 'book-12', bookingNumber: 'BU-2026-008', propertyId: 'prop-4', customerId: 'cust-1',
    checkIn: '2026-03-05', checkOut: '2026-03-09', nights: 4, bedsBooked: 2,
    status: 'option', paymentStatus: 'offen',
    pricePerBedNight: 95, cleaningFee: 40, totalPrice: 420, notes: 'Wartet auf Bestätigung',
    createdAt: '2026-02-28', updatedAt: '2026-02-28', source: 'manual'
  },
  // April 2026 - Vorschaubuchungen
  {
    id: 'book-13', bookingNumber: 'BU-2026-009', propertyId: 'prop-6', customerId: 'cust-3',
    checkIn: '2026-04-03', checkOut: '2026-04-06', nights: 3, bedsBooked: 1,
    status: 'bestaetigt', paymentStatus: 'offen',
    pricePerBedNight: 130, cleaningFee: 45, totalPrice: 435, notes: 'Geschäftsreise April',
    createdAt: '2026-03-01', updatedAt: '2026-03-01', source: 'manual'
  },
  {
    id: 'book-14', bookingNumber: 'BU-2026-010', propertyId: 'prop-2', customerId: 'cust-1',
    checkIn: '2026-03-20', checkOut: '2026-03-27', nights: 7, bedsBooked: 4,
    status: 'bestaetigt', paymentStatus: 'teilweise',
    pricePerBedNight: 220, cleaningFee: 75, totalPrice: 1615, notes: '',
    lexofficeQuotationId: 'lex-quot-014', invoiceNumber: 'AN-2026-028',
    createdAt: '2026-03-01', updatedAt: '2026-03-01', source: 'manual'
  },
  {
    id: 'book-15', bookingNumber: 'BU-2026-011', propertyId: 'prop-5', customerId: 'cust-2',
    checkIn: '2026-03-10', checkOut: '2026-03-14', nights: 4, bedsBooked: 2,
    status: 'anfrage', paymentStatus: 'offen',
    pricePerBedNight: 160, cleaningFee: 55, totalPrice: 695, notes: 'Neue Anfrage',
    createdAt: '2026-03-02', updatedAt: '2026-03-02', source: 'manual'
  },
]
