# Hoover / MEAD Price Tracker V6

Changes: daily-normalized price matrix with actual rounded $/MWh labels and daily low/high/spread; seasonal monthly AM/PM peak comparison; weekday vs weekend comparison; month-range filter. Only days with complete HE07-HE12 and HE17-HE22 are included in seasonal comparisons. Holidays are not separately categorized. This version does not yet implement live CAISO forecast verification or interval-level DST validation.

To run: npm install && npm start. Back up your database first. No database schema changes in V6.
