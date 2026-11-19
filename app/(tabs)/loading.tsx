export default function TabsLoading() {
  return (
    <div className="p-6 pt-16 animate-pulse pointer-events-none">
      <div data-overlay className="pointer-events-auto backdrop-blur-md bg-surface-solid/30 rounded-xl border border-border/30 p-4 max-w-sm">
        <div className="h-4 w-32 bg-border/30 rounded" />
        <div className="h-3 w-48 bg-border/20 rounded mt-2" />
      </div>
    </div>
  );
}
