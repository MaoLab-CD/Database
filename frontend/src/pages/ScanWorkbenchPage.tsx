import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Package,
  QrCode,
  Search,
  Undo2,
} from "lucide-react";
import { Card, Form, Input, InputNumber, Modal, Space, message } from "antd";
import type { InputRef } from "antd";

import type { LoginResult } from "../api/auth";
import {
  checkoutPlateWells,
  fetchPlateDetail,
  type PlateDetailResponse,
} from "../api/plates";
import {
  checkoutSample,
  fetchScannedSampleDetail,
  requestSampleReturn,
  type SampleReturnPayload,
  type SampleDetail,
} from "../api/samples";
import {
  GenomeStatusDescriptions,
  hasGenomeStatus,
} from "../features/sequencing/GenomeStatusDescriptions";
import { SampleBaseDescriptions } from "../components/SampleDescriptions";
import { DnaPlateView } from "../components/DnaPlateView";
import { STATUS_LABELS, statusTag } from "../constants/status";
import { valueText } from "../utils/format";
import { getApiErrorMessage } from "../utils/http";
import { AppAlert, AppButton } from "../ui";

type ScanWorkbenchPageProps = {
  currentUser: LoginResult;
  onReturnRequested?: () => void | Promise<void>;
};

type ReturnRequestValues = {
  used_volume_ul?: number | null;
  purpose?: string;
  note?: string;
};

function canCheckout(status: unknown) {
  return status === "in_storage";
}

function canRequestReturn(status: unknown) {
  return status === "checked_out";
}

