import { createClient } from '@/lib/supabase/client';
import type { SupabaseClient } from '@supabase/supabase-js';

export class InvoiceStorageService {
  private supabase: SupabaseClient;
  private bucketName = 'invoices';

  constructor(supabase?: SupabaseClient) {
    this.supabase = supabase || createClient();
  }

  /**
   * Ensure the invoices bucket exists with proper configuration
   */
  async ensureBucket(): Promise<void> {
    try {
      const { data: buckets } = await this.supabase.storage.listBuckets();
      
      if (!buckets?.some(b => b.name === this.bucketName)) {
        const { error } = await this.supabase.storage.createBucket(this.bucketName, {
          public: false, // Private bucket - require auth
          fileSizeLimit: 10485760, // 10MB max
          allowedMimeTypes: ['application/pdf'],
        });
        
        if (error && !error.message.includes('already exists')) {
          throw error;
        }
      }
    } catch (error) {
      console.error('Failed to ensure bucket:', error);
      // Continue anyway - bucket might exist already
    }
  }

  /**
   * Generate deterministic storage path for invoice PDF
   */
  getInvoicePath(tenantId: string, invoiceNumber: string): string {
    // Clean invoice number to be filesystem safe
    const safeInvoiceNumber = invoiceNumber.replace(/[^a-zA-Z0-9-_]/g, '_');
    return `tenants/${tenantId}/invoices/${safeInvoiceNumber}.pdf`;
  }

  /**
   * Upload invoice PDF to storage
   */
  async uploadInvoicePDF(
    tenantId: string,
    invoiceNumber: string,
    pdfBuffer: Uint8Array,
    options?: {
      upsert?: boolean;
      contentType?: string;
      cacheControl?: string;
    }
  ): Promise<{ path: string; error?: string }> {
    try {
      await this.ensureBucket();
      
      const path = this.getInvoicePath(tenantId, invoiceNumber);
      
      const { error } = await this.supabase.storage
        .from(this.bucketName)
        .upload(path, pdfBuffer, {
          contentType: options?.contentType || 'application/pdf',
          cacheControl: options?.cacheControl || '3600',
          upsert: options?.upsert !== false, // Default to true
        });

      if (error) {
        throw error;
      }

      return { path };
    } catch (error) {
      console.error('Failed to upload invoice PDF:', error);
      return { 
        path: '', 
        error: error instanceof Error ? error.message : 'Upload failed' 
      };
    }
  }

  /**
   * Get a signed URL for temporary access to invoice PDF
   */
  async getSignedUrl(
    path: string,
    expiresIn: number = 3600 // 1 hour default
  ): Promise<{ url?: string; error?: string }> {
    try {
      const { data, error } = await this.supabase.storage
        .from(this.bucketName)
        .createSignedUrl(path, expiresIn);

      if (error) {
        throw error;
      }

      return { url: data.signedUrl };
    } catch (error) {
      console.error('Failed to create signed URL:', error);
      return { 
        error: error instanceof Error ? error.message : 'Failed to create signed URL' 
      };
    }
  }

  /**
   * Get signed URL by tenant and invoice number
   */
  async getInvoiceSignedUrl(
    tenantId: string,
    invoiceNumber: string,
    expiresIn: number = 3600
  ): Promise<{ url?: string; error?: string }> {
    const path = this.getInvoicePath(tenantId, invoiceNumber);
    return this.getSignedUrl(path, expiresIn);
  }

  /**
   * Download invoice PDF
   */
  async downloadInvoicePDF(
    path: string
  ): Promise<{ data?: Blob; error?: string }> {
    try {
      const { data, error } = await this.supabase.storage
        .from(this.bucketName)
        .download(path);

      if (error) {
        throw error;
      }

      return { data };
    } catch (error) {
      console.error('Failed to download invoice PDF:', error);
      return { 
        error: error instanceof Error ? error.message : 'Download failed' 
      };
    }
  }

  /**
   * Delete invoice PDF from storage
   */
  async deleteInvoicePDF(path: string): Promise<{ error?: string }> {
    try {
      const { error } = await this.supabase.storage
        .from(this.bucketName)
        .remove([path]);

      if (error) {
        throw error;
      }

      return {};
    } catch (error) {
      console.error('Failed to delete invoice PDF:', error);
      return { 
        error: error instanceof Error ? error.message : 'Delete failed' 
      };
    }
  }

  /**
   * List all invoices for a tenant
   */
  async listTenantInvoices(
    tenantId: string,
    options?: {
      limit?: number;
      offset?: number;
      sortBy?: 'name' | 'created_at' | 'updated_at';
    }
  ): Promise<{ files?: any[]; error?: string }> {
    try {
      const path = `tenants/${tenantId}/invoices`;
      
      const { data, error } = await this.supabase.storage
        .from(this.bucketName)
        .list(path, {
          limit: options?.limit || 100,
          offset: options?.offset || 0,
          sortBy: {
            column: options?.sortBy || 'created_at',
            order: 'desc',
          },
        });

      if (error) {
        throw error;
      }

      return { files: data };
    } catch (error) {
      console.error('Failed to list tenant invoices:', error);
      return { 
        error: error instanceof Error ? error.message : 'List failed' 
      };
    }
  }

  /**
   * Check if invoice PDF exists
   */
  async invoiceExists(tenantId: string, invoiceNumber: string): Promise<boolean> {
    try {
      const path = this.getInvoicePath(tenantId, invoiceNumber);
      
      const { data, error } = await this.supabase.storage
        .from(this.bucketName)
        .download(path, {
          transform: {
            width: 1,
            height: 1,
          },
        });

      return !error && !!data;
    } catch {
      return false;
    }
  }

  /**
   * Get public URL (requires bucket to be public or RLS policy)
   */
  getPublicUrl(path: string): string {
    const { data } = this.supabase.storage
      .from(this.bucketName)
      .getPublicUrl(path);
    
    return data.publicUrl;
  }

  /**
   * Copy invoice to another location (e.g., for archiving)
   */
  async copyInvoice(
    sourcePath: string,
    destinationPath: string
  ): Promise<{ error?: string }> {
    try {
      // Download the source file
      const { data: sourceData, error: downloadError } = await this.supabase.storage
        .from(this.bucketName)
        .download(sourcePath);

      if (downloadError) {
        throw downloadError;
      }

      // Upload to destination
      const { error: uploadError } = await this.supabase.storage
        .from(this.bucketName)
        .upload(destinationPath, sourceData, {
          contentType: 'application/pdf',
        });

      if (uploadError) {
        throw uploadError;
      }

      return {};
    } catch (error) {
      console.error('Failed to copy invoice:', error);
      return { 
        error: error instanceof Error ? error.message : 'Copy failed' 
      };
    }
  }

  /**
   * Move invoice to another location
   */
  async moveInvoice(
    sourcePath: string,
    destinationPath: string
  ): Promise<{ error?: string }> {
    try {
      // Copy to new location
      const { error: copyError } = await this.copyInvoice(sourcePath, destinationPath);
      if (copyError) {
        throw new Error(copyError);
      }

      // Delete original
      const { error: deleteError } = await this.deleteInvoicePDF(sourcePath);
      if (deleteError) {
        // Try to clean up the copy
        await this.deleteInvoicePDF(destinationPath);
        throw new Error(deleteError);
      }

      return {};
    } catch (error) {
      console.error('Failed to move invoice:', error);
      return { 
        error: error instanceof Error ? error.message : 'Move failed' 
      };
    }
  }
}