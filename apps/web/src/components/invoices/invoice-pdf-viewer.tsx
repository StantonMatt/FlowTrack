'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  FileText, 
  Download, 
  RefreshCw, 
  Eye, 
  Trash2, 
  ExternalLink,
  Loader2,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface InvoicePDFViewerProps {
  invoiceId: string;
  invoiceNumber: string;
  className?: string;
}

export function InvoicePDFViewer({ 
  invoiceId, 
  invoiceNumber,
  className 
}: InvoicePDFViewerProps) {
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastGenerated, setLastGenerated] = useState<Date | null>(null);

  // Check for existing PDF on mount
  useEffect(() => {
    checkPDF();
  }, [invoiceId]);

  const checkPDF = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/pdf`);
      const data = await response.json();
      
      if (response.ok && data.url) {
        setPdfUrl(data.url);
        setPdfPath(data.path);
        if (data.generatedAt) {
          setLastGenerated(new Date(data.generatedAt));
        }
      } else if (response.status === 404) {
        // PDF doesn't exist yet
        setPdfUrl(null);
        setPdfPath(null);
      } else {
        setError(data.error || 'Failed to check PDF status');
      }
    } catch (err) {
      console.error('Failed to check PDF:', err);
      setError('Failed to check PDF status');
    } finally {
      setLoading(false);
    }
  };

  const generatePDF = async () => {
    setGenerating(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/pdf`, {
        method: 'POST',
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setPdfUrl(data.url);
        setPdfPath(data.path);
        setLastGenerated(new Date());
        toast.success('Invoice PDF generated successfully');
      } else {
        throw new Error(data.error || 'Failed to generate PDF');
      }
    } catch (err) {
      console.error('Failed to generate PDF:', err);
      const message = err instanceof Error ? err.message : 'Failed to generate PDF';
      setError(message);
      toast.error(message);
    } finally {
      setGenerating(false);
    }
  };

  const regeneratePDF = async () => {
    await generatePDF();
  };

  const deletePDF = async () => {
    if (!confirm('Are you sure you want to delete the PDF? It can be regenerated later.')) {
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/pdf`, {
        method: 'DELETE',
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setPdfUrl(null);
        setPdfPath(null);
        setLastGenerated(null);
        toast.success('PDF deleted successfully');
      } else {
        throw new Error(data.error || 'Failed to delete PDF');
      }
    } catch (err) {
      console.error('Failed to delete PDF:', err);
      const message = err instanceof Error ? err.message : 'Failed to delete PDF';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const viewPDF = () => {
    if (pdfUrl) {
      window.open(pdfUrl, '_blank');
    }
  };

  const downloadPDF = () => {
    if (pdfUrl) {
      const link = document.createElement('a');
      link.href = pdfUrl;
      link.download = `invoice-${invoiceNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('Download started');
    }
  };

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Invoice PDF</CardTitle>
          <CardDescription>Loading PDF status...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Invoice PDF
            </CardTitle>
            <CardDescription>
              {pdfUrl ? 'PDF available for download' : 'Generate PDF document'}
            </CardDescription>
          </div>
          {pdfUrl && (
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <span className="text-sm text-muted-foreground">Ready</span>
            </div>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {pdfUrl ? (
          <>
            {/* PDF Info */}
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status:</span>
                <span className="font-medium">Generated</span>
              </div>
              {lastGenerated && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Generated:</span>
                  <span className="font-medium">
                    {format(lastGenerated, 'MMM dd, yyyy HH:mm')}
                  </span>
                </div>
              )}
              {pdfPath && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">File:</span>
                  <span className="font-mono text-xs truncate max-w-[200px]">
                    {pdfPath.split('/').pop()}
                  </span>
                </div>
              )}
            </div>

            {/* PDF Actions */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={viewPDF}
              >
                <Eye className="h-4 w-4 mr-2" />
                View
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                onClick={downloadPDF}
              >
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                onClick={regeneratePDF}
                disabled={generating}
              >
                {generating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Regenerate
              </Button>
              
              <Button
                variant="ghost"
                size="sm"
                onClick={deletePDF}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            </div>

            {/* Direct Link */}
            <div className="pt-2 border-t">
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={() => {
                  navigator.clipboard.writeText(pdfUrl);
                  toast.success('Link copied to clipboard');
                }}
              >
                <ExternalLink className="h-3 w-3 mr-1" />
                Copy direct link (expires in 1 hour)
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* No PDF */}
            <Alert>
              <FileText className="h-4 w-4" />
              <AlertDescription>
                No PDF has been generated for this invoice yet.
              </AlertDescription>
            </Alert>

            <Button
              onClick={generatePDF}
              disabled={generating}
              className="w-full"
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating PDF...
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4 mr-2" />
                  Generate PDF
                </>
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}