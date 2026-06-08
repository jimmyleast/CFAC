export function isRollupDimension(dimension: unknown) {
  if (!dimension || typeof dimension !== 'object') return true
  const keys = Object.keys(dimension as Record<string, unknown>)
  return keys.length === 0 || keys.every((key) => key === 'workbook_sheet')
}
