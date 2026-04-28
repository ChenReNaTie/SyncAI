import { type ReactNode } from "react";

interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  label?: string;
  className?: string;
}

const sizeMap = { sm: "h-4 w-4", md: "h-6 w-6", lg: "h-10 w-10" };

export function Spinner({ size = "md", label, className = "" }: SpinnerProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-12 ${className}`}>
      <svg className={`animate-spin ${sizeMap[size]} text-accent`} viewBox="0 0 24 24">
        <circle
          className="opacity-25"
          cx="12" cy="12" r="10"
          stroke="currentColor" strokeWidth="4" fill="none"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      {label && <p className="text-sm text-text-muted">{label}</p>}
    </div>
  );
}

/** Full-page loading state */
export function PageLoading({ label = "Loading..." }: { label?: string }) {
  return (
    <main className="flex items-center justify-center min-h-screen">
      <Spinner size="lg" label={label} />
    </main>
  );
}
