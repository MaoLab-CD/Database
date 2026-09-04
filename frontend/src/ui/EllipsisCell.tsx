/*
 * @Author: 袁瑞 && 2502099390@qq.com
 * @Date: 2026-07-07 10:23:06
 * @LastEditors: 袁瑞 && 2502099390@qq.com
 * @LastEditTime: 2026-07-31 17:24:26
 * @FilePath: \sample_admin\frontend\src\ui\EllipsisCell.tsx
 * @Description: 超出省略号单元格组件
 */
import { Copy } from "lucide-react";
import { Tooltip, message } from "antd";

import { valueText } from "../utils/format";

type EllipsisCellProps = {
  value: unknown;
  className?: string;
  copyable?: boolean;
  strong?: boolean;
  copyLabel?: string;
};

async function copyText(text: string) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error("copy_failed");
  }
}

export function EllipsisCell({
  value,
  className = "sequencing-ellipsis-cell",
  copyable = false,
  strong = false,
  copyLabel = "内容",
}: EllipsisCellProps) {
  const text = valueText(value);
  if (text === "-") {
    return text;
  }

  const textNode = strong ? <strong>{text}</strong> : text;
  if (!copyable) {
    return (
      <Tooltip title={text}>
        <span className={className}>{textNode}</span>
      </Tooltip>
    );
  }

  return (
    <span className="ellipsis-copy-cell">
      <Tooltip title={text}>
        <span className={className}>{textNode}</span>
      </Tooltip>
      <Tooltip title={`复制${copyLabel}`}>
        <button
          type="button"
          className="ellipsis-copy-button"
          aria-label={`复制${copyLabel} ${text}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            copyText(text)
              .then(() => message.success(`${copyLabel}已复制`))
              .catch(() => message.error("复制失败，请重试"));
          }}
        >
          <Copy size={14} />
        </button>
      </Tooltip>
    </span>
  );
}
