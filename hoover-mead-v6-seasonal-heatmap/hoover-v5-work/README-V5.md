# Hoover / MEAD Price Tracker — Version 5

## Run
Install Node.js LTS, extract this ZIP, open a terminal in the extracted folder, then run `npm install` and `npm start`. Back up your existing database first. The application will ask for the existing database path if necessary.

## Interface changes
- Overview: daily average price is a bar chart (negative prices are displayed below zero); hover over bars for date and value.
- Price analysis: one Daily Price Opportunities screen, with AM and PM price windows, peak premiums, trends, and a transparent historical weekday reference.
- Peak premium: morning maximum HE07–HE12 minus the average of HE05, HE06, HE13, HE14; evening maximum HE17–HE22 minus the average of HE15, HE16, HE23, HE24. The threshold determines the percentage of days with a distinct peak. Missing shoulder hours are excluded from premium calculations.
- PM advantage over AM: average over comparable days of (highest PM hourly price - highest AM hourly price), in $/MWh. Negative values favor AM. This is not generation revenue.
- All-time maximum and minimum cards show operating date and hour ending.
- Next operating day historical reference: the day following the latest stored operating date. Each hour is averaged independently over up to eight most recent stored days with the same weekday; only available hourly prices are used. It is **not a forecast** and not a substitute for published CAISO day-ahead prices.

## Cautions
The UI changes have not been validated in a full Electron session or against live CAISO data. DST and hour-ending mapping need source-interval verification before operational reliance. AM/PM rankings do not account for turbine constraints, ramping, or water requirements.
