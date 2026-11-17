/** T3 Med: the one link the patient pages and the chat header's patient crumb share. */
import { createLink } from "@tanstack/react-router";
import type { ComponentProps } from "react";

import { cn } from "../lib/utils";

const VARIANT_CLASS = {
  /** Text among other text: a name, a breadcrumb. */
  inline: "rounded-sm hover:text-foreground",
  /** A whole list row. */
  row: "rounded-lg hover:bg-accent",
} as const;

function MedAnchor({
  variant = "inline",
  className,
  children,
  ...props
}: ComponentProps<"a"> & { readonly variant?: keyof typeof VARIANT_CLASS }) {
  return (
    <a
      className={cn(
        "outline-hidden ring-ring focus-visible:ring-2 focus-visible:ring-inset",
        VARIANT_CLASS[variant],
        className,
      )}
      {...props}
    >
      {children}
    </a>
  );
}

export const MedLink = createLink(MedAnchor);
