import { Suspense } from "react";
import { TopBar } from "@/components/app/top-bar";
import { PermitProfile } from "@/components/app/permit-profile";
import { Skeleton } from "@/components/ui/skeleton";

export default async function PermitProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <Suspense fallback={
        <main className="mx-auto w-full max-w-5xl space-y-4 px-6 py-10">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-40 w-full" />
        </main>
      }>
        <PermitProfile permitId={id} />
      </Suspense>
    </div>
  );
}
