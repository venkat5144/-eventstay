import pg from "pg";
const { Pool } = pg;
export const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined });
pool.on("error", err => console.error("Unexpected PostgreSQL pool error", err));
export async function query(text, params) { return pool.query(text, params); }
export async function initDb() {
 await pool.query(`
 CREATE EXTENSION IF NOT EXISTS pgcrypto;
 CREATE TABLE IF NOT EXISTS organizers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, email text NOT NULL UNIQUE, password_hash text NOT NULL, role text NOT NULL DEFAULT 'organizer' CHECK(role IN ('organizer','hotel_owner','hotel_staff','admin')), created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organizer_id uuid NOT NULL REFERENCES organizers(id) ON DELETE CASCADE, name text NOT NULL, bride_name text, groom_name text, starts_on date, ends_on date, venue_name text, venue_address text, created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS hotels (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organizer_id uuid NOT NULL REFERENCES organizers(id) ON DELETE CASCADE, name text NOT NULL, phone text, address text, created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS rooms (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE, room_number text NOT NULL, floor text, capacity integer NOT NULL CHECK(capacity > 0), UNIQUE(hotel_id,room_number));
 CREATE TABLE IF NOT EXISTS guests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE, name text NOT NULL, phone text, address text, side text NOT NULL DEFAULT 'Other', guest_count integer NOT NULL DEFAULT 1 CHECK(guest_count > 0), photo_url text, created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS invitations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), guest_id uuid NOT NULL UNIQUE REFERENCES guests(id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','delivered','responded')), sent_at timestamptz);
 CREATE TABLE IF NOT EXISTS allocations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), guest_id uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE, room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, check_in date, check_out date, guest_count integer NOT NULL DEFAULT 1 CHECK(guest_count > 0), status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','checked_in','checked_out','cancelled')), created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS qr_passes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), guest_id uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE, token_hash text NOT NULL UNIQUE, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS checkins (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), allocation_id uuid NOT NULL REFERENCES allocations(id) ON DELETE CASCADE, action text NOT NULL CHECK(action IN ('check_in','check_out')), recorded_at timestamptz NOT NULL DEFAULT now(), recorded_by uuid REFERENCES organizers(id));
 CREATE TABLE IF NOT EXISTS wedding_contacts (
   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
   event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
   name text NOT NULL,
   phone text NOT NULL,
   address text,
   side text NOT NULL DEFAULT 'Other',
   photo_data text,
   status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent')),
   sent_at timestamptz,
   created_at timestamptz NOT NULL DEFAULT now(),
   updated_at timestamptz NOT NULL DEFAULT now()
 );
 CREATE INDEX IF NOT EXISTS wedding_contacts_event_idx ON wedding_contacts(event_id,created_at DESC);
 CREATE INDEX IF NOT EXISTS events_organizer_idx ON events(organizer_id);
 CREATE INDEX IF NOT EXISTS guests_event_idx ON guests(event_id);
 CREATE INDEX IF NOT EXISTS allocations_room_idx ON allocations(room_id);
 
 -- Multi-property structure and event-to-hotel links.
 CREATE TABLE IF NOT EXISTS hotel_memberships (
   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
   hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
   user_id uuid NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
   role text NOT NULL CHECK(role IN ('owner','manager','front_desk')),
   created_at timestamptz NOT NULL DEFAULT now(),
   UNIQUE(hotel_id,user_id)
 );
 CREATE TABLE IF NOT EXISTS buildings (
   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
   hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
   name text NOT NULL,
   UNIQUE(hotel_id,name)
 );
 CREATE TABLE IF NOT EXISTS floors (
   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
   building_id uuid NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
   name text NOT NULL,
   UNIQUE(building_id,name)
 );
 CREATE TABLE IF NOT EXISTS event_hotels (
   event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
   hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
   created_at timestamptz NOT NULL DEFAULT now(),
   PRIMARY KEY(event_id,hotel_id)
 );
 CREATE TABLE IF NOT EXISTS family_groups (
   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
   event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
   name text NOT NULL,
   side text NOT NULL DEFAULT 'Other',
   created_at timestamptz NOT NULL DEFAULT now()
 );
 CREATE TABLE IF NOT EXISTS audit_logs (
   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
   organizer_id uuid REFERENCES organizers(id) ON DELETE SET NULL,
   actor_id uuid REFERENCES organizers(id) ON DELETE SET NULL,
   action text NOT NULL,
   entity_type text NOT NULL,
   entity_id uuid,
   details jsonb NOT NULL DEFAULT '{}'::jsonb,
   created_at timestamptz NOT NULL DEFAULT now()
 );
 ALTER TABLE guests ADD COLUMN IF NOT EXISTS adult_count integer NOT NULL DEFAULT 1 CHECK(adult_count >= 0);
 ALTER TABLE guests ADD COLUMN IF NOT EXISTS child_count integer NOT NULL DEFAULT 0 CHECK(child_count >= 0);
 ALTER TABLE guests ADD COLUMN IF NOT EXISTS family_group_id uuid REFERENCES family_groups(id) ON DELETE SET NULL;
 ALTER TABLE rooms ADD COLUMN IF NOT EXISTS building_id uuid REFERENCES buildings(id) ON DELETE SET NULL;
 ALTER TABLE rooms ADD COLUMN IF NOT EXISTS floor_id uuid REFERENCES floors(id) ON DELETE SET NULL;
 ALTER TABLE hotel_memberships DROP CONSTRAINT IF EXISTS hotel_memberships_role_check;
 ALTER TABLE hotel_memberships ADD CONSTRAINT hotel_memberships_role_check CHECK(role IN ('owner','manager','front_desk'));
 CREATE INDEX IF NOT EXISTS hotel_memberships_user_idx ON hotel_memberships(user_id);
 CREATE INDEX IF NOT EXISTS family_groups_event_idx ON family_groups(event_id);
 CREATE INDEX IF NOT EXISTS audit_logs_tenant_idx ON audit_logs(organizer_id,created_at DESC);
 `);
}
