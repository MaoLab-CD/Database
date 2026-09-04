import { apiClient } from "./client";

export type AppConfig = {
  sequencing_root: string;
  sequencing_nas_root?: string | null;
  sequencing_ssh_enabled: boolean;
  sequencing_auto_scan_after_import: boolean;
};

export async function fetchAppConfig() {
  const { data } = await apiClient.get<AppConfig>("/api/config");
  return data;
}
