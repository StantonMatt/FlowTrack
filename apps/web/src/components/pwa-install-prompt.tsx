'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Download, X } from 'lucide-react';
import { toast } from 'sonner';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isInStandaloneMode, setIsInStandaloneMode] = useState(false);

  useEffect(() => {
    // Check if already installed
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                        (window.navigator as any).standalone ||
                        document.referrer.includes('android-app://');
    
    setIsInStandaloneMode(isStandalone);

    // Check if iOS
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && 
                       !(window as any).MSStream;
    setIsIOS(isIOSDevice);

    if (isStandalone) {
      return; // Already installed
    }

    // Handle the install prompt event
    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent Chrome 67 and earlier from automatically showing the prompt
      e.preventDefault();
      // Stash the event so it can be triggered later
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      
      // Check if user has dismissed the prompt before
      const hasBeenDismissed = localStorage.getItem('pwa-install-dismissed');
      const dismissedTime = hasBeenDismissed ? parseInt(hasBeenDismissed) : 0;
      const daysSinceDismissed = (Date.now() - dismissedTime) / (1000 * 60 * 60 * 24);
      
      // Show prompt if not dismissed or if it's been more than 7 days
      if (!hasBeenDismissed || daysSinceDismissed > 7) {
        setTimeout(() => setShowPrompt(true), 3000); // Show after 3 seconds
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Handle successful installation
    const handleAppInstalled = () => {
      console.log('PWA was installed');
      setDeferredPrompt(null);
      setShowPrompt(false);
      toast.success('FlowTrack installed successfully!', {
        description: 'You can now access FlowTrack from your home screen.',
      });
    };

    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) {
      console.log('No deferred prompt available');
      return;
    }

    try {
      // Show the install prompt
      await deferredPrompt.prompt();
      
      // Wait for the user to respond to the prompt
      const { outcome } = await deferredPrompt.userChoice;
      
      if (outcome === 'accepted') {
        console.log('User accepted the install prompt');
      } else {
        console.log('User dismissed the install prompt');
        // Remember that user dismissed
        localStorage.setItem('pwa-install-dismissed', Date.now().toString());
      }
    } catch (error) {
      console.error('Error during installation:', error);
      toast.error('Installation failed', {
        description: 'Please try again later.',
      });
    } finally {
      setDeferredPrompt(null);
      setShowPrompt(false);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem('pwa-install-dismissed', Date.now().toString());
  };

  // Don't show anything if already installed
  if (isInStandaloneMode) {
    return null;
  }

  // iOS requires manual installation
  if (isIOS && showPrompt) {
    return (
      <Dialog open={showPrompt} onOpenChange={setShowPrompt}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Install FlowTrack</DialogTitle>
            <DialogDescription>
              Install FlowTrack on your iPhone for the best experience.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <ol className="list-decimal list-inside space-y-2 text-sm">
              <li>Tap the Share button in Safari</li>
              <li>Scroll down and tap "Add to Home Screen"</li>
              <li>Tap "Add" to install</li>
            </ol>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={handleDismiss}>
              Maybe later
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Chrome/Edge install prompt
  if (deferredPrompt && showPrompt) {
    return (
      <Dialog open={showPrompt} onOpenChange={setShowPrompt}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Install FlowTrack</DialogTitle>
            <DialogDescription>
              Install FlowTrack for quick access and offline functionality.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="flex items-start gap-3">
              <Download className="h-5 w-5 text-primary mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Benefits of installing:</p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Work offline without internet</li>
                  <li>• Quick access from home screen</li>
                  <li>• Full-screen experience</li>
                  <li>• Background sync for readings</li>
                </ul>
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={handleDismiss}>
              Maybe later
            </Button>
            <Button onClick={handleInstall}>
              <Download className="h-4 w-4 mr-2" />
              Install app
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Floating install button (shown after dismissing dialog)
  const showFloatingButton = deferredPrompt && !showPrompt;
  
  if (showFloatingButton) {
    return (
      <button
        onClick={() => setShowPrompt(true)}
        className="fixed bottom-20 right-4 z-40 flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105"
        aria-label="Install FlowTrack app"
      >
        <Download className="h-4 w-4" />
        <span className="text-sm font-medium">Install app</span>
      </button>
    );
  }

  return null;
}