type ErrorWithDetail = {
  response?: {
    data?: {
      detail?: unknown;
    };
  };
};

export function getApiErrorMessage(error: unknown, fallback: string) {
  const detail = (error as ErrorWithDetail | null)?.response?.data?.detail;
  if (
    typeof detail === "object" &&
    detail !== null &&
    "message" in detail
  ) {
    return String(detail.message);
  }
  return detail ? String(detail) : fallback;
}
