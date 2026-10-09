# Hoover / MEAD Price Tracker — V11

Changes: all-year monthly PM premium calendar, daily drilldown, hourly probability drilldown, weekly migration drilldown, 14-day probability and boxplot options, overview trend cards and date-range selectors, higher-contrast light theme.

Run `npm install` and `npm start` from this directory. Back up your existing database before upgrading.

Data notes: AM peak HE07–12; PM peak HE17–22. Days with any missing AM/PM prices are excluded from comparisons. Calendar cells group the same month/day across all available years and display the arithmetic mean of daily (PM peak − AM peak). These are historical descriptive measures, not price forecasts. The charts retain browser-native SVG hover titles. Fall DST hours are not fully represented by the 24-hour heatmap.
