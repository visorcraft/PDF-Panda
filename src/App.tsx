import { AppShell } from './chrome/AppShell';
import { useAppOrchestrator } from './app/useAppOrchestrator';

function App() {
  const shell = useAppOrchestrator();
  return <AppShell {...shell} />;
}

export default App;
