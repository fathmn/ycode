'use client';

import { useEffect } from 'react';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error('Published page error:', error);
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-white px-4 text-neutral-950">
      <section className="max-w-md text-center">
        <p className="mb-3 text-sm font-medium uppercase tracking-[0.18em] text-neutral-500">
          Fehler 500
        </p>
        <h1 className="mb-4 text-3xl font-semibold tracking-normal">
          Die Seite konnte gerade nicht geladen werden.
        </h1>
        <p className="mb-8 text-base leading-7 text-neutral-600">
          Bitte versuchen Sie es erneut. Falls der Fehler bestehen bleibt, pruefen wir die Website im Studio.
        </p>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center justify-center rounded-md bg-neutral-950 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-neutral-800"
        >
          Erneut versuchen
        </button>
      </section>
    </main>
  );
}
