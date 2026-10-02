import { useState } from 'react';
import { Field, Dialog } from '@/components/ui';
import { parseCsv, parseCsvStatement, parseOfx, type Statement } from '@/import/statements';
import { monthPeriod, type CsvProfile, type InstitutionAccount } from '@/domain/spending';
import { formatUSD } from '@/domain/money';
export function StatementImport({
  account,
  month,
  onClose,
  onImport,
}: {
  account: InstitutionAccount;
  month: string;
  onClose: () => void;
  onImport: (s: Statement, profile: CsvProfile | null) => void;
}) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null),
    [statement, setStatement] = useState<Statement | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState<CsvProfile>(
      account.csvProfile ?? {
        date: 'Date',
        description: 'Description',
        amount: 'Amount',
        outflowPositive: false,
      },
    ),
    [period, setPeriod] = useState(monthPeriod(month));
  let headers: string[] = [];
  try {
    if (file?.name.toLowerCase().endsWith('.csv')) headers = parseCsv(file.text)[0] ?? [];
  } catch {
    /* Preview reports the parser error. */
  }
  const preview = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      setStatement(
        file.name.toLowerCase().endsWith('.csv')
          ? await parseCsvStatement(file.text, file.name, account.id, profile, period)
          : await parseOfx(file.text, file.name, account.id),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open title={`Import statement: ${account.displayName}`} onClose={onClose} wide>
      <div className="v3-form">
        <Field label="Statement file">
          <input
            type="file"
            accept=".csv,.ofx,.qfx,.qbo"
            onChange={async (e) => {
              setStatement(null);
              setError('');
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 8 * 1024 * 1024) {
                setError('Statement exceeds 8 MiB');
                return;
              }
              setFile({ name: f.name, text: await f.text() });
            }}
          />
        </Field>
        {headers.length > 0 && (
          <>
            <p>
              Map the posted date and description. Confirm the sign convention and the statement’s full
              period.
            </p>
            {(
              [
                'date',
                'description',
                ...(profile.amount !== undefined ? ['amount'] : ['debit', 'credit']),
              ] as const
            ).map((key) => (
              <Field key={key} label={`${key[0].toUpperCase()}${key.slice(1)} column`}>
                <select
                  className="box"
                  value={(profile[key as keyof CsvProfile] as string) ?? ''}
                  onChange={(e) => {
                    setStatement(null);
                    setProfile({ ...profile, [key]: e.target.value });
                  }}
                >
                  <option value="">Choose column</option>
                  {headers.map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
              </Field>
            ))}
            <label>
              <input
                type="checkbox"
                checked={profile.amount === undefined}
                onChange={(e) => {
                  setStatement(null);
                  setProfile(
                    e.target.checked
                      ? { ...profile, amount: undefined, debit: 'Debit', credit: 'Credit' }
                      : { ...profile, amount: 'Amount', debit: undefined, credit: undefined },
                  );
                }}
              />{' '}
              Separate debit and credit columns
            </label>
            {profile.amount !== undefined && (
              <label>
                <input
                  type="checkbox"
                  checked={profile.outflowPositive}
                  onChange={(e) => {
                    setStatement(null);
                    setProfile({ ...profile, outflowPositive: e.target.checked });
                  }}
                />{' '}
                Purchases appear as positive amounts in this file
              </label>
            )}
            <div className="grid-2">
              <Field label="Statement starts">
                <input
                  className="box"
                  type="date"
                  value={period.start}
                  onChange={(e) => {
                    setStatement(null);
                    setPeriod({ ...period, start: e.target.value });
                  }}
                />
              </Field>
              <Field label="Statement ends">
                <input
                  className="box"
                  type="date"
                  value={period.end}
                  onChange={(e) => {
                    setStatement(null);
                    setPeriod({ ...period, end: e.target.value });
                  }}
                />
              </Field>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="err">
            {error}
          </p>
        )}
        <button className="btn" disabled={!file || busy} onClick={() => void preview()}>
          {busy ? 'Reading…' : 'Preview statement'}
        </button>
        {statement && (
          <>
            <p>
              {statement.transactions.length} transactions · {statement.period.start} through{' '}
              {statement.period.end}. Negative amounts are money leaving this account.
            </p>
            {statement.warnings.map((w) => (
              <p className="notice" key={w}>
                {w}
              </p>
            ))}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Posted date</th>
                    <th>Description</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.transactions.slice(0, 10).map((t) => (
                    <tr key={t.id}>
                      <td>{t.postedDate}</td>
                      <td>{t.description}</td>
                      <td>{formatUSD(t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              className="btn primary"
              onClick={() => {
                try {
                  onImport(statement, headers.length ? profile : null);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Confirm and import
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
