import React from 'react';
import { captureException } from '../monitoring';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled React error:', error, info);
    captureException(error, { react: info });
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[var(--bg-main,#0b1020)] text-[var(--text-primary,#f8fafc)] flex items-center justify-center px-6">
          <div className="w-full max-w-md rounded-lg border border-white/10 bg-white/[0.04] p-6 shadow-2xl">
            <h1 className="text-xl font-semibold">Something went wrong</h1>
            <p className="mt-2 text-sm text-[var(--text-secondary,#94a3b8)]">
              The app hit an unexpected error. Reload to start a fresh session.
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              className="mt-5 rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              Reload app
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
