-- ============================================================================
-- Migration: Employee Assignments + erweiterte Profilfelder
-- Ausfuehren in Supabase SQL Editor
-- ============================================================================

-- 1. Neue Spalten in profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS phone text DEFAULT '',
  ADD COLUMN IF NOT EXISTS notes text DEFAULT '';

-- 2. Neue Tabelle: employee_assignments
CREATE TABLE IF NOT EXISTS employee_assignments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  property_id text NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  role_type text NOT NULL CHECK (role_type IN ('hausmeister', 'reinigung', 'verwaltung')),
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),

  -- Ein Mitarbeiter kann pro Objekt nur eine Rolle haben
  UNIQUE (profile_id, property_id, role_type)
);

-- 3. Index fuer schnelle Abfragen
CREATE INDEX IF NOT EXISTS idx_employee_assignments_profile ON employee_assignments(profile_id);
CREATE INDEX IF NOT EXISTS idx_employee_assignments_property ON employee_assignments(property_id);

-- 4. RLS aktivieren
ALTER TABLE employee_assignments ENABLE ROW LEVEL SECURITY;

-- Alle authentifizierten User duerfen lesen
CREATE POLICY "Authenticated users can read assignments"
  ON employee_assignments FOR SELECT
  TO authenticated
  USING (true);

-- Nur Admins duerfen schreiben (INSERT/UPDATE/DELETE)
-- Hinweis: Prueft ob der User in profiles die Rolle 'admin' hat
CREATE POLICY "Admins can manage assignments"
  ON employee_assignments FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );
