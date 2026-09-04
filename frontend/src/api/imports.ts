import { apiClient } from "./client";
import type { AxiosProgressEvent } from "axios";

export type ImportStatus = "previewed" | "imported" | "partial" | "failed" | "cancelled";
export type ImportMode = "atomic" | "best_effort";

export type ImportBatchItem = {
  id: number;
  file_name: string;
  file_path: string | null;
  uploaded_by: number | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
  total_rows: number;
  success_rows: number;
  failed_rows: number;
  import_type: string;
  status: ImportStatus;
  created_count: number;
  updated_count: number;
  removed_count: number;
  pending_storage_count: number;
  created_at: string;
  updated_at: string;
};

export type ImportBatchListResponse = {
  items: ImportBatchItem[];
  total: number;
  page: number;
  page_size: number;
};

export type ImportBatchDetail = {
  batch: ImportBatchItem;
  error_report: ImportErrorItem[];
  field_mapping: Record<string, unknown>;
};

export type ImportErrorItem = {
  row_number: number | null;
  sample_id: string | null;
  reason: string;
};

export type ImportUploadResult = {
  import_batch_id: number;
  total_rows: number;
  success_rows: number;
  failed_rows: number;
  errors: ImportErrorItem[];
  scan_triggered?: boolean;
  scan_message?: string | null;
  return_message?: string | null;
};

export type ExcelSheetInspectResult = {
  sheet_names: string[];
  suggested_sheet_name: string | null;
  has_sample_code_column: boolean;
  sample_code_columns: string[];
  detected_center_code?: string | null;
  detected_center_name?: string | null;
  detected_specimen_type?: string | null;
  detected_specimen_type_label?: string | null;
  specimen_type_counts?: Record<string, number>;
};

export type DnaPlatePreviewRow = {
  row_number: number;
  sample_id: string;
  sample_code: string;
  barcode_no: string | null;
  experiment_no: string | null;
  source_batch: string | null;
  aliquot_no: string | null;
  plate_code: string;
  well_code: string;
  action: "new" | "existing" | "error";
  message: string | null;
};

export type DnaPlatePreviewResult = {
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  new_rows: number;
  existing_rows: number;
  plate_count: number;
  can_import: boolean;
  rows: DnaPlatePreviewRow[];
  errors: ImportErrorItem[];
};

export type ImportBatchListParams = {
  keyword?: string;
  import_status?: ImportStatus;
  page?: number;
  page_size?: number;
};

export async function uploadExcelImport(
  file: File,
  sheetName: string,
  defaultStatus: string,
  duplicateStrategy: "error" | "overwrite" = "error",
  importMode: ImportMode = "atomic",
  storage?: {
    freezer_no?: string;
    shelf_no?: string;
    box_no?: string;
    storage_position?: string;
  },
  onUploadProgress?: (event: AxiosProgressEvent) => void,
) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("sheet_name", sheetName);
  formData.append("default_status", defaultStatus);
  formData.append("duplicate_strategy", duplicateStrategy);
  formData.append("import_mode", importMode);
  if (storage?.freezer_no) formData.append("freezer_no", storage.freezer_no);
  if (storage?.shelf_no) formData.append("shelf_no", storage.shelf_no);
  if (storage?.box_no) formData.append("box_no", storage.box_no);
  if (storage?.storage_position) formData.append("storage_position", storage.storage_position);
  const { data } = await apiClient.post<ImportUploadResult>("/api/imports/upload", formData, {
    onUploadProgress,
  });
  return data;
}

export async function uploadGenomeInfoImport(
  file: File,
  sheetName: string,
  options?: {
    sequencing_company?: string;
    sequencing_platform?: string;
    sequencing_instrument?: string;
    sequencing_returned_at?: string;
    sync_return?: boolean;
    duplicate_strategy?: "error" | "overwrite";
    import_mode?: ImportMode;
  },
  onUploadProgress?: (event: AxiosProgressEvent) => void,
) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("sheet_name", sheetName);
  if (options?.sequencing_company) formData.append("sequencing_company", options.sequencing_company);
  if (options?.sequencing_platform) formData.append("sequencing_platform", options.sequencing_platform);
  if (options?.sequencing_instrument) formData.append("sequencing_instrument", options.sequencing_instrument);
  if (options?.sequencing_returned_at) formData.append("sequencing_returned_at", options.sequencing_returned_at);
  formData.append("sync_return", String(options?.sync_return ?? true));
  formData.append("duplicate_strategy", options?.duplicate_strategy ?? "error");
  formData.append("import_mode", options?.import_mode ?? "atomic");
  const { data } = await apiClient.post<ImportUploadResult>("/api/imports/genome/upload", formData, {
    onUploadProgress,
  });
  return data;
}

export async function previewDnaPlateImport(file: File, sheetName: string) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("sheet_name", sheetName);
  const { data } = await apiClient.post<DnaPlatePreviewResult>(
    "/api/imports/dna-plates/preview",
    formData,
  );
  return data;
}

export async function uploadDnaPlateImport(
  file: File,
  sheetName: string,
  options?: {
    default_status?: "not_stored" | "in_storage";
    freezer_code?: string;
    layer_no?: string;
    container_no?: string;
  },
) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("sheet_name", sheetName);
  formData.append("default_status", options?.default_status ?? "in_storage");
  if (options?.freezer_code) formData.append("freezer_code", options.freezer_code);
  if (options?.layer_no) formData.append("layer_no", options.layer_no);
  if (options?.container_no) formData.append("container_no", options.container_no);
  const { data } = await apiClient.post<ImportUploadResult>(
    "/api/imports/dna-plates/import",
    formData,
  );
  return data;
}

export async function inspectExcelSheets(file: File, sheetName?: string) {
  const formData = new FormData();
  formData.append("file", file);
  if (sheetName) formData.append("sheet_name", sheetName);
  const { data } = await apiClient.post<ExcelSheetInspectResult>(
    "/api/imports/inspect-sheets",
    formData,
  );
  return data;
}

export async function fetchImportBatches(params: ImportBatchListParams) {
  const { data } = await apiClient.get<ImportBatchListResponse>("/api/imports/batches", {
    params,
  });
  return data;
}

export async function fetchImportBatchDetail(batchId: number) {
  const { data } = await apiClient.get<ImportBatchDetail>(`/api/imports/batches/${batchId}`);
  return data;
}

export async function downloadImportBatchErrors(batchId: number) {
  const { data } = await apiClient.get<Blob>(`/api/imports/batches/${batchId}/errors.csv`, {
    responseType: "blob",
  });
  return data;
}

export async function removeCreatedSamplesFromBatch(batchId: number, reason: string) {
  const { data } = await apiClient.post<{
    batch_id: number;
    removed_count: number;
    updated_count: number;
  }>(`/api/imports/batches/${batchId}/remove-created-samples`, { reason });
  return data;
}

export async function confirmImportBatchStorage(batchId: number) {
  const { data } = await apiClient.post<{
    batch_id: number;
    stored_count: number;
  }>(`/api/imports/batches/${batchId}/confirm-storage`);
  return data;
}
