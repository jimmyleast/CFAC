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

## PHI Boundary

These workbook families may contain case-level PHI or client narratives and must not be imported into the live aggregate app until the HIPAA/BAA infrastructure gate is open:

- CARP / Collaborate case exports
- Mental Health
- Residential
- MDT / case review
- Medical or forensic service detail

For now, use only aggregate/non-PHI tabs or rows through the manual upload and SharePoint workbook pipeline.
