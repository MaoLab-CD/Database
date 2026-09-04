import { useCallback, useEffect, useMemo, useState } from "react";
import { Form, message } from "antd";

import { login, type LoginPayload, type LoginResult } from "./api/auth";
import { fetchPendingReturns } from "./api/returns";
import { ChangePasswordModal } from "./features/auth/ChangePasswordModal";
import { AppLayout } from "./layouts/AppLayout";
import { MENU_ITEMS, canViewMenu } from "./layouts/menu";
import { BatchCodePage } from "./pages/BatchCodePage";
import { CheckoutRecordsPage } from "./pages/CheckoutRecordsPage";
import { CentersPage } from "./pages/CentersPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ExcelImportPage } from "./pages/ExcelImportPage";
import { LoginPage } from "./pages/LoginPage";
import { LogsAuditPage } from "./pages/LogsAuditPage";
import { HospitalReviewPage } from "./pages/HospitalReviewPage";
import { HospitalUploadPage } from "./pages/HospitalUploadPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { ReturnReviewPage } from "./pages/ReturnReviewPage";
import { SamplesPage } from "./pages/SamplesPage";
import { ScanWorkbenchPage } from "./pages/ScanWorkbenchPage";
import { SequencingPage } from "./pages/SequencingPage";
import { SecureDocumentsPage } from "./pages/SecureDocumentsPage";
import { UsersPage } from "./pages/UsersPage";
import { getApiErrorMessage } from "./utils/http";

const STORAGE_KEY = "sample_admin_user";

function getStoredUser() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    return JSON.parse(stored) as LoginResult;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function App() {
  const [loginForm] = Form.useForm<LoginPayload>();
  const [currentUser, setCurrentUser] = useState<LoginResult | null>(() => getStoredUser());
  const [selectedKey, setSelectedKey] = useState("dashboard");
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [pendingReturnCount, setPendingReturnCount] = useState(0);
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    const handleExpired = () => {
      setCurrentUser(null);
      setSelectedKey("dashboard");
      loginForm.resetFields();
      message.warning("登录已过期，请重新登录");
    };

    window.addEventListener("sample-admin-auth-expired", handleExpired);
    return () => window.removeEventListener("sample-admin-auth-expired", handleExpired);
  }, [loginForm]);

  const visibleMenus = useMemo(() => {
    if (!currentUser) {
      return [];
    }
    return MENU_ITEMS.filter((item) => canViewMenu(item, currentUser));
  }, [currentUser]);

  const selectedMenu = useMemo(() => {
    return visibleMenus.find((item) => item.key === selectedKey) ?? visibleMenus[0];
  }, [selectedKey, visibleMenus]);

  useEffect(() => {
    if (currentUser && selectedMenu && selectedKey !== selectedMenu.key) {
      setSelectedKey(selectedMenu.key);
    }
  }, [currentUser, selectedKey, selectedMenu]);

  useEffect(() => {
    if (currentUser?.password_reset_required) {
      setPasswordModalOpen(true);
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentUser?.role !== "admin") {
      setPendingReturnCount(0);
      return;
    }

    let cancelled = false;
    const loadPendingReturnCount = async () => {
      try {
        const rows = await fetchPendingReturns();
        if (!cancelled) {
          setPendingReturnCount(rows.length);
        }
      } catch {
        if (!cancelled) {
          setPendingReturnCount(0);
        }
      }
    };

    loadPendingReturnCount();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  const refreshPendingReturnCount = useCallback(async () => {
    if (currentUser?.role !== "admin") {
      setPendingReturnCount(0);
      return;
    }

    try {
      const rows = await fetchPendingReturns();
      setPendingReturnCount(rows.length);
    } catch {
      setPendingReturnCount(0);
    }
  }, [currentUser]);

  const handleLogin = async (values: LoginPayload) => {
    setLoggingIn(true);
    try {
      const user = await login(values);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
      setCurrentUser(user);
      setSelectedKey(user.account_type === "hospital" ? "hospital-upload" : "dashboard");
      loginForm.resetFields();
      message.success("登录成功");
    } catch (error) {
      message.error(getApiErrorMessage(error, "登录失败，请检查账号或密码"));
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setCurrentUser(null);
    setSelectedKey("dashboard");
  };

  if (!currentUser) {
    return <LoginPage form={loginForm} onLogin={handleLogin} loading={loggingIn} />;
  }

  const renderPage = () => {
    if (selectedMenu?.key === "dashboard") {
      return <DashboardPage />;
    }

    if (selectedMenu?.key === "samples") {
      return <SamplesPage currentUser={currentUser} />;
    }

    if (selectedMenu?.key === "excel-import") {
      return <ExcelImportPage />;
    }

    if (selectedMenu?.key === "hospital-upload") {
      return <HospitalUploadPage currentUser={currentUser} />;
    }

    if (selectedMenu?.key === "hospital-review") {
      return <HospitalReviewPage />;
    }

    if (selectedMenu?.key === "secure-documents") {
      return <SecureDocumentsPage />;
    }

    if (selectedMenu?.key === "batch-code") {
      return <BatchCodePage />;
    }

    if (selectedMenu?.key === "centers") {
      return <CentersPage canManage={currentUser.role === "admin"} />;
    }

    if (selectedMenu?.key === "sequencing") {
      return <SequencingPage currentUser={currentUser} />;
    }

    if (selectedMenu?.key === "scan-workbench") {
      return (
        <ScanWorkbenchPage
          currentUser={currentUser}
          onReturnRequested={refreshPendingReturnCount}
        />
      );
    }

    if (selectedMenu?.key === "return-review") {
      return <ReturnReviewPage onPendingCountChange={setPendingReturnCount} />;
    }

    if (selectedMenu?.key === "checkout-records") {
      return <CheckoutRecordsPage />;
    }

    if (selectedMenu?.key === "users") {
      return <UsersPage currentUser={currentUser} />;
    }

    if (selectedMenu?.key === "logs") {
      return <LogsAuditPage />;
    }

    return <PlaceholderPage />;
  };

  return (
    <>
      <AppLayout
        currentUser={currentUser}
        visibleMenus={visibleMenus}
        selectedMenu={selectedMenu}
        menuBadges={{ "return-review": pendingReturnCount }}
        onSelectMenu={setSelectedKey}
        onChangePassword={() => setPasswordModalOpen(true)}
        onLogout={handleLogout}
      >
        {renderPage()}
      </AppLayout>

      <ChangePasswordModal
        open={passwordModalOpen}
        submitting={passwordSubmitting}
        forced={Boolean(currentUser.password_reset_required)}
        setSubmitting={setPasswordSubmitting}
        onClose={() => {
          if (!currentUser.password_reset_required) {
            setPasswordModalOpen(false);
          }
        }}
        onSuccess={() => {
          setPasswordModalOpen(false);
          handleLogout();
        }}
      />
    </>
  );
}

export default App;
