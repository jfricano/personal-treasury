import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { exportBudgetWorkbook } from '@/export/budgetWorkbook';
import { analyzeBudgetWorkbook } from '@/import/budget/analyzeBudget';
import { freshTreasury, sampleTreasury } from './helpers';

describe('current budget workbook', () => {
  it('exports the current plan by category and imports it with payroll and tax rules', async () => {
    const source = await sampleTreasury();
    const bytes = exportBudgetWorkbook(source);
    const workbook = XLSX.read(bytes, { type: 'array' });
    expect(workbook.SheetNames[0]).toBe('Summary');
    expect(workbook.SheetNames).toContain('Payroll and tax');
    expect(workbook.SheetNames).toContain('Housing and utilities');
    expect(workbook.SheetNames).not.toContain('Budget History');

    const plan = await analyzeBudgetWorkbook(bytes, 'current budget.xlsx');
    expect(plan.warnings.filter((w) => w.severity === 'fatal')).toEqual([]);
    expect(plan.fatal).toBe(false);
    expect(plan.versions).toHaveLength(1);
    expect(plan.controls.every((c) => c.pass)).toBe(true);
    expect(plan.versions[0].lines).toHaveLength(
      source.budget.versionView(source.budget.activeVersion()!.id).lines.length,
    );
    expect(plan.taxRuleSets).toHaveLength(3);

    const target = await freshTreasury();
    await target.budget.commitImport(plan, { activate: true, replaceTaxRules: false });
    const imported = target.budget.versionView(target.budget.activeVersion()!.id);
    const original = source.budget.versionView(source.budget.activeVersion()!.id);
    expect(imported.payroll!.takeHome).toBe(original.payroll!.takeHome);
    expect(imported.budget!.totalAllocated).toBe(original.budget!.totalAllocated);
    expect(imported.deductions).toHaveLength(original.deductions.length);
    expect(target.accounts().map((a) => a.displayName)).toContain('Household');
    expect(target.budget.ruleSets()).toHaveLength(3);
  });

  it('blocks deleting a budget used by a month and allows removing an unused archived version', async () => {
    const t = await sampleTreasury();
    const active = t.budget.activeVersion()!;
    const archived = t.budget.versions().find((v) => v.version.status === 'archived')!.version;
    expect(() => t.budget.deleteVersion(archived.id)).toThrow(/Treasury months use/);
    const draft = t.budget.duplicateVersion(active.id, 'Temporary');
    t.budget.repos.updateVersion({ ...t.budget.repos.getVersion(draft)!, status: 'archived' });
    t.budget.deleteVersion(draft);
    expect(t.budget.repos.getVersion(draft)).toBeUndefined();
  });

  it('keeps an optional blank tax year blank when reading the exported format', async () => {
    const source = await sampleTreasury();
    const workbook = XLSX.read(exportBudgetWorkbook(source), { type: 'array' });
    delete workbook.Sheets.Summary.B4;
    delete workbook.Sheets['Payroll and tax'].B3;
    const plan = await analyzeBudgetWorkbook(
      new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })),
      'budget without tax year.xlsx',
    );
    expect(plan.fatal).toBe(false);
    expect(plan.versions[0].taxYear).toBeNull();
  });
});
