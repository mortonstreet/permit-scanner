import { Suspense } from "react";
import { TopBar } from "@/components/app/top-bar";
import { SignalsBoard } from "@/components/app/signals-board";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The call list is the home page.
 *
 * A GC opening this should see the jobs worth calling about today, not an
 * empty search form. Permit search lives at /search for when they need to dig.
 */
export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <Suspense fallback={
        <main className="mx-auto w-full max-w-5xl space-y-3 px-6 py-7">
          <Skeleton className="h-10 w-72" />
          {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
        </main>
      }>
        <SignalsBoard />
      </Suspense>
    </div>
  );
}
