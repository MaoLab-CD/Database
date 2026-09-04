import type { AxiosProgressEvent } from "axios";

import { apiClient } from "./client";

export const SECURE_DOCUMENT_MAX_BYTES = 200 * 1024 * 1024;

export type SecureDocumentType = "organoid_report" | "informed_consent_bundle" | "other";
export type SecureDocumentScope = "sample" | "collection";

export type SecureDocumentItem = {
  id: number;
  document_type: SecureDocumentType;
  scope_type: SecureDocumentScope;
  sample_pk: number | null;
  sample_code: string | null;
  specimen_type: string | null;
  center_code: string | null;
  center_name: string | null;
  title: string;
  coverage_note: string | null;
  original_file_name: string;
  mime_type: string;
  file_size: number;
  file_sha256: string;
  uploaded_by: number;
  uploaded_by_name: string | null;
  created_at: string;
};

export type SecureDocumentListResponse = {
  items: SecureDocumentItem[];
  total: number;
  page: number;
  page_size: number;
};

export type SecureDocumentListParams = {
  scope_type?: SecureDocumentScope;
  sample_pk?: number;
  document_type?: SecureDocumentType;
  keyword?: string;
  page?: number;
  page_size?: number;
};

export type UploadSecureDocumentPayload = {
  file: File;
  document_type: SecureDocumentType;
  scope_type: SecureDocumentScope;
  title?: string;
  coverage_note?: string;
  sample_pk?: number;
  center_code?: string;
};

export async function fetchSecureDocuments(params: SecureDocumentListParams = {}) {
  const { data } = await apiClient.get<SecureDocumentListResponse>("/api/documents", { params });
  return data;
}

export async function uploadSecureDocument(
  payload: UploadSecureDocumentPayload,
  onUploadProgress?: (event: AxiosProgressEvent) => void,
) {
  const body = new FormData();
  body.append("file", payload.file);
  body.append("document_type", payload.document_type);
  body.append("scope_type", payload.scope_type);
  if (payload.title) body.append("title", payload.title);
  if (payload.coverage_note) body.append("coverage_note", payload.coverage_note);
  if (payload.sample_pk) body.append("sample_pk", String(payload.sample_pk));
  if (payload.center_code) body.append("center_code", payload.center_code);
  const { data } = await apiClient.post<SecureDocumentItem>("/api/documents/upload", body, {
    onUploadProgress,
  });
  return data;
}

export async function fetchSecureDocumentPreview(
  documentId: number,
  onDownloadProgress?: (event: AxiosProgressEvent) => void,
  signal?: AbortSignal,
) {
  const { data } = await apiClient.get<Blob>(`/api/documents/${documentId}/preview`, {
    responseType: "blob",
    onDownloadProgress,
    signal,
  });
  return data;
}

export async function downloadSecureDocument(
  documentId: number,
  onDownloadProgress?: (event: AxiosProgressEvent) => void,
) {
  const { data } = await apiClient.get<Blob>(`/api/documents/${documentId}/download`, {
    responseType: "blob",
    onDownloadProgress,
  });
  return data;
}

export async function deleteSecureDocument(documentId: number) {
  const { data } = await apiClient.delete<{ ok: boolean }>(`/api/documents/${documentId}`);
  return data;
}
