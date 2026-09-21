import { Suspense } from "react";
import { SearchApp } from "@/components/app/search-app";
import { TopBar } from "@/components/app/top-bar";
import { Skeleton } from "@/components/ui/skeleton";

export default function HomePage() {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar />
      <Suspense fallback={<BootSkeleton />}>
        <SearchApp />
      </Suspense>
    </div>
  );
}

function BootSkeleton() {
  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-[302px] shrink-0 space-y-4 border-r border-border p-5">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
      <div className="flex-1 space-y-3 p-5">
        {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    </div>
  );
}
