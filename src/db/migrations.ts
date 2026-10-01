// Migrations are kept as strings so they end up in the compiled build without a copy step.
// Model: Province 1-* District 1-* GridSubstation 1-* SolarInstallation 1-* GenerationReading, plus User.
export interface Migration {
  version: string;
  description: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: '001',
    description: 'initial domain schema',
    sql: `
-- ids are ISO 3166-2:LK codes in lower case, e.g. lk-1 = Western
CREATE TABLE province (
  province_id  text PRIMARY KEY CHECK (province_id ~ '^[a-z0-9-]+$'),
  name         text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE district (
  district_id  text PRIMARY KEY CHECK (district_id ~ '^[a-z0-9-]+$'),
  province_id  text NOT NULL REFERENCES province (province_id) ON DELETE RESTRICT,
  name         text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX district_province_idx ON district (province_id);

CREATE TABLE grid_substation (
  grid_substation_id text PRIMARY KEY CHECK (grid_substation_id ~ '^[a-z0-9-]+$'),
  district_id        text NOT NULL REFERENCES district (district_id) ON DELETE RESTRICT,
  name               text NOT NULL UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX grid_substation_district_idx ON grid_substation (district_id);

-- meter_id is stored on the installation (no separate device table).
-- Installations are soft-deleted so their reading history stays in place.
CREATE SEQUENCE solar_installation_number_seq START 1;
CREATE TABLE solar_installation (
  installation_id     text PRIMARY KEY CHECK (installation_id ~ '^[a-z0-9-]+$'),
  grid_substation_id  text NOT NULL REFERENCES grid_substation (grid_substation_id) ON DELETE RESTRICT,
  meter_id            text NOT NULL CHECK (meter_id ~ '^[A-Za-z0-9-]{3,40}$'),
  name                text NOT NULL,
  capacity_kw         double precision NOT NULL CHECK (capacity_kw > 0 AND capacity_kw <= 1000),
  commissioned_on     date NOT NULL,
  latitude            double precision NOT NULL CHECK (latitude BETWEEN 5.5 AND 10.0),
  longitude           double precision NOT NULL CHECK (longitude BETWEEN 79.3 AND 82.1),
  device_secret_hash  text,                 -- NULL once the installation is deleted
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
-- a meter can only be on one active installation
CREATE UNIQUE INDEX solar_installation_meter_active_uq ON solar_installation (meter_id) WHERE deleted_at IS NULL;
CREATE INDEX solar_installation_substation_idx ON solar_installation (grid_substation_id);

-- append-only: readings are never updated or deleted
CREATE TABLE generation_reading (
  reading_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  installation_id  text NOT NULL REFERENCES solar_installation (installation_id) ON DELETE RESTRICT,
  "timestamp"      timestamptz NOT NULL,                              -- measurement time from the meter
  power_kw         double precision NOT NULL CHECK (power_kw >= 0),
  energy_kwh       double precision NOT NULL CHECK (energy_kwh >= 0), -- cumulative meter reading
  voltage_v        double precision NOT NULL CHECK (voltage_v > 0 AND voltage_v < 500),
  received_at      timestamptz NOT NULL DEFAULT now(),                -- set by the server
  CONSTRAINT generation_reading_installation_timestamp_uq UNIQUE (installation_id, "timestamp")
);
-- (installation_id, timestamp) is already indexed by the unique constraint
CREATE INDEX generation_reading_timestamp_idx ON generation_reading ("timestamp");

-- enforce append-only in the database as well as in the API
CREATE FUNCTION generation_reading_is_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'generation_reading is append-only: % is not permitted', TG_OP USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER generation_reading_no_update_or_delete
  BEFORE UPDATE OR DELETE ON generation_reading
  FOR EACH ROW EXECUTE FUNCTION generation_reading_is_append_only();

CREATE TABLE app_user (
  user_id        text PRIMARY KEY CHECK (user_id ~ '^[a-z0-9-]+$'),
  username       text NOT NULL UNIQUE,
  display_name   text NOT NULL,
  password_hash  text NOT NULL,
  role           text NOT NULL CHECK (role IN ('national', 'provincial', 'district')),
  province_id    text REFERENCES province (province_id) ON DELETE RESTRICT,
  district_id    text REFERENCES district (district_id) ON DELETE RESTRICT,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_user_jurisdiction_ck CHECK (
       (role = 'national'   AND province_id IS NULL     AND district_id IS NULL)
    OR (role = 'provincial' AND province_id IS NOT NULL AND district_id IS NULL)
    OR (role = 'district'   AND district_id IS NOT NULL AND province_id IS NULL)
  )
);
`,
  },
  {
    version: '002',
    description: 'block TRUNCATE of the append-only reading history',
    sql: `
-- row-level triggers don't fire on TRUNCATE
CREATE TRIGGER generation_reading_no_truncate
  BEFORE TRUNCATE ON generation_reading
  FOR EACH STATEMENT EXECUTE FUNCTION generation_reading_is_append_only();
`,
  },
];
