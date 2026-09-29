import type { ComponentProps } from "react";
// Group semantics and joined outline styling follow shadcn/ui's Button Group pattern.
// Native buttons/anchors preserve their existing focus, disabled, and link behavior.
export function ButtonGroup({ className = "", ...props }: ComponentProps<"div">) {
  return <div role="group" data-slot="button-group" className={`button-group ${className}`} {...props} />;
}
