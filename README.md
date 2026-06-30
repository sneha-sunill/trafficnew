# Traffic Count Summary — Automation

A Next.js web app that processes traffic detector count CSV files and generates hourly summaries, phase trend charts, and traffic insights — all in the browser with no backend database required.

## Features

- Drag-and-drop upload of multiple detector count CSV files
- Hourly aggregation of detector (DET), SCOOT volume (VS), and pedestrian (PB) phases
- Per-day line charts showing phase volume trends
- Traffic insights: weekday/weekend phase frequency rankings and AM/LT/PM peak analysis
- Download master hourly data as CSV
- Download traffic insights as Excel (.xlsx)

## Tech Stack

- [Next.js 15](https://nextjs.org/) (App Router)
- [React 19](https://react.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Recharts](https://recharts.org/) for charts
- [PapaParse](https://www.papaparse.com/) for CSV parsing
- [SheetJS (xlsx)](https://sheetjs.com/) for Excel export

## Project Structure

```
├── app/
│   ├── api/process/route.ts   # Server-side CSV processing endpoint
│   ├── layout.tsx
│   ├── page.tsx               # Main UI
│   └── globals.css
└── lib/
    └── processor.ts           # Core data processing logic
```

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploying to Vercel

1. Push this repository to GitHub.
2. Go to [vercel.com](https://vercel.com) and import the repository.
3. Leave all build settings as default — Vercel auto-detects Next.js at the root.
4. Click **Deploy**.

No environment variables are required.


## CSV File Format

Input files must be comma-separated with at minimum a `StartTime` column (Unix timestamp in seconds, UTC) and phase columns following these naming conventions:

| Prefix | Description |
|--------|-------------|
| `DET*` | Detector counts per phase (last character = phase letter) |
| `VS*`  | SCOOT volume per phase |
| `PB*`  | Pedestrian phase counts |

The app groups columns by phase letter, sums detectors per hour, and computes the highest-volume phase for each hour slot.

## Notes

- Timestamps are interpreted in Dubai time (UTC+4).
- Friday and Saturday are treated as weekend days; Monday–Thursday as weekdays.
- "DNF" (Did Not Fire) is shown when all detectors in a phase reported null/missing for that hour.
