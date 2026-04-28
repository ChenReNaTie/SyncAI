import { type ReactNode } from "react";

interface PageShellProps {
  children: ReactNode;
  className?: string;
  /** Title shown in page header */
  title?: string;
  /** Optional back navigation link */
  backTo?: { label: string; href: string };
  /** Optional right-side actions in header */
  actions?: ReactNode;
  /** Full-height mode for pages like SessionPage */
  fullHeight?: boolean;
}

export function PageShell({
  children,
  className = "",
  title,
  backTo,
  actions,
  fullHeight = false,
}: PageShellProps) {
  return (
    <main
      className={`mx-auto w-full max-w-[1100px] px-4 sm:px-6 pb-16 ${
        fullHeight ? "flex flex-col h-screen overflow-hidden" : "pt-8 sm:pt-12"
      } ${className}`}
    >
      {(title || backTo || actions) && (
        <header
          className={`flex items-center justify-between flex-wrap gap-3 mb-6 ${
            fullHeight ? "shrink-0" : ""
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            {backTo && (
              <a
                href={backTo.href}
                className="text-text-muted hover:text-text-secondary transition-colors text-sm flex items-center gap-1 shrink-0"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M10.854 3.146a.5.5 0 0 1 0 .708L7.207 7.5l3.647 3.646a.5.5 0 0 1-.708.708l-4-4a.5.5 0 0 1 0-.708l4-4a.5.5 0 0 1 .708 0Z" />
                </svg>
                {backTo.label}
              </a>
            )}
            {title && (
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary truncate">
                {title}
              </h1>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </main>
  );
}
