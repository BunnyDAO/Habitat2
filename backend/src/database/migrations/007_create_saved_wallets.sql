-- Migration: Create saved_wallets table
CREATE TABLE IF NOT EXISTS saved_wallets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id text NOT NULL,
    wallet_address text NOT NULL,
    name text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    extra_data jsonb
);

-- Index for fast lookup by owner
CREATE INDEX IF NOT EXISTS idx_saved_wallets_owner_id ON saved_wallets(owner_id); 