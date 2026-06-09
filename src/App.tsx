import { AppShell } from './chrome/AppShell';
import { useAppStateBootstrap } from './app/useAppStateBootstrap';
import { useAppRuntimeWiring } from './app/useAppRuntimeWiring';

function App() {
  const bootstrap = useAppStateBootstrap();
  const shell = useAppRuntimeWiring(bootstrap);
  return <AppShell {...shell} />;
}

export default App;
