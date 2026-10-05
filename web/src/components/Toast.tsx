import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export interface ToastOptions {
  message: string;
  action?: { label: string; onAction: () => void };
  /** Milliseconds; Infinity keeps the toast until it is acted on or replaced. */
  duration?: number;
}

type ShowToast = (options: ToastOptions) => void;

const ToastContext = createContext<ShowToast>(() => {});

export function useToast(): ShowToast {
  return useContext(ToastContext);
}

/** Shows one toast at a time at the bottom of the screen; a new toast replaces the current one. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(ToastOptions & { id: number }) | null>(null);
  const nextId = useRef(0);

  const show = useCallback<ShowToast>((options) => setToast({ ...options, id: nextId.current++ }), []);

  useEffect(() => {
    if (!toast || toast.duration === Infinity) return;
    const duration = toast.duration ?? (toast.action ? 6000 : 3500);
    const timer = setTimeout(() => setToast((current) => (current?.id === toast.id ? null : current)), duration);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <div className="toast" key={toast.id}>
            <span className="toast-message">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  toast.action?.onAction();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
