import { apiClient } from "./client";

export type HospitalUploadStatus =
  | "validation_failed"
  | "validated"
  | "submitted"
  | "approved"
  | "rejected"
  | "imported"
  | "import_failed"
  | "cancelled";

export type HospitalUploadError = {
  row_number: number | null;
  sample_id: string | null;
  sample_code: string | null;
  reason: string;
  error_type: string;
};

export type HospitalUploadItem = {
  id: number;
  file_name: string;
  file_hash: string;
  file_size: number;
  template_version: string;
  sheet_name: string;
  center_code: string;
  center_name?: string | null;
  uploaded_by: number;
  uploaded_by_name?: string | null;
  status: HospitalUploadStatus;
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  new_rows: number;
  duplicate_rows: number;
  validation_summary: Record<string, unknown>;
  submitted_at?: string | null;
  reviewed_by?: number | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
  review_comment?: string | null;
  default_status?: string | null;
  import_batch_id?: number | null;
  imported_by?: number | null;
  imported_by_name?: string | null;
  imported_at?: string | null;
  import_error?: string | null;
  cancelled_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type HospitalUploadEvent = {
  event_type: string;
  detail: Record<string, unknown>;
  client_ip?: string | null;
  created_at: string;
  actor_name?: string | null;
};

export type HospitalUploadDetail = {
  batch: HospitalUploadItem;
  errors: HospitalUploadError[];
  events: HospitalUploadEvent[];
};

export type HospitalCodePreviewRow = {
  row_number: number;
  sample_id: string;
  collection_date: string;
  specimen_type: string;
  sample_code: string;
};

export type HospitalCodePreview = {
  total_rows: number;
  date_counts: Record<string, number>;
  rows: HospitalCodePreviewRow[];
};

export type HospitalReviewPreviewRow = {
  row_number: number;
  values: Array<string | number | boolean | null>;
};

export type HospitalReviewPreview = {
  total_rows: number;
  displayed_rows: number;
  headers: string[];
  sensitive_columns: number[];
  date_counts: Record<string, number>;
  specimen_type_counts: Record<string, number>;
  rows: HospitalReviewPreviewRow[];
};

export type HospitalSubmissionPreview = {
  total_rows: number;
  displayed_rows: number;
  headers: string[];
  sensitive_columns: number[];
  rows: HospitalReviewPreviewRow[];
};

export type HospitalUploadListResponse = {
  items: HospitalUploadItem[];
  total: number;
  page: number;
  page_size: number;
};

export async function downloadHospitalTemplate() {
  const { data } = await apiClient.get<Blob>("/api/hospital-uploads/template", {
    responseType: "blob",
  });
  return data;
}

export async function uploadHospitalFile(file: File, sheetName = "样本数据") {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("sheet_name", sheetName);
  const { data } = await apiClient.post<HospitalUploadDetail>(
    "/api/hospital-uploads/upload",
    formData,
  );
  return data;
}

export async function fetchMyHospitalUploads(params: {
  upload_status?: HospitalUploadStatus;
  page?: number;
  page_size?: number;
} = {}) {
  const { data } = await apiClient.get<HospitalUploadListResponse>(
    "/api/hospital-uploads/mine",
    { params },
  );
  return data;
}

export async function fetchHospitalUploadsForReview(params: {
  upload_status?: HospitalUploadStatus;
  center_code?: string;
  page?: number;
  page_size?: number;
} = {}) {
  const { data } = await apiClient.get<HospitalUploadListResponse>(
    "/api/hospital-uploads/review",
    { params },
  );
  return data;
}

export async function fetchHospitalUploadDetail(batchId: number) {
  const { data } = await apiClient.get<HospitalUploadDetail>(
    `/api/hospital-uploads/${batchId}`,
  );
  return data;
}

export async function fetchHospitalSubmissionPreview(batchId: number) {
  const { data } = await apiClient.get<HospitalSubmissionPreview>(
    `/api/hospital-uploads/${batchId}/submission-preview`,
  );
  return data;
}

export async function submitHospitalUpload(batchId: number) {
  const { data } = await apiClient.post<HospitalUploadDetail>(
    `/api/hospital-uploads/${batchId}/submit`,
  );
  return data;
}

export async function cancelHospitalUpload(batchId: number) {
  const { data } = await apiClient.post<HospitalUploadDetail>(
    `/api/hospital-uploads/${batchId}/cancel`,
  );
  return data;
}

export async function reviewHospitalUpload(
  batchId: number,
  payload: { action: "approve" | "reject"; comment?: string },
) {
  const { data } = await apiClient.post<HospitalUploadDetail>(
    `/api/hospital-uploads/${batchId}/review`,
    payload,
  );
  return data;
}

export async function fetchHospitalCodePreview(batchId: number) {
  const { data } = await apiClient.get<HospitalCodePreview>(
    `/api/hospital-uploads/${batchId}/code-preview`,
  );
  return data;
}

export async function fetchHospitalReviewPreview(batchId: number) {
  const { data } = await apiClient.get<HospitalReviewPreview>(
    `/api/hospital-uploads/${batchId}/review-preview`,
  );
  return data;
}

export async function downloadHospitalReviewPreview(batchId: number) {
  const { data } = await apiClient.get<Blob>(
    `/api/hospital-uploads/${batchId}/review-preview.xlsx`,
    { responseType: "blob" },
  );
  return data;
}

export async function downloadHospitalCodePreview(batchId: number) {
  const { data } = await apiClient.get<Blob>(
    `/api/hospital-uploads/${batchId}/code-preview.csv`,
    { responseType: "blob" },
  );
  return data;
}

export async function importApprovedHospitalUpload(batchId: number, defaultStatus: string) {
  const { data } = await apiClient.post<HospitalUploadDetail>(
    `/api/hospital-uploads/${batchId}/import`,
    { default_status: defaultStatus },
  );
  return data;
}

export async function downloadHospitalUploadErrors(batchId: number) {
  const { data } = await apiClient.get<Blob>(
    `/api/hospital-uploads/${batchId}/errors.csv`,
    { responseType: "blob" },
  );
  return data;
}
