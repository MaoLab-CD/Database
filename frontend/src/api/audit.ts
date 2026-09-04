import { apiClient } from "./client";

export type AuditSummary = {
  private_access_count: number;
};

export type PrivateAccessType = "view" | "export";

export type PrivateAccessLogItem = {
  id: number;
  sample_pk: number | null;
  sample_id: string;
  sample_code: string | null;
  viewer_id: number;
  viewer_name: string | null;
  viewer_username: string | null;
  viewer_role: string;
  viewed_fields: string[];
  view_reason: string | null;
  access_type: PrivateAccessType;
  ip_address: string | null;
  device_info: string | null;
  created_at: string;
};

export type PrivateAccessLogResponse = {
  items: PrivateAccessLogItem[];
  total: number;
  page: number;
  page_size: number;
};

export type PrivateAccessLogParams = {
  keyword?: string;
  access_type?: PrivateAccessType;
  page?: number;
  page_size?: number;
};

export async function fetchAuditSummary() {
  const { data } = await apiClient.get<AuditSummary>("/api/audit/summary");
  return data;
}

export async function fetchPrivateAccessLogs(params: PrivateAccessLogParams) {
  const { data } = await apiClient.get<PrivateAccessLogResponse>(
    "/api/audit/private-access",
    { params },
  );
  return data;
}
