-- Create storage bucket for reading photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'reading-photos',
  'reading-photos',
  false, -- Private bucket with RLS
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- RLS policies for storage bucket
CREATE POLICY "Tenant isolation for reading photos upload"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'reading-photos' AND
  (storage.foldername(name))[1] = get_auth_tenant_id()::text
);

CREATE POLICY "Tenant isolation for reading photos select"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'reading-photos' AND
  (storage.foldername(name))[1] = get_auth_tenant_id()::text
);

CREATE POLICY "Tenant isolation for reading photos update"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'reading-photos' AND
  (storage.foldername(name))[1] = get_auth_tenant_id()::text
);

CREATE POLICY "Tenant isolation for reading photos delete"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'reading-photos' AND
  (storage.foldername(name))[1] = get_auth_tenant_id()::text AND
  has_role(get_auth_user_id(), get_auth_tenant_id(), ARRAY['admin', 'manager'])
);

-- Update meter_readings table to include photo URL
ALTER TABLE meter_readings
ADD COLUMN IF NOT EXISTS photo_url TEXT,
ADD COLUMN IF NOT EXISTS photo_metadata JSONB DEFAULT '{}';

-- Index for photo URLs
CREATE INDEX IF NOT EXISTS idx_meter_readings_photo_url 
ON meter_readings(tenant_id, photo_url) 
WHERE photo_url IS NOT NULL;