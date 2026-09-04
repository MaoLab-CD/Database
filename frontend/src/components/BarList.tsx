import type { CountItem } from "../api/dashboard";
import { getBarToneClass, STATUS_LABELS } from "../constants/status";

function maxCount(items: CountItem[]) {
  return Math.max(1, ...items.map((item) => item.count));
}

export function BarList({ items }: { items: CountItem[] }) {
  const max = maxCount(items);
  if (items.length === 0) {
    return <div className="empty-small">暂无数据</div>;
  }

  return (
    <div className="bar-list">
      {items.map((item) => (
        <div className="bar-row" key={item.name}>
          <div className="bar-row-meta">
            <span>{STATUS_LABELS[item.name] ?? item.name}</span>
            <strong>{item.count}</strong>
          </div>
          <div className="bar-track">
            <div
              className={getBarToneClass(item.name)}
              style={{ width: `${Math.max(6, (item.count / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
