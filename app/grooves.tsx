import { PageHeader, Screen } from '@/src/ui/screen';
import { GroovesList } from '@/src/screens/grooves';

export default function GroovesRoute() {
  return (
    <Screen>
      <PageHeader title="Grooves" subtitle="Found in your own collection" />
      <GroovesList />
    </Screen>
  );
}
