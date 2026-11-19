import { BottomNav } from "@/components/BottomNav";

export default function TabsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative h-full min-h-screen bg-[#05070A]">
      <div className="absolute inset-0 bottom-14 z-10">
        {children}
      </div>
      <BottomNav />
    </div>
  );
}
