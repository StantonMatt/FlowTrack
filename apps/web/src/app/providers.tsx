'use client';

import { ReactNode } from 'react';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  // TODO: Add QueryClientProvider once @tanstack/react-query is installed
  // TODO: Add Theme provider once configured
  return <>{children}</>;
}