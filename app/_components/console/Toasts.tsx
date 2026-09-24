'use client';

import { CheckCircle2, Info, X } from 'lucide-react';

export interface Toast {
  id: number;
  tone: 'success' | 'info';
  title: string;
  body: string;
  action?: { label: string; run: () => void };
}

/**
 * Confirmation after an apply or an undo. Dismissal is driven by the end of
 * the progress bar's CSS animation rather than a timer, so hovering a toast
 * pauses it for free and nothing keeps running once it is gone.
 */
export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => {
        const Icon = t.tone === 'success' ? CheckCircle2 : Info;
        return (
          <div key={t.id} className={`toast ${t.tone}`}>
            <span className="toast-icon"><Icon size={18} aria-hidden="true" /></span>
            <div className="toast-text">
              <div className="toast-title">{t.title}</div>
              <div className="toast-body">{t.body}</div>
            </div>
            {t.action && (
              <button
                type="button"
                className="btn sm secondary"
                onClick={() => { t.action!.run(); onDismiss(t.id); }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" className="toast-close" onClick={() => onDismiss(t.id)} aria-label="Dismiss notification">
              <X size={14} aria-hidden="true" />
            </button>
            <span className="toast-progress" onAnimationEnd={() => onDismiss(t.id)} aria-hidden="true" />
          </div>
        );
      })}
    </div>
  );
}
