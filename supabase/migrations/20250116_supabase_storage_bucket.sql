-- Create storage bucket for meter photos
INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES (
  'meter-photos',
  'meter-photos', 
  false,  -- Private bucket with RLS
  false,
  5242880, -- 5MB limit per file
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heif', 'image/heic']
) ON CONFLICT (id) DO NOTHING;

-- RLS policies for meter photos bucket
CREATE POLICY "Tenants can upload meter photos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'meter-photos' AND
  -- Ensure the path follows: readings/{tenant_id}/{filename}
  (storage.foldername(name))[1] = 'readings' AND
  (storage.foldername(name))[2] = auth.jwt()->>'tenant_id'
);

CREATE POLICY "Tenants can view their meter photos"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'meter-photos' AND
  (storage.foldername(name))[1] = 'readings' AND
  (storage.foldername(name))[2] = auth.jwt()->>'tenant_id'
);

CREATE POLICY "Tenants can delete their meter photos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'meter-photos' AND
  (storage.foldername(name))[1] = 'readings' AND
  (storage.foldername(name))[2] = auth.jwt()->>'tenant_id'
);

-- Add photo_url column to meter_readings table if not exists
ALTER TABLE meter_readings 
ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- Create index for photo URLs
CREATE INDEX IF NOT EXISTS idx_meter_readings_photo_url 
ON meter_readings(tenant_id, photo_url) 
WHERE photo_url IS NOT NULL;

-- Create a function to clean up orphaned photos
CREATE OR REPLACE FUNCTION cleanup_orphaned_photos()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER := 0;
  photo_record RECORD;
BEGIN
  -- Find photos in storage that don't have corresponding readings
  FOR photo_record IN 
    SELECT name, created_at
    FROM storage.objects
    WHERE bucket_id = 'meter-photos'
      AND created_at < NOW() - INTERVAL '30 days'
  LOOP
    -- Check if any reading references this photo
    IF NOT EXISTS (
      SELECT 1 FROM meter_readings 
      WHERE photo_url LIKE '%' || photo_record.name
    ) THEN
      -- Delete orphaned photo
      DELETE FROM storage.objects 
      WHERE bucket_id = 'meter-photos' 
        AND name = photo_record.name;
      deleted_count := deleted_count + 1;
    END IF;
  END LOOP;
  
  RETURN deleted_count;
END;
$$;

-- Create a scheduled job to clean up orphaned photos (requires pg_cron extension)
-- This will be set up via Supabase dashboard or API
COMMENT ON FUNCTION cleanup_orphaned_photos() IS 
'Removes photos from storage that are not referenced by any readings. Schedule via pg_cron: SELECT cron.schedule(''cleanup-orphaned-photos'', ''0 2 * * 0'', $$SELECT cleanup_orphaned_photos();$$);';