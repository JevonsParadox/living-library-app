import { BottomNav } from "@/components/BottomNav";
import { NebulaProvider } from "@/lib/nebula/nebula-context";
import { fetchNebulaData } from "@/lib/nebula/fetch-nebula-data";

export default async function NebulaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { books, regions, seriesNames, userLibrary } = await fetchNebulaData();

  return (
    <NebulaProvider initialBooks={books} initialRegions={regions} initialLibrary={userLibrary} initialSeriesNames={seriesNames}>
      <div className="relative h-full min-h-screen bg-[#05070A]">
        <div className="absolute inset-0 bottom-14 z-10">
          {children}
        </div>
        <BottomNav />
      </div>
    </NebulaProvider>
  );
}
