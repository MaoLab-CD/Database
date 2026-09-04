import { apiClient } from "./client";

export type MovementActionType = "checkout" | "return_request" | "return_confirm";

export type MovementRecordItem = {
  id: number;
  sample_pk: number | null;
  sample_id: string | null;
  sample_code: string | null;
  action_type: MovementActionType;
  before_status: string | null;
  after_status: string | null;
  before_location: string | null;
  after_location: string | null;
  operator_id: number | null;
  operator_name: string | null;
  operator_role: string | null;
  related_record_id: number | null;
  note: string | null;
  created_at: string;
  barcode_no: string | null;
  patient_no: string | null;
  ethnicity: string | null;
  department: string | null;
  specimen_type: string | null;
};

export type MovementRecordResponse = {
  items: MovementRecordItem[];
  total: number;
  page: number;
  page_size: number;
};

export type MovementRecordParams = {
  keyword?: string;
  action_type?: MovementActionType;
  page?: number;
  page_size?: number;
};

export async function fetchMovementRecords(params: MovementRecordParams) {
  const { data } = await apiClient.get<MovementRecordResponse>("/api/records/movements", {
    params,
  });
  return data;
}
