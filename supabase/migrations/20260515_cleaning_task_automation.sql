-- Automatische Reinigungsaufgaben: booking_id auf tasks für Duplikat-Schutz

-- 1. booking_id Spalte hinzufügen
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS booking_id text REFERENCES public.bookings(id) ON DELETE SET NULL;

-- 2. Partial Unique Index: max. ein aktiver Reinigungs-Task pro Buchung
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_one_cleaning_per_booking
  ON public.tasks (booking_id)
  WHERE booking_id IS NOT NULL AND archived_at IS NULL;

-- 3. Lookup-Index für property + booking
CREATE INDEX IF NOT EXISTS idx_tasks_property_booking
  ON public.tasks (property_id, booking_id)
  WHERE booking_id IS NOT NULL;
