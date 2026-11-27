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
 CREATE INDEX IF NOT EXISTS events_organizer_idx ON events(organizer_id);
 CREATE INDEX IF NOT EXISTS guests_event_idx ON guests(event_id);
 CREATE INDEX IF NOT EXISTS allocations_room_idx ON allocations(room_id);
 `);
}
