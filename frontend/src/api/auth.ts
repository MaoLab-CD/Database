import { apiClient } from "./client";

export type LoginPayload = {
  username: string;
  password: string;
  remember_me?: boolean;
};

export type ChangePasswordPayload = {
  old_password: string;
  new_password: string;
};

export type LoginResult = {
  access_token: string;
  token_type: string;
  username: string;
  display_name: string;
  role: string;
  is_super_admin: boolean;
  permissions: Record<string, boolean>;
  password_reset_required: boolean;
  account_type: "internal" | "hospital";
  center_codes: string[];
  center_names?: Record<string, string>;
};

export async function login(payload: LoginPayload) {
  const { data } = await apiClient.post<LoginResult>("/api/auth/login", payload);
  return data;
}

export async function fetchCurrentUser() {
  const { data } = await apiClient.get<Omit<LoginResult, "access_token" | "token_type">>(
    "/api/auth/me",
  );
  return data;
}

export async function changePassword(payload: ChangePasswordPayload) {
  const { data } = await apiClient.post<{ success: boolean }>(
    "/api/auth/change-password",
    payload,
  );
  return data;
}
