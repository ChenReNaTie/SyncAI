import { type ReactNode } from "react";
import { Button } from "./Button.js";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Content */}
      <div className="relative w-full max-w-md bg-surface-2 border border-glass-border rounded-modal shadow-card-hover animate-slide-up overflow-hidden">
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-glass-border">
            <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708Z" />
              </svg>
            </Button>
          </div>
        )}
        <div className="px-6 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-glass-border">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