export function ScanWorkbenchPage({ currentUser, onReturnRequested }: ScanWorkbenchPageProps) {
  const inputRef = useRef<InputRef>(null);
  const [returnForm] = Form.useForm<ReturnRequestValues>();
  const [scanValue, setScanValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<
    "checkout" | "plate_checkout" | "return" | ""
  >("");
  const [detail, setDetail] = useState<SampleDetail | null>(null);
  const [plateDetail, setPlateDetail] = useState<PlateDetailResponse | null>(null);
  const [selectedPlateWells, setSelectedPlateWells] = useState<string[]>([]);
  const [lastScanned, setLastScanned] = useState("");

  const sample = detail?.sample ?? {};
  const genomeStatus = (detail?.genome_status ?? {}) as Record<string, unknown>;
  const sampleStatus = sample.sample_status;
  const canOperate =
    currentUser.role === "admin" || Boolean(currentUser.permissions.sample_checkout);
  const availablePlateWellCodes =
    plateDetail?.wells
      .filter((well) => well.sample_status === "in_storage")
      .map((well) => well.well_code) ?? [];
  const selectedPlateSamples =
    plateDetail?.wells.filter((well) => selectedPlateWells.includes(well.well_code)) ?? [];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const resetScanner = () => {
    setScanValue("");
    setDetail(null);
    setPlateDetail(null);
    setSelectedPlateWells([]);
    setLastScanned("");
    inputRef.current?.focus();
  };

  const lookupSample = async () => {
    const sampleKey = scanValue.trim();
    if (!sampleKey) {
      message.warning("请先扫码或输入样本编码");
      inputRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      if (sampleKey.toUpperCase().startsWith("PLATE:")) {
        const plateCode = sampleKey.slice(sampleKey.indexOf(":") + 1).trim();
        if (!plateCode) {
          setDetail(null);
          setPlateDetail(null);
          message.warning("板码缺少板号");
          return;
        }
        const data = await fetchPlateDetail(plateCode);
        setDetail(null);
        setPlateDetail(data);
        setSelectedPlateWells([]);
        setLastScanned(sampleKey);
        return;
      }

      try {
        const data = await fetchScannedSampleDetail(sampleKey);
        if (data.sample.sample_id) {
          setDetail(data);
          setPlateDetail(null);
          setSelectedPlateWells([]);
          setLastScanned(sampleKey);
          return;
        }
      } catch {
        // A bare plate code is not a sample, so a sample 404 must fall through
        // to the plate lookup instead of ending the whole scan request.
      }

      try {
        const plateData = await fetchPlateDetail(sampleKey);
        setDetail(null);
        setPlateDetail(plateData);
        setSelectedPlateWells([]);
        setLastScanned(sampleKey);
      } catch {
        setDetail(null);
        setPlateDetail(null);
        setSelectedPlateWells([]);
        setLastScanned(sampleKey);
        message.warning(`未找到样本或 DNA 板 ${sampleKey}`);
      }
    } catch {
      setDetail(null);
      setPlateDetail(null);
      setSelectedPlateWells([]);
      setLastScanned(sampleKey);
      message.error(
        sampleKey.toUpperCase().startsWith("PLATE:")
          ? "DNA 板查询失败，请确认板号是否正确"
          : "样本查询失败，请稍后重试",
      );
    } finally {
      setLoading(false);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };

  const refreshSample = async (sampleId: string) => {
    const data = await fetchScannedSampleDetail(sampleId);
    setDetail(data.sample.sample_id ? data : null);
  };

  const refreshPlate = async (plateCode: string) => {
    const data = await fetchPlateDetail(plateCode);
    setPlateDetail(data);
    setSelectedPlateWells([]);
  };

  const handleCheckout = async () => {
    const sampleKey = String(sample.sample_code || sample.sample_id || "");
    if (!sampleKey) return;
    setActionLoading("checkout");
    try {
      const result = await checkoutSample(sampleKey);
      await refreshSample(sampleKey);
      message.success(result.message);
    } catch (error: unknown) {
      const detailMessage =
        typeof error === "object" &&
        error !== null &&
        "response" in error &&
        typeof error.response === "object" &&
        error.response !== null &&
        "data" in error.response &&
        typeof error.response.data === "object" &&
        error.response.data !== null &&
        "detail" in error.response.data
          ? String(error.response.data.detail)
          : "出库失败";
      message.error(detailMessage);
    } finally {
      setActionLoading("");
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };

  const handleReturnRequest = async (values: ReturnRequestValues = {}) => {
    const sampleKey = String(sample.sample_code || sample.sample_id || "");
    if (!sampleKey) return;
    setActionLoading("return");
    try {
      const payload: SampleReturnPayload = {
        used_volume_ul: values.used_volume_ul ?? null,
        purpose: values.purpose?.trim() || undefined,
        return_location: String(sample.storage_location || "").trim() || undefined,
        note: values.note?.trim() || undefined,
      };
      const result = await requestSampleReturn(sampleKey, payload);
      await refreshSample(sampleKey);
      await onReturnRequested?.();
      message.success(result.message);
    } catch (error: unknown) {
      const detailMessage =
        typeof error === "object" &&
        error !== null &&
        "response" in error &&
        typeof error.response === "object" &&
        error.response !== null &&
        "data" in error.response &&
        typeof error.response.data === "object" &&
        error.response.data !== null &&
        "detail" in error.response.data
          ? String(error.response.data.detail)
          : "提交归还失败";
      message.error(detailMessage);
    } finally {
      setActionLoading("");
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };

  const confirmCheckout = () => {
    const sampleId = String(sample.sample_code || sample.sample_id || "");
    Modal.confirm({
      title: "确认扫码出库？",
      content: `样本 ${sampleId} 当前在库，确认后状态将变为“已出库”。`,
      okText: "确认出库",
      cancelText: "取消",
      centered: true,
      onOk: handleCheckout,
    });
  };

  const handlePlateCheckout = async () => {
    if (!plateDetail || selectedPlateWells.length === 0) return;
    setActionLoading("plate_checkout");
    try {
      const result = await checkoutPlateWells(
        plateDetail.plate.plate_code,
        selectedPlateWells,
      );
      await refreshPlate(plateDetail.plate.plate_code);
      message.success(result.message);
    } catch (error) {
      message.error(getApiErrorMessage(error, "DNA 批量出库失败"));
    } finally {
      setActionLoading("");
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };

  const confirmPlateCheckout = () => {
    if (!plateDetail || selectedPlateSamples.length === 0) return;
    const preview = selectedPlateSamples.slice(0, 12);
    Modal.confirm({
      title: `确认出库 ${selectedPlateSamples.length} 份 DNA？`,
      content: (
        <div className="plate-checkout-confirm">
          <p>
            板号：<strong>{plateDetail.plate.plate_code}</strong>
          </p>
          <div className="plate-checkout-confirm-list">
            {preview.map((well) => (
              <span key={well.well_code}>
                {well.well_code} · {well.sample_code || well.sample_id}
              </span>
            ))}
          </div>
          {selectedPlateSamples.length > preview.length ? (
            <p>另有 {selectedPlateSamples.length - preview.length} 份 DNA。</p>
          ) : null}
          <p>确认后，仅以上选中的 DNA 样本状态会变为“已出库”。</p>
        </div>
      ),
      okText: "确认出库",
      cancelText: "取消",
      centered: true,
      onOk: handlePlateCheckout,
    });
  };

  const confirmReturnRequest = () => {
    const sampleId = String(sample.sample_code || sample.sample_id || "");
    returnForm.resetFields();
    Modal.confirm({
      title: "确认提交归还？",
      content: (
        <Form form={returnForm} layout="vertical" className="return-request-form">
          <p className="modal-form-note">
            样本 {sampleId} 当前已出库，确认后状态将变为“待归还复核”。
          </p>
          <p className="modal-form-note">
            原冰箱位置：{valueText(sample.storage_location)}
          </p>
          <Form.Item
            label="使用量（ul）"
            name="used_volume_ul"
            rules={[{ type: "number", min: 0, message: "使用量不能小于 0" }]}
          >
            <InputNumber min={0} precision={4} placeholder="可选" style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="用途" name="purpose">
            <Input placeholder="可选，如 建库、质控、复测" maxLength={100} />
          </Form.Item>
          <Form.Item label="备注" name="note">
            <Input.TextArea placeholder="可选" maxLength={300} rows={3} />
          </Form.Item>
        </Form>
      ),
      okText: "确认归还",
      cancelText: "取消",
      centered: true,
      onOk: async () => {
        const values = await returnForm.validateFields();
        await handleReturnRequest(values);
      },
    });
  };

  return (
    <div className="scan-workbench-page">
      <Card className="scan-input-card">
        <div className="scan-input-row">
          <Input
            ref={inputRef}
            size="large"
            allowClear
            prefix={<QrCode />}
            placeholder="请扫码或输入正式样本编码、DNA 板号"
            value={scanValue}
            onChange={(event) => setScanValue(event.target.value)}
            onPressEnter={lookupSample}
            className="scan-main-input"
          />
          <AppButton
            tone="primary"
            icon={<Search />}
            loading={loading}
            onClick={lookupSample}
          >
            查询
          </AppButton>
          <AppButton tone="secondary" onClick={resetScanner}>
            清空
          </AppButton>
        </div>
      </Card>

      {plateDetail ? (
        <Card className="scan-detail-card scan-plate-card" title={`DNA 板 ${plateDetail.plate.plate_code}`}>
          <AppAlert
            type="info"
            message={canOperate ? "选择要出库的在库 DNA" : "当前账号仅可查看板位"}
            description={
              canOperate
                ? "点击绿色在库孔位进行多选；其他状态可以查看，但不能重复出库。"
                : "当前账号没有出入库操作权限。"
            }
          />
          {canOperate ? (
            <div className="plate-checkout-toolbar">
              <div>
                已选 <strong>{selectedPlateWells.length}</strong> 份，可出库{" "}
                <strong>{availablePlateWellCodes.length}</strong> 份
              </div>
              <Space size={8} wrap>
                <AppButton
                  tone="secondary"
                  size="small"
                  disabled={availablePlateWellCodes.length === 0}
                  onClick={() => setSelectedPlateWells(availablePlateWellCodes)}
                >
                  全选可出库
                </AppButton>
                <AppButton
                  tone="quiet"
                  size="small"
                  disabled={selectedPlateWells.length === 0}
                  onClick={() => setSelectedPlateWells([])}
                >
                  清空选择
                </AppButton>
                <AppButton
                  tone="primary"
                  size="small"
                  icon={<Package />}
                  loading={actionLoading === "plate_checkout"}
                  disabled={selectedPlateWells.length === 0}
                  onClick={confirmPlateCheckout}
                >
                  确认出库 {selectedPlateWells.length > 0 ? `(${selectedPlateWells.length})` : ""}
                </AppButton>
              </Space>
            </div>
          ) : null}
          <DnaPlateView
            detail={plateDetail}
            checkoutSelection={canOperate}
            selectedWellCodes={selectedPlateWells}
            onSelectedWellCodesChange={setSelectedPlateWells}
          />
        </Card>
      ) : !detail ? (
        <div className="scan-empty-state">
          <QrCode />
          <strong>{lastScanned ? `未找到样本 ${lastScanned}` : "等待扫码"}</strong>
        </div>
      ) : (
        <div className="scan-result-grid">
          <Card className="scan-status-card">
            <div className="scan-status-header">
              <div>
                <span>当前样本</span>
                <strong>{valueText(sample.sample_code || sample.sample_id)}</strong>
              </div>
              {statusTag(String(sampleStatus ?? ""))}
            </div>
            <div className="scan-storage-location">
              <span>冰箱位置</span>
              <strong>{valueText(sample.storage_location)}</strong>
            </div>

            <div className="scan-status-body">
              {canCheckout(sampleStatus) ? (
                <AppAlert
                  type="success"
                  message="样本在库，可出库"
                  description="扫码出库后状态将变为“已出库”"
                />
              ) : canRequestReturn(sampleStatus) ? (
                <AppAlert
                  type="warning"
                  message="样本已出库，可提交归还"
                  description="归还后进入待复核状态，需要管理员确认最终状态。"
                />
              ) : (
                <AppAlert
                  type="info"
                  message={`当前状态：${STATUS_LABELS[String(sampleStatus)] ?? valueText(sampleStatus)}`}
                  description="该状态下暂不可再次出库。"
                />
              )}
            </div>

            {canCheckout(sampleStatus) && canOperate ? (
              <AppButton
                tone="primary"
                icon={<Package />}
                loading={actionLoading === "checkout"}
                onClick={confirmCheckout}
                block
              >
                扫码出库
              </AppButton>
            ) : canRequestReturn(sampleStatus) && canOperate ? (
              <AppButton
                tone="primary"
                icon={<Undo2 />}
                loading={actionLoading === "return"}
                onClick={confirmReturnRequest}
                block
              >
                提交归还
              </AppButton>
            ) : null}

            {!canOperate ? (
              <div className="scan-permission-note">
                <AlertTriangle />
                当前账号没有出入库操作权限，只能扫码查询。
              </div>
            ) : null}
          </Card>

          <Card className="scan-detail-card" title="样本基础信息">
            <SampleBaseDescriptions
              sample={sample}
              title={null}
              showVisitType={false}
              showSampleStatus={false}
            />
          </Card>

          {hasGenomeStatus(genomeStatus) ? (
            <Card className="scan-detail-card" title="基因组测序信息" style={{ gridColumn: 2 }}>
              <GenomeStatusDescriptions status={genomeStatus} />
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}
