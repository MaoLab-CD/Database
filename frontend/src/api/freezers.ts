import { apiClient } from "./client";

export type FreezerItem = {
  id: number;
  freezer_code: string;
  temperature_c: number;
  display_name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type FreezerPayload = {
  freezer_code: string;
  temperature_c: number;
  is_active: boolean;
};

export async function fetchFreezers(activeOnly = true) {
  const { data } = await apiClient.get<FreezerItem[]>("/api/freezers", {
    params: { active_only: activeOnly },
  });
  return data;
}

export async function createFreezer(payload: FreezerPayload) {
  const { data } = await apiClient.post<FreezerItem>("/api/freezers", payload);
  return data;
}

export async function updateFreezer(freezerId: number, payload: FreezerPayload) {
  const { data } = await apiClient.put<FreezerItem>(
    `/api/freezers/${freezerId}`,
    payload,
  );
  return data;
}
