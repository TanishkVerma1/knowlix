"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { Policy } from "@/shared/policy";

export interface SessionInfo {
  workspace: { id: string; short: string; createdAt: string | null; hasKey: boolean };
  policy: Policy;
  ai: {
    mode: "ai" | "extractive";
    active: { id: string; label: string; model: string; local?: boolean } | null;
    providers: { id: string; label: string; model: string; configured: boolean }[];
  };
  db: "postgres" | "pglite";
  counts: { library: number; audits: number; runs: number };
}

export function useSession() {
  return useQuery({ queryKey: ["session"], queryFn: () => api<SessionInfo>("/api/session"), staleTime: 30_000 });
}
