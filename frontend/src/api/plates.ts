import { apiClient } from "./client";

export type PlateListItem = {
  id: number;
  plate_code: string;
  plate_type: string;
  row_count: number;
  column_count: number;
  freezer_code: string | null;
  temperature_c: number | null;
  layer_no: string | null;
  container_no: string | null;
  location_note: string | null;
  is_active: boolean;
  occupied_count: number;
  in_storage_count: number;
  checked_out_count: number;
  return_pending_count: number;
  unavailable_count: number;
  updated_at: string;
};

export type PlateWellItem = {
  well_code: string;
  sample_pk: number;
  sample_id: string;
  sample_code: string | null;
  specimen_type: string | null;
  sample_status: string;
  source_sample_pk: number | null;
  source_sample_id: string | null;
  source_sample_code: string | null;
  placed_at: string;
};

export type PlateListResponse = {
  items: PlateListItem[];
  total: number;
  page: number;
  page_size: number;
};

export type PlateDetailResponse = {
  plate: PlateListItem;
  wells: PlateWellItem[];
};

export type PlateCheckoutResponse = {
  plate_code: string;
  checkout_count: number;
  items: Array<{
    well_code: string;
    sample_id: string;
    sample_code: string | null;
    checkout_record_id: number;
  }>;
  message: string;
};

export async function fetchPlates(params: {
  keyword?: string;
  page?: number;
  page_size?: number;
}) {
  const { data } = await apiClient.get<PlateListResponse>("/api/plates", { params });
  return data;
}

export async function fetchPlateDetail(plateCode: string) {
  const { data } = await apiClient.get<PlateDetailResponse>(
    `/api/plates/${encodeURIComponent(plateCode)}`,
  );
  return data;
}

export async function downloadPlateExport(plateCode: string) {
  const { data } = await apiClient.get<Blob>(
    `/api/plates/${encodeURIComponent(plateCode)}/export`,
    { responseType: "blob" },
  );
  return data;
}

export async function checkoutPlateWells(plateCode: string, wellCodes: string[]) {
  const { data } = await apiClient.post<PlateCheckoutResponse>(
    `/api/plates/${encodeURIComponent(plateCode)}/checkout`,
    { well_codes: wellCodes },
  );
  return data;
}
