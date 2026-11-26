"use client";

import { useQuery } from "@tanstack/react-query";
import type { LibraryItemDTO } from "@/server/services/library";
import { api } from "@/lib/api";

export interface FolderDTO {
  id: string;
  name: string;
  color: string;
  count: number;
}

export function useLibrary() {
  return useQuery({ queryKey: ["library"], queryFn: () => api<{ items: LibraryItemDTO[]; folders: FolderDTO[] }>("/api/library") });
}

export const TAB_COLOR: Record<string, string> = {
  salmon: "bg-tab-salmon",
  sage: "bg-tab-sage",
  sky: "bg-tab-sky",
  buff: "bg-tab-buff",
  lilac: "bg-tab-lilac",
};
