import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export default function Modal({ title, onClose, children, footer }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Rendered straight onto <body> instead of inline in the page tree. Fixed-position
  // overlays like this one silently break — get clipped, mispositioned, or end up
  // invisible — if ANY ancestor sets a transform/filter/backdrop-filter/animation/
  // contain/will-change, since that ancestor then becomes the fixed element's
  // containing block instead of the viewport. A portal sidesteps that entirely.
  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-head">
          <h3>{title}</h3>
          <button className="btn btn-ghost btn-sm x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="m-body">{children}</div>
        {footer && <div className="m-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
