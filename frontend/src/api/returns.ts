import { apiClient } from "./client";

export type PendingReturnItem = {
  id: number;
  sample_pk: number;
  sample_id: string;
  sample_code: string | null;
  checkout_record_id: number;
  returned_by: number;
  returned_by_name: string | null;
  return_requested_at: string;
  purpose: string | null;
  used_amount: string | null;
  unit: string | null;
  used_volume_ul: number | null;
  return_location: string | null;
  note: string | null;
  sample_status: string;
  barcode_no: string | null;
  patient_no: string | null;
  ethnicity: string | null;
  specimen_type: string | null;
  department: string | null;
  checkout_time: string | null;
  checkout_user_name: string | null;
};

export type FinalReturnStatus = "in_storage" | "consumed" | "lost" | "discarded";

export type ConfirmReturnResult = {
  return_record_id: number;
  sample_id: string;
  final_status: string;
  message: string;
};

export type BatchConfirmReturnResult = {
  confirmed_count: number;
  final_status: string;
  items: ConfirmReturnResult[];
  message: string;
};

export async function fetchPendingReturns() {
  const { data } = await apiClient.get<PendingReturnItem[]>("/api/returns/pending");
  return data;
}

export async function confirmReturn(returnRecordId: number, finalStatus: FinalReturnStatus) {
  const { data } = await apiClient.post<ConfirmReturnResult>(
    `/api/returns/${returnRecordId}/confirm`,
    { final_status: finalStatus },
  );
  return data;
}

export async function confirmReturnsBatch(
  returnRecordIds: number[],
  finalStatus: FinalReturnStatus,
) {
  const { data } = await apiClient.post<BatchConfirmReturnResult>(
    "/api/returns/batch/confirm",
    {
      return_record_ids: returnRecordIds,
      final_status: finalStatus,
    },
  );
  return data;
}
