"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Rocket, Library, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const tabs: { name: string; href: string; icon: LucideIcon }[] = [
  { name: "Nebula", href: "/nebula", icon: Rocket },
  { name: "Library", href: "/library", icon: Library },
  { name: "Profile", href: "/profile", icon: User },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 backdrop-blur-md bg-surface-solid/80 border-t border-border/50 pb-[env(safe-area-inset-bottom)]">
      <div className="flex justify-around items-center h-14">
        {tabs.map((tab) => {
          const isActive = pathname.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-col items-center gap-0.5 transition-colors ${
                isActive ? "text-foreground" : "text-nav-inactive hover:text-muted"
              }`}
            >
              <Icon size={18} />
              <span className="text-[10px]">{tab.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
