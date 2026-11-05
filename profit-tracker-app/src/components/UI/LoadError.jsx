import { AlertTriangle, RotateCcw } from 'lucide-react';

// Shown instead of a page when its data never loaded, so a failed request can't
// pass for an empty account or a $0.00 total.
const LoadError = ({ title, what, onRetry, retrying = false }) => (
  <div className="h-full overflow-auto px-4 py-6 sm:px-6">
    <h1 className="text-2xl font-bold text-white">{title}</h1>
    <div role="alert" className="mx-auto mt-16 max-w-md text-center">
      <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-400" aria-hidden="true" />
      <p className="font-semibold text-white">Couldn't load {what}</p>
      <p className="mt-1 text-sm text-gray-300">
        The server didn't respond, so nothing is shown here. Your records weren't changed.
      </p>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="page-btn page-btn-secondary mx-auto mt-4"
      >
        <RotateCcw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} aria-hidden="true" />
        {retrying ? 'Trying again…' : 'Try again'}
      </button>
    </div>
  </div>
);

export default LoadError;
