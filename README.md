# FitPlan

Personal training planner PWA (Spartan 2027 season). All data stays on the device (IndexedDB).

## Deploy (GitHub Pages)
Upload all files to the repo root (keep `js/` and `icons/`). Settings → Pages → Deploy from branch `main` / root.

## Update
Change files, bump `VERSION` in `sw.js`, commit. The app shows "New version available".

## Changelog
- 1.1.0-M2: RunGap FIT import (multi-file, duplicate check), time-in-zone, TRIMP, aerobic marker, auto-matching to planned sessions (incl. warm-up rule), auto status proposal, reassign/delete workouts, weekly actuals.
- 1.0.1-M1: header blur fix; backup share sheet fix; backup banner refresh.
- 1.0.0-M1: plan import, Today / Week / Races, status + notes, backup/restore.
