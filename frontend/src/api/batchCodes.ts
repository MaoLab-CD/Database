import { apiClient } from "./client";
import axios from "axios";


export type ExcelCodeOptions = {
  sheet_name: string;
  center_code: string;
  sample_type: string;
};

export type ExcelCodePreview = {
  total_count: number;
  generated_count: number;
  reused_count: number;
  provided_count: number;
  date_counts: Record<string, number>;
  rows: Array<{
    row_number: number;
    collection_date: string;
    sample_code: string;
    assignment_source: "generated" | "reused" | "provided";
  }>;
};

function createFormData(file: File, options: ExcelCodeOptions) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("sheet_name", options.sheet_name);
  formData.append("center_code", options.center_code);
  formData.append("sample_type", options.sample_type);
  return formData;
}

export async function previewCodesForExcel(
  file: File,
  options: ExcelCodeOptions,
) {
  const { data } = await apiClient.post<ExcelCodePreview>(
    "/api/batch-codes/excel/preview",
    createFormData(file, options),
  );
  return data;
}

export async function generateCodesForExcel(
  file: File,
  options: ExcelCodeOptions,
) {
  let response;
  try {
    response = await apiClient.post<Blob>("/api/batch-codes/excel", createFormData(file, options), {
      responseType: "blob",
    });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
      const payload = JSON.parse(await error.response.data.text());
      error.response.data = payload;
    }
    throw error;
  }
  return {
    blob: response.data,
    totalCount: Number(response.headers["x-generated-count"] || 0),
    newCount: Number(response.headers["x-new-count"] || 0),
    reusedCount: Number(response.headers["x-reused-count"] || 0),
    preservedCount: Number(response.headers["x-preserved-count"] || 0),
  };
}
