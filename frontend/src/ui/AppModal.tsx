import { Modal } from "antd";
import type { ModalFuncProps, ModalProps } from "antd";

export function AppModal({ className, ...props }: ModalProps) {
  return (
    <Modal
      {...props}
      className={["app-modal", className].filter(Boolean).join(" ")}
    />
  );
}

export function confirmAction(config: ModalFuncProps) {
  return Modal.confirm({
    centered: true,
    okText: "确认",
    cancelText: "取消",
    icon: null,
    ...config,
  });
}
