import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  /** Omitted on the last crumb — you are already there. */
  href?: string;
}

/**
 * The trail back out, identical on every page that has one.
 *
 * It was three different trails before this: `text-sm` on the candidates list
 * and the edit form, `text-[13px]` with a paler separator on a campaign. They
 * are adjacent pages — you pass through all three in two clicks — and chrome
 * that changes size between adjacent pages reads as two different products
 * rather than as one place you are moving around inside.
 *
 * The last crumb is deliberately not a link. It names where you are, and a
 * link to the page you are on is a control that does nothing.
 */
export function Breadcrumb({
  items,
  actions,
  className,
}: {
  items: Crumb[];
  /** Page-level buttons that share the row — Clone, Edit. */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-baseline gap-2 text-sm text-[#6B7280]",
        className,
      )}
    >
      {items.map((crumb, i) => (
        <span key={`${crumb.label}-${i}`} className="flex items-baseline gap-2">
          {i > 0 && <span aria-hidden="true">/</span>}
          {crumb.href ? (
            <Link href={crumb.href} className="transition-colors hover:text-[#111827]">
              {crumb.label}
            </Link>
          ) : (
            <span className="text-[#111827]">{crumb.label}</span>
          )}
        </span>
      ))}

      {actions && <span className="ml-auto flex items-center gap-2.5">{actions}</span>}
    </div>
  );
}
