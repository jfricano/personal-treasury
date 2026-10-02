import { useState } from 'react';
import { CommitInput, Field } from '@/components/ui';
import { calendarDate, exactAmount, type Balance } from '@/domain/spending';
import { cmp } from '@/domain/money';
export function LiabilityDetails({
  details,
  label,
  onChange,
}: {
  details?: Balance['details'];
  label: string;
  onChange: (details: NonNullable<Balance['details']>) => void;
}) {
  const [error, setError] = useState('');
  const set = (key: string, value: string) => {
    try {
      const parsed = value ? (key === 'dueDate' ? calendarDate(value) : exactAmount(value)) : undefined;
      if (key === 'apr' && parsed && cmp(parsed, '0') < 0) throw new Error('APR cannot be negative.');
      onChange({ ...details, source: 'manual', [key]: parsed });
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <details>
      <summary>Statement and loan details</summary>
      {error && <p role="alert">{error}</p>}
      <p className="subtle">
        Optional details.{' '}
        {details
          ? `Source: ${details.source}. Editing marks these details as manual.`
          : 'Enter details from a statement.'}
      </p>
      <div className="grid-2">
        {(
          [
            ['statementBalance', 'Statement balance'],
            ['minimumPayment', 'Minimum payment'],
            ['originalPrincipal', 'Original principal'],
            ['apr', 'APR (%)'],
            ['dueDate', 'Next due date'],
          ] as const
        ).map(([key, title]) => (
          <Field key={key} label={title}>
            <CommitInput
              value={details?.[key] ?? ''}
              ariaLabel={`${title} for ${label}`}
              onCommit={(value) => set(key, value)}
            />
          </Field>
        ))}
      </div>
    </details>
  );
}
