import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type ToastKind = 'ok' | 'err';
interface ToastState { msg: string; kind: ToastKind }

const ToastCtx = createContext<(msg: string, kind?: ToastKind) => void>(() => {});

export function useToast() { return useContext(ToastCtx); }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);

  const show = useCallback((msg: string, kind: ToastKind = 'ok') => {
    setToast({ msg, kind });
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && <div className={`toast ${toast.kind === 'err' ? 'err' : ''}`}>{toast.msg}</div>}
    </ToastCtx.Provider>
  );
}
