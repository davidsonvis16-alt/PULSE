import { Screen, PageHeader } from '@/src/ui/screen';
import { DownloadsScreen } from '@/src/screens/downloads';

export default function DownloadsRoute() {
  return (
    <Screen>
      <PageHeader title="Downloads" subtitle="Yours, offline" />
      <DownloadsScreen />
    </Screen>
  );
}
