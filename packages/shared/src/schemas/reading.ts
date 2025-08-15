export interface Reading {
  id: string;
  tenant_id: string;
  customer_id: string;
  reading_value: number;
  reading_date: string;
  reading_type: 'manual' | 'automatic' | 'estimated' | 'corrected';
  previous_reading?: number;
  consumption?: number;
  consumption_unit?: string;
  anomaly_flag?: boolean;
  anomaly_type?: string;
  validation_status?: 'pending' | 'validated' | 'failed';
  validation_notes?: string;
  reader_id?: string;
  reader_name?: string;
  photo_url?: string;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface CreateReadingInput {
  customer_id: string;
  reading_value: number;
  reading_date: string;
  reading_type?: 'manual' | 'automatic' | 'estimated' | 'corrected';
  consumption_unit?: string;
  reader_id?: string;
  reader_name?: string;
  photo_url?: string;
  metadata?: Record<string, any>;
}

export interface UpdateReadingInput {
  reading_value?: number;
  reading_date?: string;
  reading_type?: 'manual' | 'automatic' | 'estimated' | 'corrected';
  validation_status?: 'pending' | 'validated' | 'failed';
  validation_notes?: string;
  photo_url?: string;
  metadata?: Record<string, any>;
}