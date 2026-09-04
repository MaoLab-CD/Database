import { useEffect, useMemo, useState } from "react";
import { Grid3X3 } from "lucide-react";
import { Descriptions, Tooltip } from "antd";

import type {
  PlateDetailResponse,
  PlateListItem,
  PlateWellItem,
} from "../api/plates";
import { statusTag } from "../constants/status";
import { formatFullDateTime, valueText } from "../utils/format";

function formatTemperature(value: number | null) {
  if (value === null || value === undefined) {
    return null;
  }
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)} °C`;
}

export function formatPlateLocation(plate: PlateListItem) {
  const freezer = [plate.freezer_code, formatTemperature(plate.temperature_c)]
    .filter(Boolean)
    .join(" ");
  return [
    freezer || null,
    plate.layer_no,
    plate.container_no ? `${plate.container_no}号板架` : null,
    plate.location_note,
  ]
    .filter(Boolean)
    .join(" / ");
}

function wellStatusClass(status: string) {
  if (status === "in_storage") {
    return "is-stored";
  }
  if (status === "checked_out") {
    return "is-checked-out";
  }
  if (status === "return_pending") {
    return "is-return-pending";
  }
  return "is-unavailable";
}

type DnaPlateViewProps = {
  detail: PlateDetailResponse;
  checkoutSelection?: boolean;
  selectedWellCodes?: string[];
  onSelectedWellCodesChange?: (wellCodes: string[]) => void;
};

export function DnaPlateView({
  detail,
  checkoutSelection = false,
  selectedWellCodes = [],
  onSelectedWellCodesChange,
}: DnaPlateViewProps) {
  const [selectedWell, setSelectedWell] = useState<PlateWellItem | null>(null);
  const selectedCodeSet = useMemo(() => new Set(selectedWellCodes), [selectedWellCodes]);

  useEffect(() => {
    setSelectedWell(null);
  }, [detail.plate.id]);

  const wellMap = useMemo(
    () => new Map(detail.wells.map((well) => [well.well_code, well])),
    [detail.wells],
  );
  const rowLabels = Array.from(
    { length: detail.plate.row_count },
    (_, index) => String.fromCharCode(65 + index),
  );
  const columnLabels = Array.from(
    { length: detail.plate.column_count },
    (_, index) => index + 1,
  );

  return (
    <div className="dna-plate-detail">
      <Descriptions column={3} bordered size="small">
        <Descriptions.Item label="板号">
          {detail.plate.plate_code}
        </Descriptions.Item>
        <Descriptions.Item label="规格">
          {detail.plate.row_count}×{detail.plate.column_count}
        </Descriptions.Item>
        <Descriptions.Item label="占用">
          {detail.plate.occupied_count}/
          {detail.plate.row_count * detail.plate.column_count}
        </Descriptions.Item>
        <Descriptions.Item label="存储位置" span={3}>
          {valueText(formatPlateLocation(detail.plate))}
        </Descriptions.Item>
      </Descriptions>

      <div className="dna-plate-grid-heading">
        <span><Grid3X3 />孔位图</span>
        <div className="dna-plate-legend">
          <i className="is-stored" />在库
          <i className="is-checked-out" />已出库
          <i className="is-return-pending" />待归还
          <i className="is-unavailable" />不可用
        </div>
      </div>

      <div className="dna-plate-grid-scroll">
        <div
          className="dna-plate-grid"
          style={{
            gridTemplateColumns: `40px repeat(${columnLabels.length}, minmax(58px, 1fr))`,
          }}
        >
          <div className="dna-plate-grid-corner" />
          {columnLabels.map((column) => (
            <div className="dna-plate-grid-column" key={column}>{column}</div>
          ))}
          {rowLabels.map((row) => (
            <div className="dna-plate-grid-row" key={row}>
              <div className="dna-plate-grid-row-label">{row}</div>
              {columnLabels.map((column) => {
                const wellCode = `${row}${String(column).padStart(2, "0")}`;
                const well = wellMap.get(wellCode);
                const canSelectForCheckout =
                  checkoutSelection && well?.sample_status === "in_storage";
                const isCheckoutSelected = selectedCodeSet.has(wellCode);
                return well ? (
                  <Tooltip
                    key={wellCode}
                    title={well.sample_code || well.sample_id}
                  >
                    <button
                      type="button"
                      className={`dna-plate-well ${wellStatusClass(well.sample_status)} ${
                        selectedWell?.well_code === wellCode ? "is-selected" : ""
                      } ${isCheckoutSelected ? "is-checkout-selected" : ""}`}
                      aria-pressed={canSelectForCheckout ? isCheckoutSelected : undefined}
                      onClick={() => {
                        setSelectedWell(well);
                        if (!canSelectForCheckout || !onSelectedWellCodesChange) {
                          return;
                        }
                        onSelectedWellCodesChange(
                          isCheckoutSelected
                            ? selectedWellCodes.filter((code) => code !== wellCode)
                            : [...selectedWellCodes, wellCode],
                        );
                      }}
                    >
                      <span>{wellCode}</span>
                      <strong>{well.sample_code || well.sample_id}</strong>
                    </button>
                  </Tooltip>
                ) : (
                  <div className="dna-plate-well is-empty" key={wellCode}>
                    <span>{wellCode}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {selectedWell ? (
        <Descriptions title={`${selectedWell.well_code} 孔`} column={2} bordered size="small">
          <Descriptions.Item label="DNA 样本编码">
            {valueText(selectedWell.sample_code || selectedWell.sample_id)}
          </Descriptions.Item>
          <Descriptions.Item label="样本状态">
            {statusTag(selectedWell.sample_status, "sample")}
          </Descriptions.Item>
          <Descriptions.Item label="来源血样" span={2}>
            {valueText(selectedWell.source_sample_code || selectedWell.source_sample_id)}
          </Descriptions.Item>
          <Descriptions.Item label="放入时间" span={2}>
            {formatFullDateTime(selectedWell.placed_at)}
          </Descriptions.Item>
        </Descriptions>
      ) : (
        <div className="dna-plate-selection-hint">选择有样本的孔位查看关联信息</div>
      )}
    </div>
  );
}
