# Hoover / MEAD Price Tracker — Version 7

This is Version 7, not Version 5. Extract the `hoover-mead-v7` folder and run `npm install` then `npm start` there.

## Visible changes
- **Daily price map:** single selectable operating day with 25 visible hour-ending cells, full dollar values, per-day color normalization, daily low/high/spread, and date navigation.
- **Seasonal trends:** month-by-year table, rolling 30-complete-day AM and PM averages, PM advantage changes, and weekday/weekend summaries.
- The existing download and database-repair workflow is retained.

## Important limits
- The rolling comparison is based on complete AM/PM days, not necessarily consecutive calendar dates.
- Holidays are not classified separately.
- CAISO DST/HE25 interpretation has not been validated against source intervals.
- This package has not been runtime-tested in Electron; verify on a copy of your database before operational use.
