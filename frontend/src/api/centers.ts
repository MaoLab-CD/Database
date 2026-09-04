import { apiClient } from "./client";

export type DistrictItem = {
  district_code: string;
  district_name: string;
  city_name?: string | null;
  province?: string | null;
  is_active: boolean;
};

export type CenterItem = {
  id: number;
  center_code: string;
  center_name: string;
  province?: string | null;
  district_code: string;
  district_name?: string | null;
  city_name?: string | null;
  region?: string | null;
  hospital_seq: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CenterListParams = {
  keyword?: string;
  active_status?: "active" | "inactive";
  district_code?: string;
  page?: number;
  page_size?: number;
};

export type CenterListResponse = {
  items: CenterItem[];
  total: number;
  page: number;
  page_size: number;
};

export type HospitalSeqOptions = {
  district_code: string;
  used: string[];
  next_seq?: string | null;
};

export type SampleSerialSuggestion = {
  center_code: string;
  code_date: string;
  used_count: number;
  max_serial: number;
  next_serial?: number | null;
};

export type CreateCenterPayload = {
  district_code: string;
  hospital_seq: string;
  center_name: string;
  province?: string | null;
  region?: string | null;
  is_active: boolean;
};

export type UpdateCenterPayload = {
  center_name: string;
  province?: string | null;
  region?: string | null;
  is_active: boolean;
};

export type CreateDistrictPayload = {
  district_code: string;
  district_name: string;
  city_name?: string | null;
  province?: string | null;
  is_active: boolean;
};

export type UpdateDistrictPayload = {
  district_name: string;
  city_name?: string | null;
  province?: string | null;
  is_active: boolean;
};

export async function fetchDistricts() {
  const { data } = await apiClient.get<DistrictItem[]>("/api/centers/districts");
  return data;
}

export async function createDistrict(payload: CreateDistrictPayload) {
  const { data } = await apiClient.post<DistrictItem>("/api/centers/districts", payload);
  return data;
}

export async function updateDistrict(districtCode: string, payload: UpdateDistrictPayload) {
  const { data } = await apiClient.put<DistrictItem>(`/api/centers/districts/${districtCode}`, payload);
  return data;
}

export async function fetchHospitalSeqOptions(districtCode: string) {
  const { data } = await apiClient.get<HospitalSeqOptions>(
    `/api/centers/districts/${districtCode}/hospital-seqs`,
  );
  return data;
}

export async function fetchSampleSerialSuggestion(centerCode: string, codeDate: string) {
  const { data } = await apiClient.get<SampleSerialSuggestion>(
    `/api/centers/${centerCode}/sample-serial-suggestion`,
    {
      params: { code_date: codeDate },
    },
  );
  return data;
}

export async function fetchCenters(params: CenterListParams = {}) {
  const { data } = await apiClient.get<CenterListResponse>("/api/centers", { params });
  return data;
}

export async function createCenter(payload: CreateCenterPayload) {
  const { data } = await apiClient.post<CenterItem>("/api/centers", payload);
  return data;
}

export async function updateCenter(centerId: number, payload: UpdateCenterPayload) {
  const { data } = await apiClient.put<CenterItem>(`/api/centers/${centerId}`, payload);
  return data;
}
