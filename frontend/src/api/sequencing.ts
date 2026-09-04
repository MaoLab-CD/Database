import { apiClient } from "./client";

export type SequencingRecordItem = {
  id: number;
  sample_id: string;
  sample_code: string | null;
  center_code: string | null;
  center_name: string | null;
  project_code: string;
  raw_data_path: string;
  r1_file_name: string | null;
  r2_file_name: string | null;
  md5_file_name: string | null;
  total_size_bytes: number | null;
  data_status: string;
  scan_batch_id: number | null;
  last_scanned_at: string;
  file_modified_at: string | null;
  sample_exists: boolean;
  genome_data_status: string | null;
  data_type: string | null;
  sequencing_company: string | null;
  sequencing_platform: string | null;
  sequencing_instrument: string | null;
  sequencing_returned_at: string | null;
  sequencing_depth: string | null;
  genome_qc: string | null;
  final_status: string | null;
  missing_reason: string | null;
};

export type SequencingRecordListResponse = {
  items: SequencingRecordItem[];
  total: number;
  total_size_bytes: number;
  page: number;
  page_size: number;
};

export type SequencingRecordDetail = {
  record: Record<string, unknown>;
  scan_batch: Record<string, unknown> | null;
};

export type ScanBatchItem = {
  id: number;
  scan_root_path: string;
  scan_mode: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  total_projects: number;
  total_sample_dirs: number;
  new_count: number;
  existing_count: number;
  changed_count: number;
  missing_count: number;
  unmatched_count: number;
  incomplete_count: number;
  error_message: string | null;
};

export type LocalScanPayload = {
  root_path: string;
  scan_mode: "incremental" | "full";
  projects?: string[];
};

export type RemoteScanPayload = {
  host: string;
  port: number;
  username: string;
  password?: string;
  backend_path: string;
  root_path: string;
  scan_mode: "incremental" | "full";
  projects?: string[];
  python_command?: string;
};

export type ScanTriggerResult = {
  source: "local" | "remote";
  status: string;
  batch_id: number | null;
  message: string;
  counters: Record<string, number> | null;
  output: string | null;
};

export type RemoteConnectionTestResult = {
  ok: boolean;
  message: string;
  output: string | null;
};

export type SequencingRecordListParams = {
  keyword?: string;
  data_status?: string;
  center_code?: string;
  page?: number;
  page_size?: number;
};

export async function fetchSequencingRecords(params: SequencingRecordListParams) {
  const { data } = await apiClient.get<SequencingRecordListResponse>(
    "/api/sequencing/records",
    { params },
  );
  return data;
}

export async function downloadSequencingRecordsExport(
  params: Omit<SequencingRecordListParams, "page" | "page_size">,
) {
  const { data } = await apiClient.get<Blob>("/api/sequencing/records/export", {
    params,
    responseType: "blob",
  });
  return data;
}

export async function fetchSequencingRecordDetail(recordId: number) {
  const { data } = await apiClient.get<SequencingRecordDetail>(
    `/api/sequencing/records/${recordId}`,
  );
  return data;
}

export async function fetchSequencingScanBatches(limit = 10) {
  const { data } = await apiClient.get<ScanBatchItem[]>("/api/sequencing/scan-batches", {
    params: { limit },
  });
  return data;
}

export async function triggerLocalSequencingScan(payload: LocalScanPayload) {
  const { data } = await apiClient.post<ScanTriggerResult>("/api/sequencing/scan/local", payload);
  return data;
}

export async function triggerRemoteSequencingScan(payload: RemoteScanPayload) {
  const { data } = await apiClient.post<ScanTriggerResult>("/api/sequencing/scan/remote", payload);
  return data;
}

export async function testRemoteSequencingConnection(payload: RemoteScanPayload) {
  const { data } = await apiClient.post<RemoteConnectionTestResult>(
    "/api/sequencing/scan/remote/test",
    payload,
  );
  return data;
}
