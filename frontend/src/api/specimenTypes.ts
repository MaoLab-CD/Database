import { apiClient } from "./client";

export type SpecimenTypeItem = {
  id: number;
  name: string;
  is_active: boolean;
  allow_batch_code: boolean;
  uses_plate_wells: boolean;
  code_suffix: string | null;
  code_rule_confirmed: boolean;
  code_rule_locked: boolean;
  sample_count: number;
  sort_order: number;
  note?: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateSpecimenTypePayload = {
  name: string;
  is_active: boolean;
  allow_batch_code: boolean;
  uses_plate_wells: boolean;
  code_suffix?: string | null;
  code_rule_confirmed: boolean;
  sort_order: number;
  note?: string | null;
};

export type UpdateSpecimenTypePayload = Omit<CreateSpecimenTypePayload, "name">;

export async function fetchSpecimenTypes(
  activeOnly = true,
  batchCodeOnly = false,
) {
  const { data } = await apiClient.get<SpecimenTypeItem[]>("/api/specimen-types", {
    params: { active_only: activeOnly, batch_code_only: batchCodeOnly },
  });
  return data;
}

export async function createSpecimenType(payload: CreateSpecimenTypePayload) {
  const { data } = await apiClient.post<SpecimenTypeItem>("/api/specimen-types", payload);
  return data;
}

export async function updateSpecimenType(
  specimenTypeId: number,
  payload: UpdateSpecimenTypePayload,
) {
  const { data } = await apiClient.put<SpecimenTypeItem>(
    `/api/specimen-types/${specimenTypeId}`,
    payload,
  );
  return data;
}
