# FitPlan

Personal training planner PWA (Spartan 2027 season). All data stays on the device (IndexedDB).

## Deploy (GitHub Pages)
Upload all files to the repo root (keep `js/` and `icons/`). Settings → Pages → Deploy from branch `main` / root.

## Update
Change files, bump `VERSION` in `sw.js`, commit. The app shows "New version available".

## Working with Copilot
Start each Copilot development session by uploading the latest `fitplan-app-*.zip` (rename to `.zip.txt` if the upload is blocked).

## Changelog
- 1.3.0-M4: Trends tab (4/12/26 weeks): weekly hours by zone vs. planned, run km & D+, TRIMP acute/chronic + ACWR band, aerobic marker (easy pace at Z2 HR), pain / resting HR / sleep, weekly table, 4-week vs. previous 4-week KPIs. Settings moved to ⚙️ in the header. Countdown card links to Races.
- 1.2.0-M3: daily check-in (RPE, sleep, energy, resting HR, pain map, note); Report tab with progress.md / progress.json (fitplan.progress/1.0), copy prompt + report for Copilot, pain flags, ACWR load ratio.
- 1.1.0-M2: RunGap FIT import, time-in-zone, TRIMP, aerobic marker, auto-matching (warm-up rule), auto status, reassign/delete workouts, weekly actuals.
- 1.0.1-M1: header blur fix; backup share sheet fix; backup banner refresh.
- 1.0.0-M1: plan import, Today / Week / Races, status + notes, backup/restore.
