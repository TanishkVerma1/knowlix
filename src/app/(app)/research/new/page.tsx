import { Suspense } from "react";
import { NewRun } from "@/features/research/new-run";

export default function NewRunPage() {
  return (
    <Suspense fallback={null}>
      <NewRun />
    </Suspense>
  );
}
