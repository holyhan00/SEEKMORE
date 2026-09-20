import type {
  SpreadsheetPlanCell,
  SpreadsheetPlanCellStyle,
  SpreadsheetPlanColumn,
  SpreadsheetPlanMatrixCell,
  SpreadsheetPlanPrimitive,
  SpreadsheetPlanValueType,
} from '../../planning/spreadsheet/spreadsheet-render-plan.types';

export interface ResolvedSpreadsheetCellSpec {
  value: SpreadsheetPlanCell['value'];
  formula?: string;
  cachedResult?: SpreadsheetPlanPrimitive;
  type: SpreadsheetPlanValueType;
  style?: SpreadsheetPlanCellStyle;
  note?: string;
  hyperlink?: string;
  colSpan?: number;
  rowSpan?: number;
  width?: number;
  height?: number;
}

const CELL_SPEC_KEYS = new Set([
  'kind',
  'value',
  'text',
  'formula',
  'result',
  'cachedResult',
  'type',
  'style',
  'note',
  'hyperlink',
  'colSpan',
  'rowSpan',
  'width',
  'height',
]);

export function isSpreadsheetCellSpec(
  value: unknown,
): value is SpreadsheetPlanCell {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.kind === 'formula' || candidate.kind === 'value') {
    return true;
  }

  return Object.keys(candidate).some((key) => CELL_SPEC_KEYS.has(key));
}

export function resolveStructuredSpreadsheetCell(input: {
  rawValue: unknown;
  column: SpreadsheetPlanColumn;
  inheritedStyle?: SpreadsheetPlanCellStyle;
}): ResolvedSpreadsheetCellSpec {
  const { rawValue, column, inheritedStyle } = input;

  if (isSpreadsheetCellSpec(rawValue)) {
    const raw = rawValue as SpreadsheetPlanCell;
    const formula = normalizeFormula(raw.formula ?? column.formula);
    const cachedResult = raw.cachedResult ?? raw.result;
    const value = raw.text != null ? raw.text : raw.value;

    if (formula && (raw.text != null || raw.value !== undefined || raw.hyperlink)) {
      throw new Error(
        `Formula cell for column "${column.key}" cannot also define value, text, or hyperlink.`,
      );
    }

    return {
      value: value ?? null,
      formula,
      cachedResult,
      type: formula
        ? raw.type ?? column.type ?? 'formula'
        : raw.type ?? column.type ?? 'auto',
      style: {
        ...(inheritedStyle ?? {}),
        ...(column.style ?? {}),
        ...(raw.style ?? {}),
      },
      note: raw.note,
      hyperlink: raw.hyperlink,
      colSpan: raw.colSpan,
      rowSpan: raw.rowSpan,
      width: raw.width ?? column.width,
      height: raw.height,
    };
  }

  if (column.formula) {
    return {
      value: null,
      formula: normalizeFormula(column.formula),
      cachedResult: toFormulaCachedResult(rawValue),
      type: column.type ?? 'formula',
      style: {
        ...(inheritedStyle ?? {}),
        ...(column.style ?? {}),
      },
      width: column.width,
    };
  }

  assertWritableCellValue(rawValue, column.type ?? 'auto', column.key);

  return {
    value: rawValue as SpreadsheetPlanCell['value'],
    type: column.type ?? 'auto',
    style: {
      ...(inheritedStyle ?? {}),
      ...(column.style ?? {}),
    },
    width: column.width,
  };
}

export function normalizeFormula(formula: string | undefined): string | undefined {
  if (formula == null) return undefined;
  const normalized = formula.trim();
  if (!normalized) return undefined;
  return normalized.startsWith('=') ? normalized : `=${normalized}`;
}

export function assertWritableCellValue(
  value: unknown,
  type: SpreadsheetPlanValueType,
  label: string,
): void {
  if (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value instanceof Date
  ) {
    return;
  }

  if (type === 'json') return;

  throw new Error(
    `Structured object at "${label}" requires an explicit cell descriptor or type "json".`,
  );
}

export function toFormulaCachedResult(
  value: unknown,
): SpreadsheetPlanPrimitive | undefined {
  return value == null || ['string', 'number', 'boolean'].includes(typeof value)
    ? value as SpreadsheetPlanPrimitive
    : undefined;
}

export function resolveMatrixSpreadsheetCell(
  cell: SpreadsheetPlanMatrixCell,
): SpreadsheetPlanCell {
  if (!isSpreadsheetCellSpec(cell)) {
    return { value: cell as SpreadsheetPlanCell['value'] };
  }
  return cell;
}
