import { useAppStateBootstrap } from './useAppStateBootstrap';
import { useAppRuntimeWiring } from './useAppRuntimeWiring';

export function useAppOrchestrator() {
  return useAppRuntimeWiring(useAppStateBootstrap());
}
