import { Suspense } from "react";
import { TopBar } from "@/components/app/top-bar";
import { SignalsBoard } from "@/components/app/signals-board";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata = { title: "Call list · Permit Stack" };

export default function SignalsPage() {
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
