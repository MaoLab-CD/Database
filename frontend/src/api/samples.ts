import { apiClient } from "./client";

export type SampleListItem = {
  id: number;
  sample_id: string;
  sample_code: string | null;
  center_code: string | null;
  center_name: string | null;
  sample_seq: string | null;
  barcode_no: string | null;
  experiment_no: string | null;
  patient_no: string | null;
  ethnicity: string | null;
  sex: string | null;
  age: string | null;
  visit_type: string | null;
  department: string | null;
  specimen_type: string | null;
  sample_status: string;
  sequencing_status: string;
  storage_location: string | null;
  collection_time: string | null;
  review_time: string | null;
  updated_at: string;
};

export type SampleListResponse = {
  items: SampleListItem[];
  total: number;
  page: number;
  page_size: number;
};

export type SampleDetail = {
  sample: Record<string, unknown>;
  lab_results: Record<string, unknown>;
  visible_data: Record<string, unknown>;
  source_file_name?: string | null;
  row_number?: number | null;
  genome_status?: Record<string, unknown> | null;
};

export type SamplePrivateInfo = {
  id: number | null;
  sample_id: string;
  sample_code: string | null;
  patient_no: string | null;
  name: string | null;
  id_card_no: string | null;
  phone: string | null;
  address: string | null;
  accessed_at: string;
};

export type SampleOperationResult = {
  sample_id: string;
  sample_status: string;
  related_record_id: number;
  message: string;
};

export type SampleReturnPayload = {
  used_volume_ul?: number | null;
  purpose?: string;
  return_location?: string;
  note?: string;
};

export type SampleListParams = {
  keyword?: string;
  center_code?: string;
  specimen_type?: string;
  sample_status?: string;
  sequencing_status?: string;
  page?: number;
  page_size?: number;
};

export async function fetchSamples(params: SampleListParams) {
  const { data } = await apiClient.get<SampleListResponse>("/api/samples", {
    params,
  });
  return data;
}

export async function downloadSamplesExport(params: Omit<SampleListParams, "page" | "page_size">) {
  const { data } = await apiClient.get<Blob>("/api/samples/export", {
    params,
    responseType: "blob",
  });
  return data;
}

export async function fetchSampleDetail(sampleId: string) {
  const { data } = await apiClient.get<SampleDetail>(`/api/samples/${sampleId}`);
  return data;
}

export async function fetchScannedSampleDetail(sampleCode: string) {
  const { data } = await apiClient.get<SampleDetail>(`/api/samples/${sampleCode}`, {
    params: { lookup_by: "sample_code" },
  });
  return data;
}

export async function fetchSamplePrivateInfo(sampleId: string) {
  const { data } = await apiClient.get<SamplePrivateInfo>(
    `/api/samples/${sampleId}/private-info`,
  );
  return data;
}

export async function checkoutSample(sampleCode: string) {
  const { data } = await apiClient.post<SampleOperationResult>(
    `/api/samples/${sampleCode}/checkout`,
    {},
  );
  return data;
}

export async function requestSampleReturn(sampleCode: string, payload: SampleReturnPayload = {}) {
  const { data } = await apiClient.post<SampleOperationResult>(
    `/api/samples/${sampleCode}/return-request`,
    payload,
  );
  return data;
}
