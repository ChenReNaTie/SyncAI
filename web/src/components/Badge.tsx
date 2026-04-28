import { type ReactNode } from "react";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "accent";

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-surface-3 text-text-secondary border-glass-border",
  success: "bg-success-muted text-success border-success/30",
  warning: "bg-warning-muted text-warning border-warning/30",
  danger: "bg-danger-muted text-danger border-danger/30",
  accent: "bg-accent-muted text-accent-light border-accent/30",
};

export function Badge({ children, variant = "default", className = "" }: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center px-2 py-0.5 text-[11px] font-semibold
        uppercase tracking-wider rounded-badge border
        ${variantClasses[variant]} ${className}
      `}
    >
      {children}
    </span>
  );
}
