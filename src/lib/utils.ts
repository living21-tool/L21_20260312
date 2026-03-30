import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { differenceInDays, parseISO, format } from 'date-fns'
import { de } from 'date-fns/locale'
import { BookingStatus, PaymentStatus } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount)
}

export function formatDate(dateStr: string, formatStr = 'dd.MM.yyyy'): string {
  return format(parseISO(dateStr), formatStr, { locale: de })
}

export function formatDateShort(dateStr: string): string {
  return format(parseISO(dateStr), 'dd.MM.', { locale: de })
}

export function normalizeLocationName(name: string): string {
  return name.replace(/^NRW\s+/i, '').trim()
}

export function formatLocationLabel(name?: string | null, city?: string | null, separator = ' · '): string {
  const normalizedName = name ? normalizeLocationName(name) : ''
  const trimmedCity = city?.trim() ?? ''

  if (normalizedName && trimmedCity) {
    return normalizedName === trimmedCity ? normalizedName : `${normalizedName}${separator}${trimmedCity}`
  }

  return normalizedName || trimmedCity
}

export function calcNights(checkIn: string, checkOut: string): number {
  return differenceInDays(parseISO(checkOut), parseISO(checkIn))
}

export const statusConfig: Record<BookingStatus, { label: string; color: string; bg: string; dot: string }> = {
  anfrage:      { label: 'Anfrage',      color: 'text-gray-700',   bg: 'bg-gray-100',    dot: 'bg-gray-400' },
  option:       { label: 'Option',       color: 'text-amber-700',  bg: 'bg-amber-100',   dot: 'bg-amber-400' },
  bestaetigt:   { label: 'Bestätigt',    color: 'text-emerald-700',bg: 'bg-emerald-100', dot: 'bg-emerald-500' },
  storniert:    { label: 'Storniert',    color: 'text-red-700',    bg: 'bg-red-100',     dot: 'bg-red-500' },
  abgeschlossen:{ label: 'Abgeschlossen',color: 'text-blue-700',   bg: 'bg-blue-100',    dot: 'bg-blue-500' },
}

export const paymentConfig: Record<PaymentStatus, { label: string; color: string; bg: string }> = {
  offen:      { label: 'Offen',      color: 'text-red-700',    bg: 'bg-red-100' },
  teilweise:  { label: 'Teilbezahlt',color: 'text-amber-700',  bg: 'bg-amber-100' },
  bezahlt:    { label: 'Bezahlt',    color: 'text-emerald-700',bg: 'bg-emerald-100' },
  erstattet:  { label: 'Erstattet', color: 'text-gray-700',   bg: 'bg-gray-100' },
}
