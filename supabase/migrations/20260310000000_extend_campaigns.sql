-- Extend campaigns table with new columns
ALTER TABLE campaigns
  ADD COLUMN deadline DATE,
  ADD COLUMN location TEXT,
  ADD COLUMN timezone TEXT DEFAULT 'UTC',
  ADD COLUMN screening_criteria JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Create index on user_id for faster lookups
CREATE INDEX idx_campaigns_user_id ON campaigns(user_id);

-- Drop existing RLS policies (if any)
DROP POLICY IF EXISTS "Users can view their own campaigns" ON campaigns;
DROP POLICY IF EXISTS "Users can insert their own campaigns" ON campaigns;
DROP POLICY IF EXISTS "Users can update their own campaigns" ON campaigns;
DROP POLICY IF EXISTS "Users can delete their own campaigns" ON campaigns;

-- RLS policies scoped to campaign owner
CREATE POLICY "Users can view their own campaigns"
  ON campaigns FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own campaigns"
  ON campaigns FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own campaigns"
  ON campaigns FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own campaigns"
  ON campaigns FOR DELETE
  USING (auth.uid() = user_id);
