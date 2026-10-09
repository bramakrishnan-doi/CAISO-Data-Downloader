# Hoover / MEAD Price Tracker — Version 10

New **Opportunity visuals** sidebar tab:

- AM/PM opportunity calendar: month selector, daily AM minus PM maximum price, green AM wins, red PM wins; incomplete days gray.
- Hourly price probability: selectable price thresholds and 7/30/90/365-calendar-day lookbacks; valid-hour denominators and hover counts.
- Peak-hour migration: weekly mean hour of AM and PM maximum, with selectable lookback and hover sample counts.
- Chart panels open in the existing enlarged-chart modal and support SVG export.

All calculations use the existing local database and do not modify stored data. AM window HE07–12, PM HE17–22. Peak-hour ties choose the earliest hour. This build is not live-CAISO or Electron-runtime validated.

Extract folder, run `npm install` and `npm start`. Back up the database before upgrading.
