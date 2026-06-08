# CFAC Workbook Intake

Use this process for real CFAC workbook discovery without touching non-CFAC project folders and without committing sensitive files.

## Safe Local Folder

Place workbook copies here:

```text
C:\Users\jhhea\.vscode\CFAC\_private\workbooks
```

`_private/` is gitignored. Do not commit real workbook files. Do not point the CFAC app or scripts at any non-CFAC project folder.

## Inventory Tabs And Headers

Run:

```bash
npm run workbooks:inventory
```

Or point at a CFAC folder outside the repo:

```bash
npm run workbooks:inventory -- "C:\Users\jhhea\Documents\CFAC"
```

The script writes:

```text
C:\Users\jhhea\.vscode\CFAC\_private\workbook-inventory.json
```

It records workbook names, sheet names, estimated row counts, and header names only. It intentionally does not export cell values.

## Inventory Formulas

Run:

```bash
npm run workbooks:formulas -- "C:\Users\jhhea\Documents\CFAC"
```

The script writes:

```text
C:\Users\jhhea\.vscode\CFAC\_private\workbook-formulas.json
```

It records formula strings, cell addresses, formula categories, and cross-sheet references. It does not export cached formula results or ordinary cell values.

## PHI Boundary

These workbook families may contain case-level PHI or client narratives. Their raw detail tabs must not be imported into the live aggregate app until the HIPAA/BAA infrastructure gate is open:

- CARP / Collaborate case exports
- Mental Health
- Residential
- MDT / case review
- Medical or forensic service detail

For now, load their dashboard/summary aggregate tabs and other aggregate/non-PHI rows through the manual upload and SharePoint workbook pipeline.
