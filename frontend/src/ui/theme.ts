import type { ThemeConfig } from "antd";

export const appTheme: ThemeConfig = {
  token: {
    colorPrimary: "#2563eb",
    colorSuccess: "#15803d",
    colorWarning: "#b45309",
    colorError: "#dc2626",
    colorInfo: "#2563eb",
    colorText: "#172033",
    colorTextSecondary: "#526173",
    colorBorder: "#d8e2ef",
    colorBgLayout: "#eef2f7",
    colorBgContainer: "#ffffff",
    borderRadius: 8,
    controlHeight: 38,
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  components: {
    Button: {
      borderRadius: 8,
      controlHeightLG: 44,
      fontWeight: 700,
      primaryShadow: "none",
    },
    Card: {
      borderRadiusLG: 8,
      headerBg: "#ffffff",
    },
    Form: {
      labelColor: "#263244",
      labelFontSize: 14,
      itemMarginBottom: 20,
    },
    Input: {
      borderRadius: 8,
      controlHeightLG: 44,
      activeShadow: "0 0 0 3px rgba(37, 99, 235, 0.12)",
    },
    Select: {
      borderRadius: 8,
      controlHeightLG: 44,
      optionSelectedBg: "#eff6ff",
    },
    Modal: {
      borderRadiusLG: 8,
      titleFontSize: 18,
    },
  },
};
