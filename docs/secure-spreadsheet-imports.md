# Secure spreadsheet imports

All untrusted Excel uploads pass through `src/lib/secure-spreadsheet.ts` before business parsing or database writes.

## Parser and supply chain

- SheetJS CE 0.20.3 is vendored at `vendor/xlsx-0.20.3.tgz` from the official SheetJS CDN.
- SHA-256: `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`.
- The parser runs in a worker thread with a 12-second timeout and 192 MB old-generation / 32 MB young-generation limits.
- Formula source, cell comments and hyperlinks are removed before rows leave the worker. Safe HTTP(S) hyperlinks are returned separately only for the inventory import.
- Macros are not loaded (`bookVBA: false`) and formulas are never evaluated.

## Limits

| Limit | Value |
| --- | ---: |
| Compressed upload | 20 MiB |
| Declared ZIP uncompressed size | 80 MiB |
| Single ZIP entry | 32 MiB |
| ZIP entries | 2,048 |
| Sheets | 32 |
| Rows per sheet | 25,000 |
| Columns per sheet | 128 |
| Cells per workbook | 500,000 |
| Cell text | 32,767 characters |
| Parse duration | 12 seconds |

ZIP64, multi-disk, encrypted, corrupt and path-traversal containers are rejected. `.xlsx`/`.xlsm` require ZIP magic bytes and `.xls` requires the OLE compound-file signature. MIME type and extension are checked together.

## Covered upload surfaces

- canonical customer-invoice / receivables import v2;
- legacy financial report staging that is still required for compatibility;
- SmartBill customer and supplier preview;
- location inventory Excel import;
- location inventory JSON import (5 MiB, 1,000 rows, depth/key validation and full prevalidation).

The financial parsers preserve existing header normalization, company detection, scoring, alias resolution, idempotency and transactional confirmation. Preview and parse do not mutate canonical invoices, payments or locations. The inventory Excel import validates the complete workbook before creating an import batch or upserting a location.

## Export safety

CSV, direct SheetJS exports and the internal styled XLSX writer escape text beginning with `=`, `+`, `-` or `@`. Numeric values stay numeric. External links in the styled writer are limited to HTTP(S).

## Logging

The common gateway logs only purpose, result code, duration, compressed size, row/cell counts and container type. It does not log file names, sheet names, cell values, URLs or user data.
