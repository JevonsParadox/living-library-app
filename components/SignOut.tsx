"use client";

import { useClerk } from "@clerk/nextjs";

export function SignOut() {
  const { signOut } = useClerk();

  return (
    <button
      onClick={() => signOut({ redirectUrl: "/sign-in" })}
      className="px-2.5 py-1 text-[10px] rounded-full bg-surface-solid/40 text-muted border border-border/30 hover:text-foreground transition-colors"
    >
      Sign out
    </button>
  );
}
