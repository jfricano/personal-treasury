import { useTreasury } from '@/app/context';
import { monthLabel } from '@/domain/monthly';

export function MonthSelect({ value, onChange }: { value: string | null; onChange: (id: string) => void }) {
  const { t } = useTreasury();
  const months = t.months();
  return (
    <select className="box" aria-label="Month" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {months
        .slice()
        .reverse()
        .map((m) => (
          <option key={m.id} value={m.id}>
            {monthLabel(m.month)}
            {m.closedAt ? ' (closed)' : ''}
          </option>
        ))}
    </select>
  );
}
