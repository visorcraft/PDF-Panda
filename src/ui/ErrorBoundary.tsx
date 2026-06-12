import { Component, type ErrorInfo, type ReactNode } from 'react';

type ErrorBoundaryProps = {
  children: ReactNode;
  /** Rendered when an error is caught. Receives the error object and a reset callback. */
  fallback?: (error: Error | null, onReset: () => void) => ReactNode;
  /** Called when an error is caught. Use for logging/telemetry. */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Called when the user clicks the reset action. */
  onReset?: () => void;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.props.onError?.(error, errorInfo);
  }

  private handleReset = () => {
    this.props.onReset?.();
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback(this.state.error, this.handleReset);
    }

    return (
      <div className="error-boundary" role="alert">
        <h2>Something went wrong</h2>
        {this.state.error && (
          <p className="error-boundary-message">{this.state.error.message}</p>
        )}
        <div className="error-boundary-actions">
          <button type="button" onClick={this.handleReset}>
            Try again
          </button>
          <button type="button" onClick={() => window.location.reload()}>
            Reload app
          </button>
        </div>
      </div>
    );
  }
}
