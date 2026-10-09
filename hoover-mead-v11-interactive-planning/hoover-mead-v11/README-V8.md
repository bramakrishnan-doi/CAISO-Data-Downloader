# Hoover / MEAD Price Tracker V8

New: daily price map shows HE01–HE24 in two rows of 12, red low to green high, with numeric values. HE25 remains in storage/history for DST inspection but is hidden from the daily map. Fall DST may have 25 actual hours; do not assume 24 on transition days.

Seasonal Trends now includes month-by-year AM/PM line charts, holiday classification (actual vs observed federal holidays), and rolling 7-/30-complete-day AM/PM charts and change indicators. Only days with complete HE07–12 and HE17–22 are included. Holiday classification covers federal holidays; local and market-specific holidays may differ. The charts use stored data, not forecasts.

Run: npm install && npm start. Back up the database before upgrading. Full Electron and live CAISO integration tests have not been performed.
