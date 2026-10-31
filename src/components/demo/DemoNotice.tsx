// À la place d'un écran qui sort de la démo (IA, Apple Santé) : ce qu'il fait, et comment l'avoir chez soi.
import type { ReactNode } from "react";
import { buttonClass, EmptyState } from "@/components/ui";
import { INSTALL_URL } from "@/lib/demo/core";

export function DemoNotice({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <EmptyState
      scene="pot"
      title={title}
      action={
        <a href={INSTALL_URL} className={buttonClass({ variant: "secondary", size: "sm", className: "mt-2" })} target="_blank" rel="noopener">
          Installer Mijote
        </a>
      }
    >
      {children}
    </EmptyState>
  );
}
