import { apiClient } from "./client";

export type UserRole = "admin" | "user";
export type UserStatus = "active" | "disabled";
export type AccountType = "internal" | "hospital";

export type UserItem = {
  id: number;
  username: string;
  display_name: string;
  role: UserRole;
  is_super_admin: boolean;
  permissions: Record<string, boolean>;
  status: UserStatus;
  password_reset_required: boolean;
  password_changed_at: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  account_type: AccountType;
  center_codes: string[];
};

export type UserListResponse = {
  items: UserItem[];
  total: number;
  page: number;
  page_size: number;
};

export type UserListParams = {
  keyword?: string;
  role?: UserRole;
  user_status?: UserStatus;
  page?: number;
  page_size?: number;
};

export type CreateUserPayload = {
  username: string;
  display_name: string;
  password: string;
  role: UserRole;
  permissions: Record<string, boolean>;
  status: UserStatus;
  password_reset_required: boolean;
  account_type: AccountType;
  center_codes: string[];
};

export type UpdateUserPayload = {
  display_name: string;
  role: UserRole;
  permissions: Record<string, boolean>;
  status: UserStatus;
  password_reset_required: boolean;
  account_type: AccountType;
  center_codes: string[];
};

export async function fetchUsers(params: UserListParams) {
  const { data } = await apiClient.get<UserListResponse>("/api/users", { params });
  return data;
}

export async function createUser(payload: CreateUserPayload) {
  const { data } = await apiClient.post<UserItem>("/api/users", payload);
  return data;
}

export async function updateUser(userId: number, payload: UpdateUserPayload) {
  const { data } = await apiClient.put<UserItem>(`/api/users/${userId}`, payload);
  return data;
}

export async function resetUserPassword(
  userId: number,
  newPassword: string,
  passwordResetRequired = true,
) {
  const { data } = await apiClient.post<UserItem>(`/api/users/${userId}/reset-password`, {
    new_password: newPassword,
    password_reset_required: passwordResetRequired,
  });
  return data;
}
