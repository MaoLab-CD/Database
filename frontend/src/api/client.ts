import axios from "axios";

export const apiClient = axios.create();

apiClient.interceptors.request.use((config) => {
  const saved = window.localStorage.getItem("sample_admin_user");
  if (saved) {
    try {
      const user = JSON.parse(saved) as { access_token?: string };
      if (user.access_token) {
        config.headers.Authorization = `Bearer ${user.access_token}`;
      }
    } catch {
      window.localStorage.removeItem("sample_admin_user");
    }
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      window.localStorage.removeItem("sample_admin_user");
      window.dispatchEvent(new Event("sample-admin-auth-expired"));
    }
    return Promise.reject(error);
  },
);
