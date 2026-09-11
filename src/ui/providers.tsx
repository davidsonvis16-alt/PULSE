import type { ReactNode } from 'react';
import { ToastProvider } from '@/src/ui/toast';
import { ShareSheetProvider } from '@/src/ui/share-sheet';
import { TrackActionsProvider } from '@/src/ui/track-actions';

/** One place to mount every app-wide surface, in dependency order. */
export function PulseProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ShareSheetProvider>
        <TrackActionsProvider>{children}</TrackActionsProvider>
      </ShareSheetProvider>
    </ToastProvider>
  );
}
