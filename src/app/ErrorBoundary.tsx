// SPDX-License-Identifier: MPL-2.0
// Top-level error boundary: shows a recoverable error screen instead of a blank page.

import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps { children: ReactNode }
interface ErrorBoundaryState { error: Error | null }

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <main className="app">
          <div className="error-boundary">
            <h2>Something went wrong</h2>
            <p className="val-error">{this.state.error.message}</p>
            <button type="button" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
