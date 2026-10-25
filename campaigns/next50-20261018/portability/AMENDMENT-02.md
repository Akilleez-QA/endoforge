# Version 2, frozen before rerun

Pin Wasmtime v49.0.3 entire executable from runtime lane alongside Node/npm/compiler. Replace restore directory publication check/rename with Linux renameat2 RENAME_NOREPLACE to preserve exclusive creation under concurrent callers. Preserve v1 receipts. Version2 bundle and fresh reinstall receive new distinct directories. Tests unchanged; add exact artifact inventory validation and platform versions.
