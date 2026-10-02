import { useState } from 'react';
import { useTreasury } from '@/app/context';
import { Field, Panel } from '@/components/ui';
export function ReviewPreferences() {
  const { t, run } = useTreasury(),
    [settings, setSettings] = useState(() => t.spending.reviewSettings());
  return (
    <Panel title="Spending review defaults">
      <p className="subtle">
        New reviews capture these defaults. Open reviews and cleared reports keep their own settings.
      </p>
      <form
        className="v3-form"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => t.spending.setReviewSettings(settings), 'Review defaults saved');
        }}
      >
        <Field label="Household time zone">
          <input
            className="box"
            required
            value={settings.timeZone}
            onChange={(e) => setSettings({ ...settings, timeZone: e.target.value })}
            placeholder="America/Los_Angeles"
          />
        </Field>
        {(['settleDays', 'pairingDays'] as const).map((key) => (
          <Field
            key={key}
            label={key === 'settleDays' ? 'Provider settle delay (days)' : 'Transfer pairing window (days)'}
          >
            <input
              className="box"
              type="number"
              min={0}
              max={10}
              required
              value={settings[key]}
              onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })}
            />
          </Field>
        ))}
        <button className="btn">Save review defaults</button>
      </form>
    </Panel>
  );
}
