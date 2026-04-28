import { type ReactNode } from "react";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article" | "header" | "footer" | "form";
  hover?: boolean;
  glow?: boolean;
  onClick?: () => void;
}

export function GlassCard({
  children,
  className = "",
  as: Tag = "div",
  hover = false,
  glow = false,
  onClick,
}: GlassCardProps) {
  const base = [
    "bg-glass backdrop-blur-xl border border-glass-border rounded-card",
    "shadow-card transition-all duration-300",
    "p-6",
  ];
  if (hover) base.push("hover:bg-glass-hover hover:border-glass-border-hover hover:shadow-card-hover cursor-pointer");
  if (glow) base.push("shadow-glow");

  return (
    <Tag className={`${base.join(" ")} ${className}`} onClick={onClick}>
      {children}
    </Tag>
  );
}
