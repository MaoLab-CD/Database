import { apiClient } from "./client";

export type CountItem = {
  name: string;
  count: number;
};

export type LatestImportBatch = {
  file_name: string | null;
  total_rows: number;
  success_rows: number;
  failed_rows: number;
  uploaded_at: string | null;
  status: string | null;
};

export type LatestScanBatch = {
  scan_root_path: string | null;
  total_projects: number;
  total_sample_dirs: number;
  new_count: number;
  unmatched_count: number;
  incomplete_count: number;
  finished_at: string | null;
  status: string | null;
};

export type DashboardSummary = {
  total_samples: number;
  in_storage_count: number;
  checked_out_count: number;
  return_pending_count: number;
  unavailable_count: number;
  sequencing_available_count: number;
  sequencing_unmatched_count: number;
  sample_status_counts: CountItem[];
  sequencing_status_counts: CountItem[];
  ethnicity_counts: CountItem[];
  latest_import_batch: LatestImportBatch | null;
  latest_scan_batch: LatestScanBatch | null;
};

export async function fetchDashboardSummary() {
  const { data } = await apiClient.get<DashboardSummary>("/api/dashboard/summary");
  return data;
}
