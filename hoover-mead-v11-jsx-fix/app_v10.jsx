const { useState, useEffect, useMemo, useCallback, useRef, Fragment } = React;

const HE_COLS = Array.from({length: 25}, (_, i) => 'HE' + String(i+1).padStart(2,'0'));
const ONPEAK = new Set([7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22]);
const NODE_ID = 'MEADS_2_N101';
const FETCH_COOLDOWN_MS = 10000;

function computeStats(hours) {
  const vals = HE_COLS.map(h => hours[h]).filter(v => v !== null && v !== undefined && !isNaN(v));
  if (vals.length === 0) return null;
  const avg = vals.reduce((a,b)=>a+b,0) / vals.length;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const onpeak = [], offpeak = [];
  HE_COLS.forEach(h => {
    const he = parseInt(h.slice(2));
    const v = hours[h];
    if (v === null || v === undefined || isNaN(v)) return;
    if (ONPEAK.has(he)) onpeak.push(v); else offpeak.push(v);
  });
  const onAvg = onpeak.length ? onpeak.reduce((a,b)=>a+b,0)/onpeak.length : null;
  const offAvg = offpeak.length ? offpeak.reduce((a,b)=>a+b,0)/offpeak.length : null;
  const variance = vals.reduce((a,b)=>a+Math.pow(b-avg,2),0) / vals.length;
  const std = Math.sqrt(variance);
  const peakHour = HE_COLS.find(h => hours[h] === max);
  const spread = (onAvg !== null && offAvg !== null) ? (onAvg - offAvg) : null;
  return { avg, min, max, onAvg, offAvg, spread, std, peakHour };
}

function validPrice(v) { return typeof v === 'number' && Number.isFinite(v); }
function dayAudit(records) {
  if (!records.length) return {missingDays:[], incomplete:[], checked:0};
  const byKey = new Map(records.map(r => [r.key,r]));
  const keys = [...byKey.keys()].sort();
  const missingDays = [], incomplete = [];
  let day = new Date(keys[0]+'T12:00:00Z');
  const end = new Date(keys[keys.length-1]+'T12:00:00Z');
  let checked = 0;
  while (day <= end && checked < 200000) {
    const key = day.toISOString().slice(0,10);
    const record = byKey.get(key);
    if (!record) missingDays.push(key);
    else {
      const hours = HE_COLS.filter(h => !validPrice(record.hours[h]));
      // HE25 is normally absent; DST-specific validity requires source interval metadata.
      const required = hours.filter(h => h !== 'HE25');
      if (required.length) incomplete.push({key, hours:required});
    }
    day.setUTCDate(day.getUTCDate()+1); checked++;
  }
  return {missingDays,incomplete,checked};
}
function peakAnalysis(records, limit) {
  const days = [...records].sort((a,b)=>b.key.localeCompare(a.key)).slice(0,limit);
  const avg = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;
  const amHours = [7,8,9,10,11,12], pmHours = [17,18,19,20,21,22];
  const entries = days.map(r => {
    const peak = hs => hs.map(h=>({h,v:r.hours['HE'+String(h).padStart(2,'0')]})).filter(x=>validPrice(x.v)).sort((a,b)=>b.v-a.v)[0];
    return {key:r.key,am:peak(amHours),pm:peak(pmHours)};
  }).filter(x=>x.am && x.pm);
  const amAvg = avg(entries.map(x=>x.am.v)), pmAvg = avg(entries.map(x=>x.pm.v));
  const amWins = entries.filter(x=>x.am.v>x.pm.v).length;
  const amCounts = {},pmCounts={};
  entries.forEach(x=>{amCounts[x.am.h]=(amCounts[x.am.h]||0)+1;pmCounts[x.pm.h]=(pmCounts[x.pm.h]||0)+1;});
  const top = counts => Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([h,n])=>'HE'+String(h).padStart(2,'0')+' ('+Math.round(100*n/entries.length)+'%)').join(', ');
  return {entries,amAvg,pmAvg,amWins,amTop:top(amCounts),pmTop:top(pmCounts)};
}
// US federal holidays: actual date and weekday-observed date are separate categories.
function holidayLabel(date) {
  const y=Number(date.slice(0,4));
  function iso(d){return d.toISOString().slice(0,10)}
  function fixed(m,d){return new Date(Date.UTC(y,m-1,d))}
  function nth(m,weekday,n){const first=new Date(Date.UTC(y,m-1,1));return new Date(Date.UTC(y,m-1,1+(weekday-first.getUTCDay()+7)%7+7*(n-1)))}
  function last(m,weekday){const end=new Date(Date.UTC(y,m,0));return new Date(Date.UTC(y,m-1,end.getUTCDate()-(end.getUTCDay()-weekday+7)%7))}
  const actual=[['New Year',fixed(1,1)],['MLK Day',nth(1,1,3)],['Washington Birthday',nth(2,1,3)],['Memorial Day',last(5,1)],['Juneteenth',fixed(6,19)],['Independence Day',fixed(7,4)],['Labor Day',nth(9,1,1)],['Columbus Day',nth(10,1,2)],['Veterans Day',fixed(11,11)],['Thanksgiving',nth(11,4,4)],['Christmas',fixed(12,25)]];
  // Adjacent-year New Year's observance can fall on December 31.
  actual.push(['New Year',new Date(Date.UTC(y+1,0,1))]);
  for(const [name,d] of actual){if(iso(d)===date)return {name,kind:'actual'};}
  for(const [name,d] of actual){if([0,6].includes(d.getUTCDay())){const observed=new Date(d.getTime()+(d.getUTCDay()===6?-1:1)*86400000);if(iso(observed)===date)return {name,kind:'observed'};}}
  return null;
}
function completePeakRows(records) {
  return records.filter(r=>[...Array(6)].every((_,i)=>validPrice(r.hours['HE'+String(i+7).padStart(2,'0')])&&validPrice(r.hours['HE'+String(i+17).padStart(2,'0')]))).map(r=>{
    const am=Math.max(...Array.from({length:6},(_,i)=>r.hours['HE'+String(i+7).padStart(2,'0')]));
    const pm=Math.max(...Array.from({length:6},(_,i)=>r.hours['HE'+String(i+17).padStart(2,'0')]));
    return {date:r.key,am,pm,diff:pm-am};
  }).sort((a,b)=>a.date.localeCompare(b.date));
}
function holidayAnalysis(records, monthsBack){
  const all=completePeakRows(records), latest=all.length?all[all.length-1].date:'';
  const cutoff=latest?new Date(Date.UTC(Number(latest.slice(0,4)),Number(latest.slice(5,7))-1-monthsBack,1)).toISOString().slice(0,10):'';
  const groups={weekday:[],weekend:[],actual:[],observed:[]};const holidayDays=[];
  all.filter(r=>r.date>=cutoff).forEach(r=>{
    const h=holidayLabel(r.date),dow=new Date(r.date+'T12:00:00Z').getUTCDay();
    if(h){groups[h.kind].push(r);holidayDays.push({...r,name:h.name,kind:h.kind});}
    else groups[dow===0||dow===6?'weekend':'weekday'].push(r);
  });
  const summary=arr=>({days:arr.length,am:average(arr.map(x=>x.am)),pm:average(arr.map(x=>x.pm)),diff:average(arr.map(x=>x.diff))});
  return {groups:Object.keys(groups).map(key=>({key,...summary(groups[key])})),holidayDays:holidayDays.reverse()};
}
function rollingAnalysis(records,windowSize){
  const rows=completePeakRows(records);
  const points=rows.map((r,i)=>{
    if(i+1<windowSize)return null;
    const a=rows.slice(i+1-windowSize,i+1);
    return {date:r.date,am:average(a.map(x=>x.am)),pm:average(a.map(x=>x.pm)),diff:average(a.map(x=>x.diff))};
  }).filter(Boolean);
  const recent=rows.slice(-windowSize),prior=rows.slice(-2*windowSize,-windowSize);
  const change=recent.length===windowSize&&prior.length===windowSize?['am','pm','diff'].map(k=>{
    const current=average(recent.map(r=>r[k])),previous=average(prior.map(r=>r[k]));
    return {key:k,current,previous,delta:current-previous,pct:previous!==0?100*(current-previous)/Math.abs(previous):null};
  }):[];
  return {points,change};
}
function yearMonthSeries(records){
  const by=new Map();completePeakRows(records).forEach(r=>{
    const key=r.date.slice(0,7),a=by.get(key)||[];a.push(r);by.set(key,a);
  });
  return [...by].map(([key,a])=>({year:Number(key.slice(0,4)),month:Number(key.slice(5,7)),days:a.length,am:average(a.map(r=>r.am)),pm:average(a.map(r=>r.pm)),diff:average(a.map(r=>r.pm-r.am))}));
}
function seasonalSummary(records, monthsBack) {
  const sorted=[...records].sort((a,b)=>b.key.localeCompare(a.key));
  const latest=sorted.length?sorted[0].key.slice(0,7):'';
  const monthKeys=[];
  if(latest){const [y,m]=latest.split('-').map(Number);for(let i=monthsBack-1;i>=0;i--){const d=new Date(Date.UTC(y,m-1-i,1));monthKeys.push(d.toISOString().slice(0,7));}}
  const periods={weekday:[],weekend:[],holiday:[]};
  const monthly=monthKeys.map(month=>{
    const rows=sorted.filter(r=>r.key.slice(0,7)===month);
    const complete=rows.filter(r=>[...Array.from({length:6},(_,i)=>i+7),...Array.from({length:6},(_,i)=>i+17)].every(h=>validPrice(r.hours['HE'+String(h).padStart(2,'0')])));
    const pairs=complete.map(r=>{
      const am=Math.max(...Array.from({length:6},(_,i)=>r.hours['HE'+String(i+7).padStart(2,'0')]));
      const pm=Math.max(...Array.from({length:6},(_,i)=>r.hours['HE'+String(i+17).padStart(2,'0')]));
      const weekday=new Date(r.key+'T12:00:00Z').getUTCDay();
      const type=weekday===0||weekday===6?'weekend':'weekday';
      const entry={am,pm,diff:pm-am,date:r.key};periods[type].push(entry);
      return entry;
    });
    return {month,days:pairs.length,am:average(pairs.map(x=>x.am)),pm:average(pairs.map(x=>x.pm)),diff:average(pairs.map(x=>x.diff)),amWins:pairs.filter(x=>x.am>x.pm).length};
  });
  const summarize=a=>({days:a.length,am:average(a.map(x=>x.am)),pm:average(a.map(x=>x.pm)),diff:average(a.map(x=>x.diff)),amWins:a.filter(x=>x.am>x.pm).length});
  return {monthly,weekday:summarize(periods.weekday),weekend:summarize(periods.weekend)};
}
function trendInsights(records, monthsBack) {
  const complete = records.filter(r => [...Array(6)].every((_,i)=>validPrice(r.hours['HE'+String(i+7).padStart(2,'0')]) && validPrice(r.hours['HE'+String(i+17).padStart(2,'0')]))).sort((a,b)=>a.key.localeCompare(b.key));
  const rows=complete.map(r=>{
    const am=Math.max(...Array.from({length:6},(_,i)=>r.hours['HE'+String(i+7).padStart(2,'0')]));
    const pm=Math.max(...Array.from({length:6},(_,i)=>r.hours['HE'+String(i+17).padStart(2,'0')]));
    return {date:r.key,am,pm,diff:pm-am};
  });
  const rolling=rows.slice(-120).map((r,i,a)=>{
    const window=a.slice(Math.max(0,i-29),i+1);
    if(window.length<7)return null;
    return {date:r.date,days:window.length,am:average(window.map(x=>x.am)),pm:average(window.map(x=>x.pm)),diff:average(window.map(x=>x.diff))};
  }).filter(Boolean);
  const yearly=new Map();
  rows.forEach(r=>{
    const key=r.date.slice(0,7), a=yearly.get(key)||[];a.push(r);yearly.set(key,a);
  });
  const months=[...yearly.entries()].sort((a,b)=>b[0].localeCompare(a[0])).slice(0,Math.max(12,monthsBack)).map(([month,a])=>({month,days:a.length,am:average(a.map(x=>x.am)),pm:average(a.map(x=>x.pm)),diff:average(a.map(x=>x.diff)),amWins:a.filter(x=>x.am>x.pm).length}));
  const last=rows.slice(-30), prior=rows.slice(-60,-30);
  return {rolling,months,change:prior.length>=7&&last.length>=7?{am:average(last.map(x=>x.am))-average(prior.map(x=>x.am)),pm:average(last.map(x=>x.pm))-average(prior.map(x=>x.pm)),diff:average(last.map(x=>x.diff))-average(prior.map(x=>x.diff)),recent:last.length,previous:prior.length}:null};
}
function tomorrowOutlook(records) {
  if (!records.length) return null;
  const latest = [...records].sort((a,b)=>b.key.localeCompare(a.key))[0];
  const tomorrow = addDaysToIso(latest.key,1);
  const weekday = new Date(tomorrow+'T12:00:00Z').getUTCDay();
  const matching = records.filter(r=>new Date(r.key+'T12:00:00Z').getUTCDay()===weekday && r.key<=latest.key).sort((a,b)=>b.key.localeCompare(a.key)).slice(0,8);
  const prices = HE_COLS.slice(0,24).map(h=>{
    const values = matching.map(r=>r.hours[h]).filter(validPrice);
    return {hour:h,price:values.length ? values.reduce((a,b)=>a+b,0)/values.length:null,count:values.length};
  });
  return {tomorrow,matching:matching.length,prices};
}

function average(xs) { return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null; }
const MONTH_ABBR=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ---- Reusable period selection: {mode:'all'} | {mode:'year',year} | {mode:'range',start,end} | {mode:'month',month} ----
function filterByPeriod(records, period) {
  if (!period || period.mode === 'all') return records;
  if (period.mode === 'year') return records.filter(r => r.key.slice(0,4) === String(period.year));
  if (period.mode === 'range') return records.filter(r => (!period.start||r.key>=period.start) && (!period.end||r.key<=period.end));
  if (period.mode === 'month') return records.filter(r => Number(r.key.slice(5,7)) === period.month);
  return records;
}
function periodLabel(period) {
  if (!period || period.mode === 'all') return 'All available data';
  if (period.mode === 'year') return String(period.year);
  if (period.mode === 'range') return (period.start||'…')+' to '+(period.end||'…');
  if (period.mode === 'month') return MONTH_ABBR[period.month-1]+' (all years)';
  return '';
}
function PeriodPicker({records, period, onChange}) {
  const years = useMemo(()=>[...new Set(records.map(r=>r.key.slice(0,4)))].sort((a,b)=>b-a), [records]);
  const mode = period ? period.mode : 'all';
  return <div className="row">
    <label>View <select value={mode} onChange={e=>{
      const m=e.target.value;
      if(m==='all') onChange({mode:'all'});
      else if(m==='year') onChange({mode:'year', year:Number(years[0]||new Date().getFullYear())});
      else if(m==='month') onChange({mode:'month', month:1});
      else if(m==='range') onChange({mode:'range', start:records.length?records[0].key:'', end:records.length?records[records.length-1].key:''});
    }}>
      <option value="all">All data</option>
      <option value="year">Specific year</option>
      <option value="month">Specific month (all years)</option>
      <option value="range">Custom date range</option>
    </select></label>
    {mode==='year' && <label>Year <select value={period.year} onChange={e=>onChange({mode:'year', year:Number(e.target.value)})}>{years.map(y=><option key={y} value={y}>{y}</option>)}</select></label>}
    {mode==='month' && <label>Month <select value={period.month} onChange={e=>onChange({mode:'month', month:Number(e.target.value)})}>{MONTH_ABBR.map((m,i)=><option key={i} value={i+1}>{m}</option>)}</select></label>}
    {mode==='range' && <>
      <label>From <input type="date" value={period.start} onChange={e=>onChange({...period, start:e.target.value})}/></label>
      <label>To <input type="date" value={period.end} onChange={e=>onChange({...period, end:e.target.value})}/></label>
    </>}
  </div>;
}

function opportunity(records, count, premium) {
  const days=[...records].sort((a,b)=>b.key.localeCompare(a.key)).slice(0,count);
  const hours=(r,from,to)=>Array.from({length:to-from+1},(_,i)=>({he:from+i,price:r.hours['HE'+String(from+i).padStart(2,'0')]}));
  const complete=days.filter(r=>hours(r,7,12).concat(hours(r,17,22)).every(x=>validPrice(x.price)));
  const entries=complete.map(r=>{
    const am=hours(r,7,12),pm=hours(r,17,22);
    const best=arr=>arr.reduce((a,b)=>a.price>=b.price?a:b);
    const a=best(am),b=best(pm);
    const amShoulders=[r.hours.HE05,r.hours.HE06,r.hours.HE13,r.hours.HE14];
    const pmShoulders=[r.hours.HE15,r.hours.HE16,r.hours.HE23,r.hours.HE24];
    const amBase=amShoulders.every(validPrice)?average(amShoulders):null;
    const pmBase=pmShoulders.every(validPrice)?average(pmShoulders):null;
    return {key:r.key,am:a,pm:b,amPremium:amBase===null?null:a.price-amBase,pmPremium:pmBase===null?null:b.price-pmBase,spread:a.price-b.price};
  });
  const amPeaks=entries.filter(x=>x.amPremium!==null&&x.amPremium>=premium);
  const pmPeaks=entries.filter(x=>x.pmPremium!==null&&x.pmPremium>=premium);
  const recent=entries.slice(0,Math.min(7,entries.length));
  const prior=entries.slice(7,Math.min(21,entries.length));
  const hourly=(from,to)=>Array.from({length:to-from+1},(_,i)=>{
    const he=from+i,key='HE'+String(he).padStart(2,'0');
    const vals=complete.map(r=>r.hours[key]);
    return {he:key,mean:average(vals),count:vals.length};
  }).sort((a,b)=>b.mean-a.mean);
  return {entries,amPeaks,pmPeaks,avgAmPremium:average(entries.map(x=>x.amPremium).filter(validPrice)),avgPmPremium:average(entries.map(x=>x.pmPremium).filter(validPrice)),amHours:hourly(7,12),pmHours:hourly(17,22),recentAM:average(recent.map(x=>x.am.price)),priorAM:average(prior.map(x=>x.am.price)),recentPM:average(recent.map(x=>x.pm.price)),priorPM:average(prior.map(x=>x.pm.price)),amWins:entries.filter(x=>x.spread>0).length,avgSpread:average(entries.map(x=>x.spread)),premium};
}
function bestWindows(prices, n, start, end) {
  const values=prices.filter(x=>x.he>=start&&x.he<=end&&validPrice(x.price));
  const chosen=[...values].sort((a,b)=>b.price-a.price).slice(0,n).sort((a,b)=>a.he-b.he);
  return {chosen,mean:average(chosen.map(x=>x.price)),total:chosen.reduce((a,b)=>a+b.price,0)};
}
function releaseComparison(prices, n, mwh) {
  const am=bestWindows(prices,n,7,12),pm=bestWindows(prices,n,17,22);
  const all=bestWindows(prices,n,1,24);
  const energy=Number(mwh);
  return {am,pm,all,amRevenue:am.mean===null?null:am.mean*energy,pmRevenue:pm.mean===null?null:pm.mean*energy,allRevenue:all.mean===null?null:all.mean*energy};
}
function money(v) {return v===null||!Number.isFinite(v)?'—':v.toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:0});}
function trendText(recent,prior) {return recent===null||prior===null?'Not enough comparable days':(recent-prior>=0?'+':'')+(recent-prior).toFixed(2)+' $/MWh vs preceding period';}
function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  let headerIdx = -1, dataIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('"Component"')) { headerIdx = i; dataIdx = i+1; break; }
  }
  if (headerIdx === -1) throw new Error('Could not find header row (expected "Component")');
  const headers = lines[headerIdx].split(',').map(h => h.replace(/^"|"$/g,'').trim());
  const dateColIdx = headers.indexOf('Date');
  if (dateColIdx === -1) throw new Error('No Date column found');

  const records = [];
  for (let i = dataIdx; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.startsWith('"LMP"')) continue;
    const cells = line.split(',').map(c => c.replace(/^"|"$/g,'').trim());
    const date = cells[dateColIdx];
    if (!date) continue;
    const hours = {};
    headers.forEach((h, idx) => {
      if (HE_COLS.includes(h)) {
        const v = cells[idx];
        hours[h] = (v === '' || v === undefined) ? null : parseFloat(v);
      }
    });
    records.push({ date, hours });
  }
  if (records.length === 0) throw new Error('No LMP rows found');
  return records;
}

function dateKey(d) {
  const parts = d.split('/');
  const m = parts[0], dd = parts[1], y = parts[2];
  return y + '-' + m.padStart(2,'0') + '-' + dd.padStart(2,'0');
}

function heatColor(v, min, max) {
  if (!validPrice(v)) return '#343d49';
  const t = max > min ? (v-min)/(max-min) : 0.5;
  const stops = [[205,65,65],[238,187,73],[49,165,100]];
  const segment = t < 0.5 ? 0 : 1;
  const f = t < 0.5 ? t*2 : (t-0.5)*2;
  const a=stops[segment],b=stops[segment+1];
  return 'rgb('+a.map((v,i)=>Math.round(v+(b[i]-v)*f)).join(',')+')';
}

function formatPrice(v) {
  if (v === null || v === undefined || isNaN(v)) return 'N/A';
  return '$' + v.toFixed(2);
}

function addDaysToIso(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
}

// Shared Plotly wrapper: handles missing-library fallback, theme colors, and resize once for every chart.
function PlotlyChart({traces, layout, config, onPointClick, fallback, height, style}) {
  const ref = useRef(null);
  const [missing, setMissing] = useState(typeof window.Plotly === 'undefined');
  const clickHandler = useRef(onPointClick);
  clickHandler.current = onPointClick;
  useEffect(() => {
    if (typeof window.Plotly === 'undefined') { setMissing(true); return; }
    if (!ref.current) return;
    const isLight = document.querySelector('.theme-light') !== null;
    const fg = isLight ? '#182b3c' : '#eaf3f7';
    const grid = isLight ? '#dce4ed' : '#34404e';
    const mergedLayout = {
      autosize: true,
      height: height || 360,
      margin: {l:56,r:16,t:10,b:44},
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: {color: fg, size: 12},
      hovermode: 'closest',
      hoverlabel: {bgcolor: isLight?'#172c3b':'#1c2430', bordercolor: isLight?'#dce4ed':'#3a4556', font:{color: isLight?'#f8fafc':'#eaf3f7', size:12}},
      ...layout,
      xaxis: {gridcolor: grid, zeroline:false, ...(layout&&layout.xaxis)},
      yaxis: {gridcolor: grid, zeroline:false, ...(layout&&layout.yaxis)}
    };
    const mergedConfig = {responsive:true, displaylogo:false, modeBarButtonsToRemove:['lasso2d','select2d'], scrollZoom:true, ...config};
    let failed = false;
    try {
      window.Plotly.react(ref.current, traces, mergedLayout, mergedConfig);
    } catch (e) {
      console.error('Plotly render failed:', e);
      failed = true;
      setMissing(true);
    }
    if (!failed && clickHandler.current) {
      const handler = (evt) => {
        const p = evt.points && evt.points[0];
        if (!p) return;
        clickHandler.current(p.customdata !== undefined ? p.customdata : {x:p.x,y:p.y,curveNumber:p.curveNumber,pointIndex:p.pointIndex});
      };
      ref.current.on('plotly_click', handler);
      return () => { try { ref.current && ref.current.removeAllListeners && ref.current.removeAllListeners('plotly_click'); } catch(e){} };
    }
  }, [traces, layout, config, height]);
  if (missing) return fallback || <p className="insight-note">Interactive charting library failed to load (likely no internet access, or a local file issue). Static fallback not available for this chart.</p>;
  return <div ref={ref} style={{width:'100%', ...style}}/>;
}

function SimplePriceDurationChart({curves}) {
  const width=880,height=320,pad={l:56,r:16,t:14,b:32};
  const all=curves.flatMap(c=>c.points.map(p=>p.price)).filter(validPrice);
  if(!all.length) return null;
  let lo=Math.min(0,...all), hi=Math.max(...all);
  const x=v=>pad.l+(width-pad.l-pad.r)*v/100;
  const y=v=>height-pad.b-(v-lo)/(hi-lo||1)*(height-pad.t-pad.b);
  return <><div className="chart-legend">{curves.map(c=><span key={c.name} style={{color:c.color}}>● {c.name}</span>)}</div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Price duration curves" style={{width:'100%',height:'auto'}}>
      {[0,0.25,0.5,0.75,1].map(t=>{const v=lo+(hi-lo)*t;return <g key={t}><line x1={pad.l} y1={y(v)} x2={width-pad.r} y2={y(v)} stroke="#34404e"/><text x="3" y={y(v)+4} fill="#b6c4d0">${v.toFixed(0)}</text></g>})}
      {[0,25,50,75,100].map(p=><text key={p} x={x(p)} y={height-10} textAnchor="middle" fill="#b6c4d0" fontSize="11">{p}%</text>)}
      {curves.map(c=><polyline key={c.name} fill="none" stroke={c.color} strokeWidth="2.5" points={c.points.map(p=>`${x(p.pctHours)},${y(p.price)}`).join(' ')}/>)}
      <text x={width/2} y={height-2} textAnchor="middle" fill="#8199a9" fontSize="11">% of hours price was at or above this level</text>
    </svg></>;
}

function PriceDurationChart({curves}) {
  const all=curves.flatMap(c=>c.points.map(p=>p.price)).filter(validPrice);
  if (!all.length) return <p className="insight-note">Not enough price history for a duration curve.</p>;
  const traces = curves.map(c => ({
    type:'scatter', mode:'lines', x: c.points.map(p=>p.pctHours), y: c.points.map(p=>p.price),
    name: c.name, line: {color: c.color, width: 2.5},
    hovertemplate: '%{x:.1f}% of hours ≥ $%{y:.2f}<extra>'+c.name+'</extra>'
  }));
  const layout = {
    height: 420,
    xaxis: {title:'% of hours at or above this price', rangeslider:{visible:true, thickness:0.08}},
    yaxis: {title:'$/MWh'},
    legend: {orientation:'h', y:1.12}
  };
  return <div className="chart-panel">
    <strong>Price-duration curves</strong>
    <PlotlyChart traces={traces} layout={layout} height={420} fallback={
      <div className="msg warn" style={{marginTop:10}}>Interactive charting library failed to load. Showing a static fallback instead.<SimplePriceDurationChart curves={curves}/></div>
    }/>
    <p className="insight-note">Each curve sorts that season's hourly prices from highest to lowest. Scroll or pinch to zoom, drag to pan, use the range slider below the axis, or double-click to reset. A steep left edge means extreme prices occur but rarely; a flat curve means prices stay consistently close to average.</p>
  </div>;
}

function DailyBarChart({days}) {
  const vals=days.map(r=>{const st=computeStats(r.hours);return st?st.avg:null;});
  const points=days.map((r,i)=>({date:r.key,value:vals[i]})).filter(p=>validPrice(p.value));
  if(!points.length)return <div className="empty">No daily averages available</div>;
  const traces=[{
    type:'bar', x:points.map(p=>p.date), y:points.map(p=>p.value),
    marker:{color:points.map(p=>p.value>=0?'#35c4ae':'#ed8b7c')},
    hovertemplate:'%{x}<br>$%{y:.2f}/MWh<extra></extra>'
  }];
  const layout={height:300, yaxis:{title:'$/MWh'}, xaxis:{tickangle:-35}};
  return <PlotlyChart traces={traces} layout={layout} height={300}/>;
}

function HourlyBoxPlot({records,days,month,label}){
 const included = month!==undefined ? records.filter(r=>Number(r.key.slice(5,7))===month+1) : (()=>{const sorted=[...records].sort((a,b)=>b.key.localeCompare(a.key));const cutoff=sorted.length?addDaysToIso(sorted[0].key,-days+1):'';return sorted.filter(r=>r.key>=cutoff);})();
 const hourData=HE_COLS.slice(0,24).map((h,i)=>({h,i,vals:included.map(r=>r.hours[h]).filter(validPrice)})).filter(d=>d.vals.length);
 if(!hourData.length)return <p>No hourly data in this period.</p>;
 const traces=hourData.map(d=>({
   type:'box', name:String(d.i+1), y:d.vals, x: d.vals.map(()=>String(d.i+1)),
   marker:{color:'#3b82b6'}, line:{color:'#64748b'}, boxmean:false,
   hovertemplate:'HE'+String(d.i+1).padStart(2,'0')+'<br>$%{y:.2f}<extra></extra>'
 }));
 const layout={height:340, showlegend:false, xaxis:{title:'Hour ending', type:'category', categoryorder:'array', categoryarray:hourData.map(d=>String(d.i+1))}, yaxis:{title:'$/MWh'}};
 return <div className="chart-panel"><strong>{label||('Hourly price box plots ('+included.length+' stored days)')}</strong><PlotlyChart traces={traces} layout={layout} height={340}/><p className="insight-note">Box = 25th–75th percentile, line = median, whiskers = min/max, dots beyond whiskers are outliers. Hover for exact values. Zoom and pan are enabled.</p></div>
}

// V10: only complete AM/PM days enter the opportunity calendar and migration statistics.
function opportunityRows(records){
  return records.map(r=>{
    const best=(first,last)=>{const vals=[];for(let h=first;h<=last;h++){const v=r.hours['HE'+String(h).padStart(2,'0')];if(!validPrice(v))return null;vals.push({hour:h,price:v});}return vals.reduce((a,b)=>b.price>a.price?b:a);};
    const am=best(7,12),pm=best(17,22);
    return am&&pm?{date:r.key,am,pm,advantage:am.price-pm.price}:null;
  }).filter(Boolean).sort((a,b)=>a.date.localeCompare(b.date));
}
function OpportunityCalendar({rows,month,onDay}){
  const filtered=rows.filter(r=>Number(r.date.slice(5,7))===month+1);
  const cells=Array.from({length:new Date(Date.UTC(2024,month+1,0)).getUTCDate()},(_,i)=>{const day=i+1,rs=filtered.filter(r=>Number(r.date.slice(8,10))===day);return {day,n:rs.length,am:average(rs.map(r=>r.am.price)),pm:average(rs.map(r=>r.pm.price)),premium:average(rs.map(r=>r.pm.price-r.am.price)),pmWins:rs.filter(r=>r.pm.price>r.am.price).length,rs};});
  return <div className="op-calendar"><p className="insight-note">Each cell represents the same calendar day across every stored year (for example, July 15 across 2023–2026). Values are averages of daily PM peak minus AM peak; green indicates an evening premium. Click a day to see its underlying observations.</p><div className="month-day-grid">{cells.map(c=><button key={c.day} className={'month-day '+(!c.n?'no-data':c.premium>=0?'pm-win':'am-win')} onClick={()=>onDay(c)} title={c.n?`Day ${c.day}: PM premium ${formatPrice(c.premium)}; AM ${formatPrice(c.am)}; PM ${formatPrice(c.pm)}; ${c.n} observations`:'No complete observations'}><b>{c.day}</b><strong>{c.n?formatPrice(c.premium):'—'}</strong><small>{c.n?`${c.pmWins}/${c.n} PM wins`:'No data'}</small></button>)}</div></div>;
}
function HourDetail({records,hour,threshold,onClose}){
 const he='HE'+String(hour).padStart(2,'0'),rows=[...records].filter(r=>validPrice(r.hours[he])).sort((a,b)=>b.key.localeCompare(a.key));
 const recent=rows.slice(0,30),mean=average(recent.map(r=>r.hours[he])),wins=recent.filter(r=>r.hours[he]>threshold).length;
 return <div className="card focus-detail"><div className="panel-heading"><h3>{he} · Hourly release-planning detail</h3><button onClick={onClose}>Close</button></div><div className="metric-pills"><span>30-observation average: <b>{formatPrice(mean)}</b></span><span>Above ${threshold}: <b>{recent.length?Math.round(wins/recent.length*100):0}%</b></span><span>Valid observations: <b>{recent.length}</b></span></div><p className="insight-note">Historical pricing opportunity only; compare against other hours and facility operating constraints. No generation volume assumed.</p><div className="detail-table"><table><thead><tr><th>Operating date</th><th>{he} price</th></tr></thead><tbody>{recent.slice(0,20).map(r=><tr key={r.key}><td>{r.key}</td><td>{formatPrice(r.hours[he])}</td></tr>)}</tbody></table></div></div>;
}
function ProbabilityChart({records,threshold,days,onHour}){
  const latest=[...records].sort((a,b)=>b.key.localeCompare(a.key))[0];const cutoff=latest?addDaysToIso(latest.key,-days+1):'';
  const selected=records.filter(r=>r.key>=cutoff);
  const stats=Array.from({length:24},(_,i)=>{const hour='HE'+String(i+1).padStart(2,'0');const prices=selected.map(r=>r.hours[hour]).filter(validPrice);const above=prices.filter(v=>v>threshold).length;return {hour,i:i+1,n:prices.length,above,pct:prices.length?above/prices.length*100:null};});
  const traces=[{
    type:'bar', x:stats.map(s=>s.i), y:stats.map(s=>s.pct||0),
    marker:{color:'#158c78'}, customdata:stats.map(s=>s.i),
    hovertemplate:'HE%{x}<br>%{y:.1f}%% above $'+threshold+'<extra></extra>'
  }];
  const layout={height:360, yaxis:{title:'% of days above threshold', range:[0,100]}, xaxis:{title:'Hour ending', dtick:1}};
  return <div className="chart-panel"><strong>Hourly probability of exceeding ${threshold}/MWh</strong><PlotlyChart traces={traces} layout={layout} height={360} onPointClick={(hourIdx)=>onHour(hourIdx)}/><p className="insight-note">Denominator is the number of stored days with a valid price for that hour in the selected calendar window ({selected.length} stored days). Strictly greater than threshold; missing hours excluded. Click a bar for hourly detail.</p></div>;
}
function MigrationChart({rows,windowDays,onWeek}){
  const latest=rows.length?rows[rows.length-1].date:'';const cutoff=latest?addDaysToIso(latest,-windowDays+1):'';
  const selected=rows.filter(r=>r.date>=cutoff);
  const weekly=new Map();selected.forEach(r=>{const d=new Date(r.date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-d.getUTCDay());const k=d.toISOString().slice(0,10);if(!weekly.has(k))weekly.set(k,[]);weekly.get(k).push(r);});
  const median=arr=>{const s=[...arr].sort((a,b)=>a-b);const n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
  const points=[...weekly].sort((a,b)=>a[0].localeCompare(b[0])).map(([week,rs])=>{
    const amHours=rs.map(r=>r.am.hour), pmHours=rs.map(r=>r.pm.hour);
    return {week,n:rs.length,amMedian:median(amHours),amMin:Math.min(...amHours),amMax:Math.max(...amHours),pmMedian:median(pmHours),pmMin:Math.min(...pmHours),pmMax:Math.max(...pmHours)};
  });
  const weeks=points.map(p=>p.week);
  const traces=[
    {type:'scatter', mode:'lines', x:weeks, y:points.map(p=>p.amMin), line:{width:0}, showlegend:false, hoverinfo:'skip'},
    {type:'scatter', mode:'lines', x:weeks, y:points.map(p=>p.amMax), line:{width:0}, fill:'tonexty', fillcolor:'rgba(20,121,189,0.15)', showlegend:false, hoverinfo:'skip'},
    {type:'scatter', mode:'lines+markers', name:'AM median (HE07–12)', x:weeks, y:points.map(p=>p.amMedian), line:{color:'#1479bd',width:3}, customdata:points.map(p=>p.week), hovertemplate:'Week of %{x}<br>AM median peak HE%{y}<extra></extra>'},
    {type:'scatter', mode:'lines', x:weeks, y:points.map(p=>p.pmMin), line:{width:0}, showlegend:false, hoverinfo:'skip'},
    {type:'scatter', mode:'lines', x:weeks, y:points.map(p=>p.pmMax), line:{width:0}, fill:'tonexty', fillcolor:'rgba(224,135,36,0.15)', showlegend:false, hoverinfo:'skip'},
    {type:'scatter', mode:'lines+markers', name:'PM median (HE17–22)', x:weeks, y:points.map(p=>p.pmMedian), line:{color:'#e08724',width:3}, customdata:points.map(p=>p.week), hovertemplate:'Week of %{x}<br>PM median peak HE%{y}<extra></extra>'}
  ];
  const layout={height:380, yaxis:{title:'Peak hour (HE)'}, xaxis:{title:'Week beginning'}};
  return <div className="chart-panel"><strong>Peak-hour migration — weekly median peak hour, with observed range</strong><PlotlyChart traces={traces} layout={layout} height={380} onPointClick={(week)=>onWeek(week)}/><p className="insight-note">The line is the median hour-of-day that prices peaked across days in that week; the shaded band shows the full min–max range observed that week. A wide band means peak timing varied a lot day to day — a single averaged number would be misleading there. Each day's peak is the first hour with the maximum price in its window; this is descriptive history, not a forecast. {points.length} weeks shown. Click a point for that week's underlying days.</p></div>;
}

function PriceLineChart({series,title,monthMode,minN,showCounts}){
  const all=series.flatMap(s=>s.points.map(p=>p.value)).filter(validPrice);
  if(!all.length)return <p className="insight-note">Not enough complete price history for this chart.</p>;
  const traces=series.map(s=>{
    const lowMask=s.points.map(p=>minN?((p.n||0)<minN):false);
    return {
      type:'scatter', mode:'lines+markers', name:s.name,
      x: monthMode ? s.points.map(p=>MONTH_ABBR[p.x]) : s.points.map(p=>p.x),
      y: s.points.map(p=>p.value),
      line:{color:s.color, width:2.5},
      marker:{color:s.color, size:s.points.map((p,i)=>lowMask[i]?5:6), opacity:s.points.map((p,i)=>lowMask[i]?0.55:1)},
      customdata: s.points.map(p=>({n:p.n, x:p.x})),
      hovertemplate: '%{x}<br>$%{y:.2f}'+(s.points.some(p=>p.n!==undefined)?'<br>%{customdata.n} day(s)':'')+'<extra>'+s.name+'</extra>'
    };
  });
  const layout={height:300, yaxis:{title:'$/MWh'}, xaxis: monthMode?{title:'Month', categoryorder:'array', categoryarray:MONTH_ABBR}:{title:'Period'}};
  if(showCounts){
    const countTrace={type:'bar', name:'Sample days', x: monthMode?series[0].points.map(p=>MONTH_ABBR[p.x]):series[0].points.map(p=>p.x), y: series[0].points.map(p=>p.n||0), marker:{color:'#4a5a6b'}, opacity:0.5, yaxis:'y2', hovertemplate:'%{x}<br>%{y} day(s)<extra>Sample size</extra>'};
    traces.push(countTrace);
    layout.yaxis2={overlaying:'y', side:'right', title:'Sample days', showgrid:false};
  }
  return <div className="chart-panel"><strong>{title}</strong>{minN?<div className="chart-legend"><span style={{color:'#8a97a6'}}>Smaller/faded points: fewer than {minN} days</span></div>:null}<PlotlyChart traces={traces} layout={layout} height={300}/></div>;
}

function LineChart(props) {
  const series = props.series;
  const traces = series.map((s,i) => {
    const pts = s.points.filter(p => p.y !== null && p.y !== undefined && !isNaN(p.y));
    return {
      type:'scatter', mode:'lines', name: s.label || ('Series '+(i+1)),
      x: pts.map(p=>'HE'+String(p.x+1).padStart(2,'0')), y: pts.map(p=>p.y),
      line:{color:s.color, width: s.width||2},
      hovertemplate:'%{x}<br>$%{y:.2f}<extra>'+(s.label||'')+'</extra>'
    };
  });
  const layout = {height:300, yaxis:{title:'$/MWh'}, xaxis:{title:'Hour ending'}, showlegend: series.some(s=>s.label)};
  return <PlotlyChart traces={traces} layout={layout} height={300}/>;
}

// ---- Regime detection (K-means on price-shape features) ----
// No weather/solar data exists in this app's schema, so feature set is limited to price-shape proxies derived
// from HE01-25 only. Regimes are labeled from their discovered centroid shape, not assumed weather causes.
function dayFeatures(r) {
  const vals = HE_COLS.slice(0,24).map(h=>r.hours[h]).filter(validPrice);
  if (vals.length < 20) return null; // require a mostly-complete day for stable features
  const avg = average(vals);
  const peak = Math.max(...vals);
  const offpeak = Math.min(...vals);
  const variance = vals.reduce((a,b)=>a+Math.pow(b-avg,2),0)/vals.length;
  const std = Math.sqrt(variance);
  const spread = peak - offpeak;
  const get = h => r.hours['HE'+String(h).padStart(2,'0')];
  const middayVals = [11,12,13,14].map(get).filter(validPrice);
  const middaySlump = middayVals.length ? average(middayVals) - avg : null;
  const eveBefore = [15,16].map(get).filter(validPrice);
  const eveAfter = [17,18,19].map(get).filter(validPrice);
  const eveningRamp = (eveBefore.length && eveAfter.length) ? average(eveAfter)-average(eveBefore) : null;
  const peakHourIdx = HE_COLS.slice(0,24).findIndex(h=>r.hours[h]===peak)+1;
  const dow = new Date(r.key+'T12:00:00Z').getUTCDay();
  const isWeekend = dow===0||dow===6;
  if (middaySlump===null || eveningRamp===null) return null;
  return {key:r.key, avg, peak, offpeak, std, spread, middaySlump, eveningRamp, peakHourIdx, isWeekend};
}
function zscoreMatrix(matrix) {
  const nFeat = matrix[0].length;
  const means = Array(nFeat).fill(0), stds = Array(nFeat).fill(0);
  matrix.forEach(row => row.forEach((v,i) => means[i]+=v));
  means.forEach((m,i)=>means[i]=m/matrix.length);
  matrix.forEach(row => row.forEach((v,i) => stds[i]+=(v-means[i])**2));
  stds.forEach((s,i)=>stds[i]=Math.sqrt(s/matrix.length)||1);
  return matrix.map(row => row.map((v,i)=>(v-means[i])/stds[i]));
}
function kmeans(data, k, iterations=100, seed=42) {
  let rngState = seed;
  const rng = () => { rngState = (rngState*1103515245+12345)&0x7fffffff; return rngState/0x7fffffff; };
  const n = data.length;
  const centroids = [data[Math.floor(rng()*n)]];
  while (centroids.length < k) {
    const dists = data.map(p => Math.min(...centroids.map(c => p.reduce((s,v,i)=>s+(v-c[i])**2,0))));
    const sum = dists.reduce((a,b)=>a+b,0);
    let r = rng()*sum, idx=0;
    if (sum===0) { idx = Math.floor(rng()*n); }
    else { for (;idx<n;idx++){ r-=dists[idx]; if(r<=0)break; } }
    centroids.push(data[Math.min(idx,n-1)]);
  }
  let assign = new Array(n).fill(0);
  for (let it=0; it<iterations; it++) {
    let changed = false;
    for (let i=0;i<n;i++) {
      let best=0, bestD=Infinity;
      for (let c=0;c<k;c++) {
        const d = data[i].reduce((s,v,j)=>s+(v-centroids[c][j])**2,0);
        if (d<bestD){bestD=d;best=c;}
      }
      if (assign[i]!==best){assign[i]=best;changed=true;}
    }
    const newC = Array.from({length:k},()=>Array(data[0].length).fill(0));
    const counts = Array(k).fill(0);
    for (let i=0;i<n;i++){ counts[assign[i]]++; data[i].forEach((v,j)=>newC[assign[i]][j]+=v); }
    for (let c=0;c<k;c++) if(counts[c]>0) newC[c]=newC[c].map(v=>v/counts[c]); else newC[c]=centroids[c];
    centroids.forEach((c,i)=>centroids[i]=newC[i]);
    if (!changed && it>0) break;
  }
  const inertia = data.reduce((s,p,i)=>s+p.reduce((ss,v,j)=>ss+(v-centroids[assign[i]][j])**2,0),0);
  return {assign, centroids, inertia};
}
const REGIME_FEATURE_NAMES = ['avg','peak','offpeak','std','spread','middaySlump','eveningRamp','peakHourIdx'];
function regimeLabel(c) {
  const [avg,peak,offpeak,std,spread,middaySlump,eveningRamp,peakHourIdx] = c;
  const parts = [];
  if (middaySlump < -15) parts.push('Midday dip');
  if (eveningRamp > 15) parts.push('Sharp evening ramp');
  if (peakHourIdx <= 10) parts.push('Morning-peaking');
  else if (peakHourIdx >= 17 && peakHourIdx <= 20) parts.push('Evening-peaking');
  if (spread > 60) parts.push('High spread');
  else if (spread < 20) parts.push('Flat/low-volatility');
  if (!parts.length) parts.push('Typical day');
  return parts.slice(0,3).join(' · ');
}
function runRegimeDetection(records, k) {
  const feats = records.map(dayFeatures).filter(Boolean);
  if (feats.length < k*3) return null;
  const matrix = feats.map(f=>REGIME_FEATURE_NAMES.map(n=>f[n]));
  const z = zscoreMatrix(matrix);
  const {assign, inertia} = kmeans(z, k);
  const clusters = Array.from({length:k},(_,c)=>{
    const idxs = assign.map((a,i)=>a===c?i:-1).filter(i=>i>=0);
    const members = idxs.map(i=>feats[i]);
    const centroidRaw = REGIME_FEATURE_NAMES.map(n=>average(members.map(m=>m[n])));
    const weekendShare = members.filter(m=>m.isWeekend).length/Math.max(1,members.length);
    return {id:c, n:members.length, centroid:centroidRaw, label:regimeLabel(centroidRaw), members, weekendShare,
      avgPrice:average(members.map(m=>m.avg)), avgPeak:average(members.map(m=>m.peak)), avgSpread:average(members.map(m=>m.spread))};
  }).sort((a,b)=>b.n-a.n);
  return {clusters, inertia, totalDays:feats.length};
}
function elbowSeries(records, maxK) {
  const feats = records.map(dayFeatures).filter(Boolean);
  if (feats.length < 6) return [];
  const matrix = feats.map(f=>REGIME_FEATURE_NAMES.map(n=>f[n]));
  const z = zscoreMatrix(matrix);
  const out = [];
  for (let k=2;k<=maxK;k++) {
    if (feats.length < k*3) break;
    const {inertia} = kmeans(z,k);
    out.push({k, inertia});
  }
  return out;
}

// ---- Price-duration curves & tail risk (CVaR) ----
function priceDurationAnalysis(prices, percentiles) {
  const sorted = [...prices].filter(validPrice).sort((a,b)=>b-a);
  const n = sorted.length;
  if (!n) return null;
  const pctValues = percentiles.map(p => {
    const idx = Math.min(n-1, Math.floor((1-p/100)*n));
    return {p, value: sorted[idx]};
  });
  const cvar = percentiles.map(p => {
    const threshold = pctValues.find(x=>x.p===p).value;
    const tail = sorted.filter(v=>v>=threshold);
    return {p, threshold, cvar: average(tail), count:tail.length, pctOfHours: tail.length/n*100};
  });
  const targetPoints = 220;
  const step = Math.max(1, Math.floor(n/targetPoints));
  const curve = [];
  for (let i=0;i<n;i+=step) curve.push({pctHours:i/n*100, price:sorted[i]});
  if (curve[curve.length-1].pctHours < 99.5) curve.push({pctHours:100, price:sorted[n-1]});
  return {n, pctValues, cvar, curve};
}
function seasonHours(records, seasonMonths) {
  const inSeason = r => seasonMonths.includes(Number(r.key.slice(5,7)));
  return records.filter(inSeason).flatMap(r=>HE_COLS.slice(0,24).map(h=>r.hours[h])).filter(validPrice);
}
const SEASON_DEFS = [
  {key:'winter',label:'Winter (Dec–Feb)',months:[12,1,2]},
  {key:'spring',label:'Spring (Mar–May)',months:[3,4,5]},
  {key:'summer',label:'Summer (Jun–Aug)',months:[6,7,8]},
  {key:'fall',label:'Fall (Sep–Nov)',months:[9,10,11]},
];

// ---- Dataset-wide exploration statistics (operate on any already-period-filtered records array) ----
function allHourlyPrices(records) {
  return records.flatMap(r=>HE_COLS.slice(0,24).map(h=>r.hours[h])).filter(validPrice);
}
function monthlyBoxStats(records) {
  const by=new Map();
  records.forEach(r=>{
    const key=r.key.slice(0,7);
    const vals=HE_COLS.slice(0,24).map(h=>r.hours[h]).filter(validPrice);
    if(!vals.length)return;
    if(!by.has(key))by.set(key,[]);
    by.get(key).push(...vals);
  });
  return [...by.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([month,vals])=>({month,vals}));
}
function hourOfDayAverage(records) {
  return HE_COLS.slice(0,24).map((h,i)=>{
    const vals=records.map(r=>r.hours[h]).filter(validPrice);
    return {hour:i+1, avg:average(vals), n:vals.length};
  });
}
function monthHourHeatmap(records) {
  const months=[...new Set(records.map(r=>r.key.slice(0,7)))].sort();
  const matrix=months.map(month=>{
    const rows=records.filter(r=>r.key.slice(0,7)===month);
    return HE_COLS.slice(0,24).map(h=>average(rows.map(r=>r.hours[h]).filter(validPrice)));
  });
  return {months, matrix};
}
function dailyVolatility(records) {
  const sorted=[...records].sort((a,b)=>a.key.localeCompare(b.key));
  const daily=sorted.map(r=>{
    const vals=HE_COLS.slice(0,24).map(h=>r.hours[h]).filter(validPrice);
    if(vals.length<10)return null;
    const avg=average(vals);
    const std=Math.sqrt(average(vals.map(v=>(v-avg)**2)));
    return {date:r.key, std};
  }).filter(Boolean);
  const rolling=daily.map((d,i)=>{
    const window=daily.slice(Math.max(0,i-6),i+1);
    return {date:d.date, std:d.std, rollingStd:average(window.map(w=>w.std))};
  });
  return rolling;
}
function dailyAverageSeries(records) {
  const sorted=[...records].sort((a,b)=>a.key.localeCompare(b.key));
  const daily=sorted.map(r=>{
    const st=computeStats(r.hours);
    return st?{date:r.key, avg:st.avg}:null;
  }).filter(Boolean);
  const rolling=daily.map((d,i)=>{
    const window=daily.slice(Math.max(0,i-6),i+1);
    return {date:d.date, avg:d.avg, rollingAvg:average(window.map(w=>w.avg))};
  });
  return rolling;
}
function datasetSummary(records) {
  const byMonth=new Map(), byYear=new Map(), byDow=Array.from({length:7},()=>[]);
  records.forEach(r=>{
    const st=computeStats(r.hours);
    if(!st)return;
    const monthKey=r.key.slice(5,7), yearKey=r.key.slice(0,4), dow=new Date(r.key+'T12:00:00Z').getUTCDay();
    if(!byMonth.has(monthKey))byMonth.set(monthKey,[]);
    byMonth.get(monthKey).push(st.avg);
    if(!byYear.has(yearKey))byYear.set(yearKey,[]);
    byYear.get(yearKey).push(st.avg);
    byDow[dow].push(st.avg);
  });
  const monthRank=[...byMonth.entries()].map(([m,vals])=>({label:MONTH_ABBR[Number(m)-1], avg:average(vals), n:vals.length})).sort((a,b)=>b.avg-a.avg);
  const yearRank=[...byYear.entries()].map(([y,vals])=>({label:y, avg:average(vals), n:vals.length})).sort((a,b)=>b.avg-a.avg);
  const dowNames=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const dowRank=byDow.map((vals,i)=>({label:dowNames[i], avg:average(vals), n:vals.length})).filter(d=>d.n).sort((a,b)=>b.avg-a.avg);
  const allPrices=allHourlyPrices(records);
  const overallAvg=average(allPrices);
  const overallStd=allPrices.length?Math.sqrt(average(allPrices.map(v=>(v-overallAvg)**2))):null;
  return {monthRank, yearRank, dowRank, overallAvg, overallStd, totalHours:allPrices.length, totalDays:records.length};
}

function PriceHistogramChart({records}) {
  const prices=allHourlyPrices(records);
  if(!prices.length)return <div className="empty">No data.</div>;
  const traces=[{type:'histogram', x:prices, marker:{color:'#5b8dee'}, hovertemplate:'$%{x}<br>%{y} hour(s)<extra></extra>'}];
  const layout={height:340, xaxis:{title:'Price ($/MWh)'}, yaxis:{title:'Frequency (hours)'}};
  return <div className="chart-panel"><strong>Price distribution — all hours</strong><PlotlyChart traces={traces} layout={layout} height={340}/><p className="insight-note">Distribution of every valid hourly price in the selected period ({prices.length.toLocaleString()} observations). A long right tail means occasional high-price spikes against a lower typical baseline.</p></div>;
}
function MonthlyBoxChart({records}) {
  const data=monthlyBoxStats(records);
  if(!data.length)return <div className="empty">No data.</div>;
  const traces=[{type:'box', x:data.flatMap(d=>d.vals.map(()=>d.month)), y:data.flatMap(d=>d.vals), marker:{color:'#5b8dee'}, line:{color:'#3b5a8a'}, boxpoints:false}];
  const layout={height:360, xaxis:{title:'Month', tickangle:-45, type:'category'}, yaxis:{title:'Price ($/MWh)'}};
  return <div className="chart-panel"><strong>Monthly price distribution</strong><PlotlyChart traces={traces} layout={layout} height={360}/><p className="insight-note">Each box summarizes all hourly prices in that calendar month (25th–75th percentile, median, whiskers to min/max). Outlier points are hidden to keep the typical range readable — use the price-duration/CVaR view in Regime & Risk for extreme-value detail.</p></div>;
}
function HourOfDayChart({records}) {
  const data=hourOfDayAverage(records).filter(d=>d.n>0);
  if(!data.length)return <div className="empty">No data.</div>;
  const traces=[{type:'scatter', mode:'lines+markers', x:data.map(d=>d.hour), y:data.map(d=>d.avg), line:{color:'#5b8dee',width:2.5}, marker:{size:7}, hovertemplate:'HE%{x}<br>$%{y:.2f} average<extra></extra>'}];
  const layout={height:340, xaxis:{title:'Hour ending', dtick:1}, yaxis:{title:'Average price ($/MWh)'}};
  return <div className="chart-panel"><strong>Average price by hour of day</strong><PlotlyChart traces={traces} layout={layout} height={340}/><p className="insight-note">Average of each hour ending (HE1–HE24) across every day in the selected period. Shows the typical daily shape — midday dip, evening peak, etc. — independent of any single day's noise.</p></div>;
}
function MonthHourHeatmapChart({records}) {
  const {months,matrix}=monthHourHeatmap(records);
  if(!months.length)return <div className="empty">No data.</div>;
  const traces=[{type:'heatmap', x:HE_COLS.slice(0,24).map((_,i)=>i+1), y:months, z:matrix, colorscale:'Viridis', hovertemplate:'%{y}, HE%{x}<br>$%{z:.2f}<extra></extra>', colorbar:{title:'$/MWh'}}];
  const layout={height:Math.max(340, months.length*16+80), xaxis:{title:'Hour ending', dtick:1}, yaxis:{title:'Month', automargin:true}};
  return <div className="chart-panel"><strong>Mean price by month and hour</strong><PlotlyChart traces={traces} layout={layout} height={layout.height}/><p className="insight-note">Each cell is the average price for that calendar month and hour-of-day across all included years. Useful for spotting seasonal shifts in when the daily peak occurs.</p></div>;
}
function VolatilityChart({records}) {
  const data=dailyVolatility(records);
  if(!data.length)return <div className="empty">No data.</div>;
  const traces=[
    {type:'scatter', mode:'lines', name:'Daily std dev', x:data.map(d=>d.date), y:data.map(d=>d.std), line:{color:'#f0c674',width:1}, hovertemplate:'%{x}<br>$%{y:.2f}<extra>Daily</extra>'},
    {type:'scatter', mode:'lines', name:'7-day rolling mean', x:data.map(d=>d.date), y:data.map(d=>d.rollingStd), line:{color:'#e05d44',width:2.5}, hovertemplate:'%{x}<br>$%{y:.2f}<extra>7-day mean</extra>'}
  ];
  const layout={height:340, xaxis:{title:'Date'}, yaxis:{title:'Std dev of hourly price ($/MWh)'}, legend:{orientation:'h',y:1.12}};
  return <div className="chart-panel"><strong>Daily volatility (standard deviation of hourly prices)</strong><PlotlyChart traces={traces} layout={layout} height={340}/><p className="insight-note">Standard deviation of that day's 24 hourly prices — higher means a more extreme spread between cheap and expensive hours that day, not necessarily a higher average price.</p></div>;
}
function DailyAverageWithMeanChart({records}) {
  const data=dailyAverageSeries(records);
  if(!data.length)return <div className="empty">No data.</div>;
  const traces=[
    {type:'scatter', mode:'lines', name:'Daily average price', x:data.map(d=>d.date), y:data.map(d=>d.avg), line:{color:'#8899ee',width:1}, hovertemplate:'%{x}<br>$%{y:.2f}<extra>Daily</extra>'},
    {type:'scatter', mode:'lines', name:'7-day rolling mean', x:data.map(d=>d.date), y:data.map(d=>d.rollingAvg), line:{color:'#d6318e',width:2.5}, hovertemplate:'%{x}<br>$%{y:.2f}<extra>7-day mean</extra>'}
  ];
  const layout={height:340, xaxis:{title:'Date'}, yaxis:{title:'Price ($/MWh)'}, legend:{orientation:'h',y:1.12}};
  return <div className="chart-panel"><strong>Daily average price with 7-day mean</strong><PlotlyChart traces={traces} layout={layout} height={340}/><p className="insight-note">Daily average price (thin line) with a 7-day rolling mean overlay (thick line) to smooth day-to-day noise and show the underlying trend.</p></div>;
}
function SummaryStatsPanel({records}) {
  const s=useMemo(()=>datasetSummary(records),[records]);
  if(!s.totalDays)return <div className="empty">No data.</div>;
  return <div className="card">
    <h3>Dataset summary</h3>
    <div className="stat-grid">
      <div className="stat"><div className="label">Days in selection</div><div className="val">{s.totalDays.toLocaleString()}</div></div>
      <div className="stat"><div className="label">Hourly observations</div><div className="val">{s.totalHours.toLocaleString()}</div></div>
      <div className="stat"><div className="label">Overall average</div><div className="val">{formatPrice(s.overallAvg)}</div></div>
      <div className="stat"><div className="label">Overall std dev</div><div className="val">{formatPrice(s.overallStd)}</div></div>
    </div>
    <div className="opportunity-columns">
      <div><h3>By month (highest to lowest avg)</h3>{s.monthRank.map((m,i)=><div className="audit-line" key={m.label}><b>{i+1}. {m.label}</b><span>{formatPrice(m.avg)} · {m.n} days</span></div>)}</div>
      <div><h3>By year (highest to lowest avg)</h3>{s.yearRank.map((y,i)=><div className="audit-line" key={y.label}><b>{i+1}. {y.label}</b><span>{formatPrice(y.avg)} · {y.n} days</span></div>)}</div>
      <div><h3>By day of week (highest to lowest avg)</h3>{s.dowRank.map((d,i)=><div className="audit-line" key={d.label}><b>{i+1}. {d.label}</b><span>{formatPrice(d.avg)} · {d.n} days</span></div>)}</div>
    </div>
    <p className="insight-note">Rankings are based on each day's average price (mean of HE01–HE24), averaged within each group. Groups with few days (e.g. a partial year) may be less representative.</p>
  </div>;
}

function App() {
  const [records, setRecords] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [dbReady, setDbReady] = useState(false);
  const [dbPath, setDbPath] = useState(null);
  const [tab, setTab] = useState('dashboard');
  const [dragOver, setDragOver] = useState(false);
  const [msg, setMsg] = useState(null);
  const [pendingOverwrite, setPendingOverwrite] = useState(null);
  const [selectedDates, setSelectedDates] = useState([]);
  const [spikeThreshold, setSpikeThreshold] = useState(100);
  const [expandedRow, setExpandedRow] = useState(null);
  const [trendWindow, setTrendWindow] = useState(30);
  const [amPremium, setAmPremium] = useState(10);
  const [seasonMonths, setSeasonMonths] = useState(12);
  const [matrixDate, setMatrixDate] = useState('');
  const [theme,setTheme]=useState('light');
  const [detail,setDetail]=useState(null);
  const [selectedMonth,setSelectedMonth]=useState(null);
  const [boxPeriod,setBoxPeriod]=useState('7');
  const [opMonth,setOpMonth]=useState(6);
  const [selectedCalendarDay,setSelectedCalendarDay]=useState(null);
  const [selectedWeek,setSelectedWeek]=useState(null);
  const [focusHour,setFocusHour]=useState(null);
  const [overviewDays,setOverviewDays]=useState(14);
  const [highValueDays,setHighValueDays]=useState(14);
  const [probThreshold,setProbThreshold]=useState(75);
  const [probDays,setProbDays]=useState(30);
  const [migrationDays,setMigrationDays]=useState(180);
  const [rollingWindow,setRollingWindow]=useState(30);
  const [regimeK,setRegimeK]=useState(5);
  const [selectedRegime,setSelectedRegime]=useState(null);
  const [showElbow,setShowElbow]=useState(false);
  const [spikePercentiles]=useState([50,75,90,95,99]);
  const [regimePeriod,setRegimePeriod]=useState({mode:'all'});
  const [explorePeriod,setExplorePeriod]=useState({mode:'all'});

  const [fetchStartDate, setFetchStartDate] = useState(function() {
    return addDaysToIso(new Date().toISOString().slice(0,10), 1);
  });
  const [fetchEndDate, setFetchEndDate] = useState(function() {
    return addDaysToIso(new Date().toISOString().slice(0,10), 1);
  });
  const [fetching, setFetching] = useState(false);
  const [lastFetchAt, setLastFetchAt] = useState(0);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [fetchLog, setFetchLog] = useState([]);
  const [fetchTotal, setFetchTotal] = useState(0);
  const fileInputRef = useRef(null);

  const recordsMap = useMemo(function() {
    const m = {};
    records.forEach(function(r) { m[r.key] = r; });
    return m;
  }, [records]);

  const refreshFromDb = useCallback(async function() {
    const days = await window.api.getAllDays();
    setRecords(days);
  }, []);

  useEffect(function() {
    (async function() {
      const cfg = await window.api.getConfig();
      if (cfg.dbPath) {
        setDbPath(cfg.dbPath);
        const res = await window.api.initDb();
        if (res.ok) {
          setDbReady(true);
          await refreshFromDb();
        } else {
          setMsg({type:'err', text: 'DB init failed: ' + res.error});
        }
      }
      setLoaded(true);
    })();
  }, [refreshFromDb]);

  useEffect(function() {
    if (cooldownLeft <= 0) return;
    const t = setInterval(function() {
      const remaining = Math.max(0, lastFetchAt + FETCH_COOLDOWN_MS - Date.now());
      setCooldownLeft(remaining);
    }, 500);
    return function() { clearInterval(t); };
  }, [cooldownLeft, lastFetchAt]);

  useEffect(function() {
    const unsubscribe = window.api.onFetchProgress(function(data) {
      setFetchLog(function(prev) { return prev.concat([data]); });
    });
    return unsubscribe;
  }, []);

  const handlePickDb = async function() {
    const p = await window.api.pickDbPath();
    if (p) {
      setDbPath(p);
      const res = await window.api.initDb();
      setDbReady(res.ok);
      if (res.ok) {
        setMsg({type:'ok', text: 'Database set: ' + p});
        await refreshFromDb();
      } else {
        setMsg({type:'err', text: 'DB init failed: ' + res.error});
      }
    }
  };

  const importRecords = async function(parsed, forceOverwrite) {
    const toSave = [];
    const conflicts = [];
    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i];
      const key = dateKey(p.date);
      const exists = await window.api.checkExists(key);
      const rec = { key: key, date: p.date, hours: p.hours, source: 'csv' };
      if (exists && !forceOverwrite) {
        conflicts.push(rec);
      } else {
        toSave.push(rec);
      }
    }
    if (conflicts.length > 0 && !forceOverwrite) {
      setPendingOverwrite({ source: 'csv', toSave: toSave, conflicts: conflicts });
      return;
    }
    for (let i = 0; i < toSave.length; i++) {
      await window.api.upsertDay(toSave[i], true);
    }
    await refreshFromDb();
    setMsg({type:'ok', text: 'Imported ' + toSave.length + ' day(s)'});
  };

  const handleFile = useCallback(async function(file) {
    setMsg(null);
    try {
      const text = await file.text();
      const parsed = parseCSV(text);
      await importRecords(parsed, false);
    } catch (e) {
      setMsg({type:'err', text: 'Parse failed: ' + e.message});
    }
  }, []);

  const resolveOverwrite = async function(overwrite) {
    if (!pendingOverwrite) return;
    if (pendingOverwrite.source === 'caiso') {
      const startStr = pendingOverwrite.startStr;
      const endStr = pendingOverwrite.endStr;
      setPendingOverwrite(null);
      if (overwrite) {
        await runCaisoFetch(startStr, endStr);
      } else {
        setMsg({type:'warn', text: 'Fetch cancelled — existing data kept'});
      }
      return;
    }
    const toSave = pendingOverwrite.toSave;
    const conflicts = pendingOverwrite.conflicts;
    const all = overwrite ? toSave.concat(conflicts) : toSave;
    for (let i = 0; i < all.length; i++) {
      await window.api.upsertDay(all[i], true);
    }
    await refreshFromDb();
    if (overwrite) {
      setMsg({type:'ok', text: 'Imported ' + all.length + ', overwrote ' + conflicts.length});
    } else {
      setMsg({type:'warn', text: 'Imported ' + toSave.length + ' new, skipped ' + conflicts.length});
    }
    setPendingOverwrite(null);
  };

  const onDrop = function(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const runCaisoFetch = async function(startStr, endStr) {
    setFetching(true);
    setMsg(null);
    setLastFetchAt(Date.now());
    setFetchLog([]);
    try {
      if (startStr === endStr) {
        setFetchTotal(1);
        const res = await window.api.fetchCaisoDay(startStr, NODE_ID);
        if (!res.ok) {
          setFetchLog([{ chunkStart: startStr, chunkEnd: endStr, ok: false, error: res.error }]);
          setMsg({type:'err', text: 'CAISO fetch failed: ' + res.error});
        } else {
          await window.api.upsertDay({key:dateKey(res.data.date),date:res.data.date,hours:res.data.hours,source:"caiso_api"}, true);
          await refreshFromDb();
          setFetchLog([{ chunkStart: startStr, chunkEnd: endStr, ok: true, count: 1 }]);
          setMsg({type:'ok', text: 'Fetched ' + res.data.date + ' from CAISO'});
        }
      } else {
        const d0 = new Date(startStr.slice(0,4) + '-' + startStr.slice(4,6) + '-' + startStr.slice(6,8));
        const d1 = new Date(endStr.slice(0,4) + '-' + endStr.slice(4,6) + '-' + endStr.slice(6,8));
        const totalDays = Math.round((d1 - d0) / 86400000) + 1;
        const totalChunks = Math.ceil(totalDays / 31);
        setFetchTotal(totalChunks);

        const dayResults = await window.api.fetchCaisoRange(startStr, endStr, NODE_ID);
        for (let i = 0; i < dayResults.length; i++) {
          const r = dayResults[i];
          await window.api.upsertDay(
            { key: dateKey(r.data.date), date: r.data.date, hours: r.data.hours, source: 'caiso_api' },
            true
          );
        }
        await refreshFromDb();
        setMsg({type:dayResults.length===totalDays?'ok':'warn', text:'CAISO returned '+dayResults.length+' of '+totalDays+' requested days. Existing valid hours were preserved. Check Data Quality for remaining gaps.'});
      }
    } catch (e) {
      setMsg({type:'err', text: 'CAISO fetch error: ' + e.message});
    }
    setFetching(false);
    setCooldownLeft(FETCH_COOLDOWN_MS);
  };

  const doCaisoFetch = async function() {
    const remaining = lastFetchAt + FETCH_COOLDOWN_MS - Date.now();
    if (remaining > 0) {
      setCooldownLeft(remaining);
      return;
    }
    if (fetchStartDate > fetchEndDate) {
      setMsg({type:'err', text: 'Start date must be before or equal to end date'});
      return;
    }

    const startStr = fetchStartDate.replace(/-/g, '');
    const endStr = fetchEndDate.replace(/-/g, '');

    const datesInRange = [];
    let cursor = fetchStartDate;
    while (cursor <= fetchEndDate) {
      datesInRange.push(cursor);
      cursor = addDaysToIso(cursor, 1);
    }
    const conflictDates = [];
    for (let i = 0; i < datesInRange.length; i++) {
      const exists = await window.api.checkExists(datesInRange[i]);
      if (exists) conflictDates.push(datesInRange[i]);
    }
    if (conflictDates.length > 0) {
      setPendingOverwrite({
        source: 'caiso',
        startStr: startStr,
        endStr: endStr,
        conflictDates: conflictDates
      });
      return;
    }

    await runCaisoFetch(startStr, endStr);
  };

  const sortedList = useMemo(function() {
    const copy = records.slice();
    copy.sort(function(a,b) { return b.key.localeCompare(a.key); });
    return copy;
  }, [records]);

  const globalStats = useMemo(function() {
    const all = records.map(function(r) { return computeStats(r.hours); }).filter(Boolean);
    const extrema=records.flatMap(r=>HE_COLS.filter(h=>validPrice(r.hours[h])).map(h=>({date:r.key,hour:h,price:r.hours[h]})));
    const maxRecord=extrema.reduce((a,b)=>!a||b.price>a.price?b:a,null);
    const minRecord=extrema.reduce((a,b)=>!a||b.price<a.price?b:a,null);
    if (all.length === 0) return null;
    return {
      avgAll: all.reduce(function(a,b) { return a+b.avg; }, 0) / all.length,
      maxAll: maxRecord.price, maxRecord,
      minAll: minRecord.price, minRecord,
      days: all.length
    };
  }, [records]);

  const spikeDays = useMemo(function() {
    return records.filter(function(r) {
      return HE_COLS.some(function(h) {
        const v = r.hours[h];
        return v !== null && v !== undefined && v > spikeThreshold;
      });
    }).map(function(r) { return r.key; });
  }, [records, spikeThreshold]);

  const opportunityData = useMemo(()=>opportunityRows(records),[records]);
  const availableMonths = useMemo(()=>[...new Set(records.map(r=>r.key.slice(0,7)))].sort(),[records]);
  const seasonal = useMemo(()=>seasonalSummary(records,seasonMonths),[records,seasonMonths]);
  const trends = useMemo(()=>trendInsights(records,seasonMonths),[records,seasonMonths]);
  const holidayStats = useMemo(()=>holidayAnalysis(records,seasonMonths),[records,seasonMonths]);
  const rolling = useMemo(()=>rollingAnalysis(records,rollingWindow),[records,rollingWindow]);
  const yoy = useMemo(()=>yearMonthSeries(records),[records]);
  const matrixRecord = useMemo(()=>records.find(r=>r.key===matrixDate)||[...records].sort((a,b)=>b.key.localeCompare(a.key))[0]||null,[records,matrixDate]);
  const audit = useMemo(()=>dayAudit(records),[records]);
  const peaks = useMemo(()=>peakAnalysis(records,trendWindow),[records,trendWindow]);
  const outlook = useMemo(()=>tomorrowOutlook(records),[records]);
  const opp = useMemo(()=>opportunity(records,trendWindow,amPremium),[records,trendWindow,amPremium]);
  const releaseDays = useMemo(()=>[...records].sort((a,b)=>b.key.localeCompare(a.key)),[records]);
  const regimeFiltered = useMemo(()=>filterByPeriod(records,regimePeriod),[records,regimePeriod]);
  const regimeResult = useMemo(()=>runRegimeDetection(regimeFiltered,regimeK),[regimeFiltered,regimeK]);
  const elbow = useMemo(()=>showElbow?elbowSeries(regimeFiltered,9):[],[regimeFiltered,showElbow]);
  const seasonCurves = useMemo(()=>{
    const palette={winter:'#65b8fa',spring:'#8de39c',summer:'#f2b56d',fall:'#e38da8'};
    return SEASON_DEFS.map(s=>{
      const hours=seasonHours(regimeFiltered,s.months);
      const pd=priceDurationAnalysis(hours,spikePercentiles);
      return pd?{name:s.label,key:s.key,color:palette[s.key],points:pd.curve,stats:pd}:null;
    }).filter(Boolean);
  },[regimeFiltered,spikePercentiles]);
  const exploreFiltered = useMemo(()=>filterByPeriod(records,explorePeriod),[records,explorePeriod]);

  const exportCSV = function() {
    const rows = ['Date,' + HE_COLS.join(',')];
    const sorted = records.slice().sort(function(a,b) { return a.key.localeCompare(b.key); });
    sorted.forEach(function(r) {
      const vals = HE_COLS.map(function(h) { return r.hours[h] !== null && r.hours[h] !== undefined ? r.hours[h] : ''; });
      rows.push(r.date + ',' + vals.join(','));
    });
    const blob = new Blob([rows.join('\n')], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mead_da_price_history.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!loaded) {
    return <div className="app"><p>Loading...</p></div>;
  }

  if (!dbReady) {
    return (
      <div className="app">
        <h1>MEAD Price Tracker — Setup</h1>
        <div className="card">
          <p>Choose where to store the price database. For team sharing, pick a network location everyone can reach (e.g. <code>\\server\share\mead_prices.db</code>).</p>
          <button onClick={handlePickDb}>Choose Database Location</button>
          {msg && <div className={'msg ' + msg.type} style={{marginTop:12}}>{msg.text}</div>}
        </div>
      </div>
    );
  }

  let heatMin = 0;
  let heatMax = 1;
  if (records.length > 0) {
    const allVals = [];
    records.forEach(function(r) {
      HE_COLS.forEach(function(h) {
        const v = r.hours[h];
        if (v !== null && v !== undefined) allVals.push(v);
      });
    });
    if (allVals.length > 0) {
      heatMin = Math.min.apply(null, allVals);
      heatMax = Math.max.apply(null, allVals);
    }
  }

  const latest = sortedList[0];
  const latestStats = latest ? computeStats(latest.hours) : null;
  const outlookTop=outlook?outlook.prices.filter(x=>validPrice(x.price)).map(x=>({he:Number(x.hour.slice(2)),price:x.price})).sort((a,b)=>b.price-a.price).slice(0,5):[];
  const chartDays = sortedList.slice(0, overviewDays).reverse();
  const highRecords=sortedList.slice(0,highValueDays);
  const peakHours=HE_COLS.slice(0,24).map(h=>({hour:h,price:average(highRecords.map(r=>r.hours[h]).filter(validPrice))})).filter(x=>validPrice(x.price)).sort((a,b)=>b.price-a.price).slice(0,5);
  const currentRows=completePeakRows(sortedList.slice(0,14));
  const priorRows=completePeakRows(sortedList.slice(14,28));
  const recentAm=average(currentRows.map(r=>r.am)),recentPm=average(currentRows.map(r=>r.pm)),priorAm=average(priorRows.map(r=>r.am)),priorPm=average(priorRows.map(r=>r.pm));
  return (
    <div className={"app shell theme-"+theme}>
      <aside className="sidebar">
        <div className="brand"><div className="brand-icon">≋</div><div><strong>HOOVER<span> / </span>MEAD</strong><small>ENERGY INTELLIGENCE</small></div></div>
        <div className="side-label">WORKSPACE</div>
        <nav className="side-nav">
          {[['dashboard','◫','Overview'],['import','↓','Download prices'],['history','▤','Historical data'],['analysis','⌁','Price analysis'],['heatmap','▦','Daily price map'],['seasonal','▥','Seasonal trends'],['visuals','▧','Opportunity visuals'],['regimes','◉','Regime & risk'],['explore','✦','Explore & stats'],['quality','✓','Data quality']].map(function(item){return <button key={item[0]} className={'nav-item'+(tab===item[0]?' selected':'')} onClick={function(){setTab(item[0]);}}><span className="nav-symbol">{item[1]}</span>{item[2]}</button>;})}
        </nav>
        <div className="sidebar-bottom"><div className="node-pill"><span className="live-dot"></span> CAISO · MEADS_2_N101</div><button className={'nav-item'+(tab==='settings'?' selected':'')} onClick={function(){setTab('settings');}}>⚙ &nbsp; Settings</button></div>
      </aside>
      <main className="main-panel" onClickCapture={e=>{const chart=e.target.closest('.chart-panel,.chart-card');if(chart&&!e.target.closest('button,select,input,[data-no-expand],.js-plotly-plot')){setDetail({title:chart.querySelector('strong,h3')?.textContent||'Price chart',chart:chart.querySelector('svg')?.outerHTML||null,body:'Values are calculated from stored MEAD hourly prices. Hover over chart elements for additional values.'});}}}>
      <header className="topbar"><div><div className="eyebrow">HOOVER DAM / LAKE MEAD</div><h1>{({dashboard:'Energy price overview',import:'Download CAISO prices',history:'Historical price library',analysis:'Market price analysis',heatmap:'One-day price map',seasonal:'Seasonal trends',visuals:'Opportunity visualizations',regimes:'Regime detection & tail risk',explore:'Explore & dataset statistics',quality:'Database completeness',settings:'Application settings'})[tab]}</h1><div className="sub">Day-ahead locational marginal prices · Pacific operating time</div></div><div className="top-actions"><span className="data-count">{records.length.toLocaleString()} days stored{records.length?` · ${sortedList[sortedList.length-1].key} to ${sortedList[0].key}`:''}</span><button className="theme-switch" onClick={()=>setTheme(theme==='light'?'dark':'light')}>{theme==='light'?'☾ Dark mode':'☀ Light mode'}</button><button onClick={function(){setTab('import');}}>↓ Download data</button></div></header>
      {tab === 'dashboard' && <section className="dashboard">
        <div className="section-heading"><div><h2>Market snapshot</h2><p>{latest ? 'Latest available operating day: '+latest.date : 'Connect your database and download prices to populate the dashboard'}</p></div><span className="source-tag">SOURCE · CAISO DAY-AHEAD</span></div>
        <div className="kpi-grid">
          <div className="kpi interactive" onClick={()=>setDetail({title:"Average historical price",body:"Arithmetic mean of all valid hourly prices in the stored data. Missing hourly prices are excluded. This is not a volume-weighted generation price."})}><span>Average historical price</span><strong>{globalStats?formatPrice(globalStats.avgAll):'—'}</strong><small>$/MWh · stored days</small></div>
          <div className="kpi interactive" onClick={()=>setDetail({title:"Latest daily peak",body:"Highest available hourly MEAD price on the latest stored operating day; the operating date and hour ending appear below the number."})}><span>Latest daily peak</span><strong>{latestStats?formatPrice(latestStats.max):'—'}</strong><small>{latestStats?'On '+latest.key+' · '+latestStats.peakHour:'No prices loaded'}</small></div>
          <div className="kpi interactive" onClick={()=>setDetail({title:"Latest daily spread",body:"Highest minus lowest hourly price for the latest stored operating day. This measures price variation, not achievable generation revenue."})}><span>Latest daily spread</span><strong>{latestStats?formatPrice(latestStats.max-latestStats.min):'—'}</strong><small>Maximum minus minimum</small></div>
          <div className="kpi interactive" onClick={()=>setDetail({title:"Historical data coverage",body:records.length?`${records.length} stored operating-day records, from ${sortedList[sortedList.length-1].key} through ${sortedList[0].key}. This count does not guarantee that every intervening day or hour is complete; check Data Quality.`:"No stored days."})}><span>Historical days</span><strong>{records.length.toLocaleString()}</strong><small>{records.length?`${sortedList[sortedList.length-1].key} → ${sortedList[0].key}`:"Available in local database"}</small></div>
        </div>
        <div className="dashboard-grid"><div className="card chart-card"><div className="panel-heading"><div><h3>Recent daily average prices</h3><p>Recent stored operating days</p></div><label>Period <select value={overviewDays} onChange={e=>setOverviewDays(Number(e.target.value))}>{[7,14,30,60,90].map(n=><option key={n} value={n}>Last {n} days</option>)}</select></label></div>{chartDays.length?<DailyBarChart days={chartDays}/>:<div className="empty">No historical prices yet. Download CAISO data to see price trends.</div>}</div>
        <div className="card insight-card"><div className="panel-heading"><div><h3>High-value hours</h3><p>Highest average hourly prices across the selected stored days</p></div><label>Period <select value={highValueDays} onChange={e=>setHighValueDays(Number(e.target.value))}>{[7,14,30,60,90].map(n=><option key={n} value={n}>Last {n} days</option>)}</select></label></div>{peakHours.length?peakHours.map(function(item,i){return <div className="rank-row" key={item.hour}><span className="rank">{String(i+1).padStart(2,'0')}</span><strong>{item.hour}</strong><div className="rank-bar"><i style={{width:(Math.max(0,item.price)/Math.max(1,peakHours[0].price)*100)+'%'}}></i></div><b>{formatPrice(item.price)}</b></div>}):<div className="empty">No hourly prices available.</div>}<div className="insight-note">Indicative price ranking only. Release schedules must also consider operating constraints.</div></div></div>
        <div className="card"><h3>Current AM / PM price trends</h3><div className="metric-pills"><span>Recent AM peak: <b>{formatPrice(recentAm)}</b></span><span>Recent PM peak: <b>{formatPrice(recentPm)}</b></span><span>PM advantage: <b>{formatPrice(recentPm!==null&&recentAm!==null?recentPm-recentAm:null)}</b></span></div><p className="insight-note">Recent = latest 14 stored days with complete AM/PM prices; comparison = preceding 14 stored days. AM {recentAm!==null&&priorAm!==null?(recentAm>=priorAm?'strengthening':'weakening'):'insufficient data'} ({recentAm!==null&&priorAm!==null?formatPrice(recentAm-priorAm):'—'}). PM {recentPm!==null&&priorPm!==null?(recentPm>=priorPm?'strengthening':'weakening'):'insufficient data'} ({recentPm!==null&&priorPm!==null?formatPrice(recentPm-priorPm):'—'}).</p><button onClick={()=>setTab('visuals')}>Explore hourly opportunities →</button></div><div className="card action-card"><div><h3>Explore your price history</h3><p>Compare historical periods, investigate volatility and identify recurring high-price hours.</p></div><div className="action-buttons"><button className="ghost" onClick={function(){setTab('history');}}>View history →</button><button onClick={function(){setTab('analysis');}}>Open analysis →</button></div></div>
      </section>}
      
      {msg && <div className={'msg ' + msg.type}>{msg.text}</div>}

      {tab === 'import' && (
        <div>
          <div className="card">
            <div
              className={'drop' + (dragOver?' over':'')}
              onDragOver={function(e){ e.preventDefault(); setDragOver(true); }}
              onDragLeave={function(){ setDragOver(false); }}
              onDrop={onDrop}
              onClick={function(){ fileInputRef.current.click(); }}
            >
              <p className="big">Drop BOR DA price CSV here</p>
              <p>or click to browse</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                style={{display:'none'}}
                onChange={function(e) {
                  if (e.target.files[0]) handleFile(e.target.files[0]);
                  e.target.value = '';
                }}
              />
            </div>
          </div>

          <div className="card">
            <p style={{marginTop:0, fontSize:13, color:'#8b8f9a'}}>Fetch from CAISO OASIS directly</p>
            <div className="row">
              <label>From</label>
              <input type="date" value={fetchStartDate} onChange={function(e){ setFetchStartDate(e.target.value); }} />
              <label>To</label>
              <input type="date" value={fetchEndDate} onChange={function(e){ setFetchEndDate(e.target.value); }} />
              <button onClick={doCaisoFetch} disabled={fetching || cooldownLeft > 0}>
                {fetching ? 'Fetching...' : (cooldownLeft > 0 ? ('Wait ' + Math.ceil(cooldownLeft/1000) + 's') : 'Fetch')}
              </button>
            </div>
            <p style={{fontSize:11, color:'#6b6f7a', marginBottom:0}}>
              Download or repair a day without erasing existing valid hourly prices. Date ranges are fetched in chunks. DAM data for a trading day is typically not published until the afternoon before.
            </p>
          </div>

          {fetching && (
            <div className="card">
              <p style={{marginTop:0, fontSize:13, color:'#8b8f9a'}}>
                Fetching... chunk {fetchLog.length} of {fetchTotal} (each chunk covers up to 31 days)
              </p>
              <div style={{background:'#0f1117', borderRadius:6, height:8, overflow:'hidden'}}>
                <div style={{
                  background:'#5b8dee',
                  height:'100%',
                  width: (fetchTotal > 0 ? (fetchLog.length / fetchTotal * 100) : 0) + '%',
                  transition:'width 0.3s'
                }}></div>
              </div>
            </div>
          )}

          {!fetching && fetchLog.length > 0 && (
            <div className="card">
              <p style={{marginTop:0, fontSize:13, color:'#8b8f9a'}}>
                Fetch chunks: {fetchLog.filter(function(l){return l.ok;}).length} succeeded, {fetchLog.filter(function(l){return !l.ok;}).length} failed
              </p>
              <div className="scroll" style={{maxHeight:220}}>
                <table>
                  <thead><tr><th>Date range</th><th>Result</th></tr></thead>
                  <tbody>
                    {fetchLog.map(function(l, i) {
                      const fmt = function(s) { return s.slice(4,6) + '/' + s.slice(6,8) + '/' + s.slice(0,4); };
                      const rangeLabel = fmt(l.chunkStart) + ' – ' + fmt(l.chunkEnd);
                      return (
                        <tr key={i}>
                          <td>{rangeLabel}</td>
                          <td style={{color: l.ok ? '#6ee7a0' : '#f1a0a0', textAlign:'left'}}>
                            {l.ok ? (l.count + ' day(s) retrieved') : l.error}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {pendingOverwrite && pendingOverwrite.source === 'caiso' && (
            <div className="card">
              <p style={{marginTop:0}}>
                <strong>{pendingOverwrite.conflictDates.length}</strong> date(s) in this range already have data stored
                {pendingOverwrite.conflictDates.length <= 5 ? (': ' + pendingOverwrite.conflictDates.join(', ')) : '.'}
              </p>
              <div className="row">
                <button onClick={function(){ resolveOverwrite(true); }}>Repair / refresh from CAISO (keep valid hours)</button>
                <button className="ghost" onClick={function(){ resolveOverwrite(false); }}>Cancel</button>
              </div>
            </div>
          )}

          {pendingOverwrite && pendingOverwrite.source === 'csv' && (
            <div className="card">
              <p style={{marginTop:0}}>
                <strong>{pendingOverwrite.conflicts.length}</strong> date(s) already stored.
              </p>
              <div className="row">
                <button onClick={function(){ resolveOverwrite(true); }}>Overwrite existing</button>
                <button className="ghost" onClick={function(){ resolveOverwrite(false); }}>Skip existing</button>
                <button className="ghost" onClick={function(){ setPendingOverwrite(null); }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="card">
          <div className="row" style={{justifyContent:'space-between'}}>
            <span style={{fontSize:13, color:'#8b8f9a'}}>{sortedList.length} record(s)</span>
            <button className="ghost" onClick={exportCSV} disabled={sortedList.length===0}>Export CSV</button>
          </div>
          {sortedList.length === 0 ? (
            <div className="empty">No data yet.</div>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th><th>Avg</th><th>Min</th><th>Max</th>
                    <th>On-Peak</th><th>Off-Peak</th><th>Std Dev</th><th>Source</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedList.map(function(r) {
                    const s = computeStats(r.hours);
                    if (!s) return null;
                    const isSel = selectedDates.indexOf(r.key) !== -1;
                    const isExpanded = expandedRow === r.key;
                    const rowEls = [];
                    rowEls.push(
                      <tr key={r.key + '-main'}>
                        <td>
                          <span style={{cursor:'pointer', marginRight:6}} onClick={function(){ setExpandedRow(isExpanded ? null : r.key); }}>
                            {isExpanded ? '▾' : '▸'}
                          </span>
                          {r.date}
                        </td>
                        <td>{s.avg.toFixed(2)}</td>
                        <td>{s.min.toFixed(2)}</td>
                        <td className={s.max>spikeThreshold?'spike':''}>{s.max.toFixed(2)}</td>
                        <td>{s.onAvg !== null ? s.onAvg.toFixed(2) : '-'}</td>
                        <td>{s.offAvg !== null ? s.offAvg.toFixed(2) : '-'}</td>
                        <td>{s.std.toFixed(2)}</td>
                        <td style={{fontSize:11, color:'#8b8f9a'}}>{r.source}</td>
                        <td>
                          <button
                            className="ghost"
                            style={{padding:'3px 8px', fontSize:11}}
                            onClick={function(){
                              setSelectedDates(function(prev) {
                                if (isSel) return prev.filter(function(k){ return k !== r.key; });
                                return prev.concat([r.key]).slice(-5);
                              });
                            }}
                          >
                            {isSel ? 'Remove' : 'Chart'}
                          </button>
                        </td>
                      </tr>
                    );
                    if (isExpanded) {
                      rowEls.push(
                        <tr key={r.key + '-detail'}>
                          <td colSpan={9} style={{background:'#0f1117', padding:'12px 10px'}}>
                            <div style={{display:'grid', gridTemplateColumns:'repeat(6, 1fr)', gap:8}}>
                              {HE_COLS.map(function(h) {
                                const v = r.hours[h];
                                const isSpike = v !== null && v !== undefined && v > spikeThreshold;
                                return (
                                  <div
                                    key={h}
                                    style={{background:'#171a21', border:'1px solid #272a33', borderRadius:6, padding:'6px 10px'}}
                                  >
                                    <div style={{fontSize:10, color:'#8b8f9a'}}>{h}</div>
                                    <div style={{fontSize:14, fontWeight:600, color: isSpike ? '#f1a0a0' : '#e2e4e9'}}>
                                      {formatPrice(v)}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      );
                    }
                    return <Fragment key={r.key}>{rowEls}</Fragment>;
                  })}
                </tbody>
              </table>
            </div>
          )}
          {selectedDates.length > 0 && (
            <div style={{marginTop:18}}>
              <LineChart series={selectedDates.map(function(k, i) {
                const colors = ['#5b8dee','#6ee7a0','#f0c674','#f1a0a0','#c38fe6'];
                return {
                  color: colors[i % 5],
                  label: recordsMap[k].key,
                  points: HE_COLS.map(function(h, idx) { return { x: idx, y: recordsMap[k].hours[h] }; })
                };
              })} />
            </div>
          )}
        </div>
      )}

      {tab === 'quality' && <section className="card">
        <h2>Database completeness audit</h2>
        <p>Checks calendar days between the earliest and latest stored date. HE01–HE24 are checked for missing values; HE25 is excluded because it is not a normal daily hour. Daylight-saving transition days need separate interval-level verification.</p>
        <div className="stat-grid"><div className="stat"><div className="label">Days in stored range</div><div className="val">{audit.checked}</div></div><div className="stat"><div className="label">Missing days</div><div className="val">{audit.missingDays.length}</div></div><div className="stat"><div className="label">Incomplete days</div><div className="val">{audit.incomplete.length}</div></div></div>
        <h3>Missing dates</h3><div className="scroll" style={{maxHeight:220}}>{audit.missingDays.length ? audit.missingDays.map(d=><div key={d} className="audit-line">{d} — all hours missing</div>) : <p>No gaps between stored dates.</p>}</div>
        <h3>Missing hourly values</h3><div className="scroll" style={{maxHeight:300}}>{audit.incomplete.length ? audit.incomplete.map(d=><div key={d.key} className="audit-line"><strong>{d.key}</strong> — {d.hours.join(', ')}</div>) : <p>No missing HE01–HE24 values in stored days.</p>}</div>
        <p className="insight-note">This audit does not check dates outside your stored range or confirm that CAISO delivered the correct timestamps. It is not a DST certification.</p>
      </section>}
      {tab === 'history' && <section className="card"><div className="panel-heading"><div><h3>All hourly prices — one day per row</h3><p>Scroll horizontally to view HE01–HE25. A dash means no stored price.</p></div></div><div className="scroll" style={{overflowX:'auto',maxHeight:530}}><table className="wide-hour-table"><thead><tr><th>Date</th>{HE_COLS.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{sortedList.map(r=><tr key={r.key}><td>{r.key}</td>{HE_COLS.map(h=><td key={h} className={!validPrice(r.hours[h])?'missing-price':''}>{validPrice(r.hours[h])?r.hours[h].toFixed(2):'—'}</td>)}</tr>)}</tbody></table></div></section>}
      {tab === 'analysis' && <section className="card intelligence">
        <div className="panel-heading"><div><h2>Daily price opportunities</h2><p>Identify the strongest morning and evening generation windows · MEAD day-ahead LMP ($/MWh)</p></div><select value={trendWindow} onChange={e=>setTrendWindow(Number(e.target.value))}><option value={7}>Last 7 stored days</option><option value={30}>Last 30 stored days</option><option value={90}>Last 90 stored days</option><option value={365}>Last 365 stored days</option></select></div>
        <p className="insight-note">Morning: HE07–HE12. Evening: HE17–HE22. Each day's window maximum is its single highest hourly price. Only days with all 12 window prices are compared.</p>
        <div className="stat-grid">
          <div className="stat"><div className="label">Morning peak (daily average)</div><div className="val">{formatPrice(peaks.amAvg)}</div><small>Average of each day's highest AM hour</small></div>
          <div className="stat"><div className="label">Evening peak (daily average)</div><div className="val">{formatPrice(peaks.pmAvg)}</div><small>Average of each day's highest PM hour</small></div>
          <div className="stat"><div className="label">Days AM beats PM</div><div className="val">{opp.entries.length?Math.round(opp.amWins/opp.entries.length*100)+'%':'—'}</div><small>{opp.amWins} of {opp.entries.length} comparable days</small></div>
          <div className="stat"><div className="label">PM advantage over AM</div><div className="val">{opp.avgSpread===null?'—':formatPrice(-opp.avgSpread)}</div><small>Average (PM maximum − AM maximum), $/MWh; negative means AM higher</small></div>
        </div>
        <h3>Where are the high-value hours?</h3>
        <div className="opportunity-columns"><div><h3>Morning hours · HE07–HE12</h3>{opp.amHours.slice(0,4).map((x,i)=><div className="audit-line" key={x.he}><b>{i+1}. {x.he}</b><span>{formatPrice(x.mean)} average</span></div>)}</div><div><h3>Evening hours · HE17–HE22</h3>{opp.pmHours.slice(0,4).map((x,i)=><div className="audit-line" key={x.he}><b>{i+1}. {x.he}</b><span>{formatPrice(x.mean)} average</span></div>)}</div></div>
        <h3>Is there a distinct peak?</h3>
        <label>Minimum premium above nearby shoulder hours ($/MWh) <input type="number" min="0" step="1" value={amPremium} onChange={e=>setAmPremium(Math.max(0,Number(e.target.value)||0))}/></label>
        <div className="stat-grid"><div className="stat"><div className="label">AM peak days</div><div className="val">{opp.entries.length?Math.round(opp.amPeaks.length/opp.entries.length*100)+'%':'—'}</div><small>AM maximum vs average HE05, HE06, HE13, HE14</small></div><div className="stat"><div className="label">PM peak days</div><div className="val">{opp.entries.length?Math.round(opp.pmPeaks.length/opp.entries.length*100)+'%':'—'}</div><small>PM maximum vs average HE15, HE16, HE23, HE24</small></div><div className="stat"><div className="label">Average AM peak premium</div><div className="val">{formatPrice(opp.avgAmPremium)}</div><small>Maximum AM price minus AM shoulder average</small></div><div className="stat"><div className="label">Average PM peak premium</div><div className="val">{formatPrice(opp.avgPmPremium)}</div><small>Maximum PM price minus PM shoulder average</small></div></div>
        <p className="insight-note">A premium is calculated only when all four shoulder-hour prices exist. A positive premium measures the value of targeting the peak rather than nearby hours; it is not revenue and does not account for generation limits.</p>
        <h3>Recent movement</h3><div className="opportunity-columns"><div className="trend-panel"><strong>AM daily maximum · latest 7 comparable days</strong><div>{formatPrice(opp.recentAM)}</div><small>{trendText(opp.recentAM,opp.priorAM)}</small></div><div className="trend-panel"><strong>PM daily maximum · latest 7 comparable days</strong><div>{formatPrice(opp.recentPM)}</div><small>{trendText(opp.recentPM,opp.priorPM)}</small></div></div>
        <p className="insight-note">Comparison: average of the latest 7 complete comparison days versus the preceding 14 complete days. A change is a trend, not a forecast. The selected lookback limits the days available for this comparison.</p>
        <h3>Next operating day · historical reference only</h3>
        {outlook&&outlook.matching?<><p><strong>{outlook.tomorrow}</strong> is the day after the most recent stored date, not necessarily tomorrow's calendar date. For each hour, the app averages available prices from up to 8 most recent matching weekdays. {outlook.matching} matching days found. It does not adjust for weather, demand, outages or changing market conditions.</p><div className="hour-chips">{outlookTop.map(x=><span key={x.he}>HE{String(x.he).padStart(2,'0')} <b>{formatPrice(x.price)}</b></span>)}</div><p className="insight-note">These are the five hours with the highest historical weekday average, not predicted prices. Download published CAISO day-ahead prices for the target operating day when available and use those instead.</p></>:<p>Insufficient matching-weekday history for an hourly reference.</p>}
      </section>}
      {tab === 'analysis' && (
        <div>
          {!globalStats ? (
            <div className="card"><div className="empty">No data yet.</div></div>
          ) : (
            <Fragment>
              <div className="card">
                <div className="stat-grid">
                  <div className="stat"><div className="label">Avg price</div><div className="val">{formatPrice(globalStats.avgAll)}</div></div>
                  <div className="stat"><div className="label">All-time max</div><div className="val">{formatPrice(globalStats.maxAll)}</div><small>{globalStats.maxRecord.date} · {globalStats.maxRecord.hour}</small></div>
                  <div className="stat"><div className="label">All-time min</div><div className="val">{formatPrice(globalStats.minAll)}</div><small>{globalStats.minRecord.date} · {globalStats.minRecord.hour}</small></div>
                  <div className="stat"><div className="label">Spike days</div><div className="val">{spikeDays.length}</div></div>
                </div>
              </div>
              <div className="card">
                <div className="row">
                  <label>Spike threshold ($):</label>
                  <input
                    type="number"
                    value={spikeThreshold}
                    onChange={function(e){ setSpikeThreshold(Number(e.target.value) || 0); }}
                    style={{width:90}}
                  />
                </div>
                {spikeDays.length === 0 ? (
                  <p style={{fontSize:13,color:'#8b8f9a'}}>None above threshold.</p>
                ) : (
                  <div className="scroll" style={{maxHeight:200}}>
                    <table>
                      <thead><tr><th>Date</th><th>Max</th></tr></thead>
                      <tbody>
                        {spikeDays.map(function(k) {
                          const s = computeStats(recordsMap[k].hours);
                          return (
                            <tr key={k}>
                              <td>{recordsMap[k].date}</td>
                              <td className="spike">{formatPrice(s.max)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Fragment>
          )}
        </div>
      )}

      {tab === 'heatmap' && <div className="card">
        <div className="section-heading"><div><h2>Weekly hourly price map</h2><p>Seven operating days per page · 24 hours across · each day has its own red-to-green scale.</p></div></div>
        {sortedList.length? <>
          <div className="row"><label>Week ending on stored day <select value={matrixRecord?matrixRecord.key:sortedList[0].key} onChange={e=>setMatrixDate(e.target.value)}>{sortedList.map(r=><option key={r.key} value={r.key}>{r.key}</option>)}</select></label><button onClick={()=>{const i=sortedList.findIndex(r=>r.key===(matrixRecord?matrixRecord.key:sortedList[0].key));setMatrixDate(sortedList[Math.min(sortedList.length-1,i+7)].key)}}>← Earlier week</button><button onClick={()=>{const i=sortedList.findIndex(r=>r.key===(matrixRecord?matrixRecord.key:sortedList[0].key));setMatrixDate(sortedList[Math.max(0,i-7)].key)}}>Later week →</button></div>
          <div className="week-map-scroll"><div className="week-map"><div className="week-date">Operating day</div>{Array.from({length:24},(_,i)=><div className="week-head" key={i}>HE{String(i+1).padStart(2,'0')}</div>)}<div className="week-head">Low</div><div className="week-head">High</div>
          {Array.from({length:7},(_,i)=>{const anchor=matrixRecord?matrixRecord.key:sortedList[0].key;const date=addDaysToIso(anchor,-6+i);const r=recordsMap[date];const values=r?HE_COLS.slice(0,24).map(h=>r.hours[h]).filter(validPrice):[];const lo=values.length?Math.min(...values):null,hi=values.length?Math.max(...values):null;return <React.Fragment key={date}><div className="week-date">{date}</div>{HE_COLS.slice(0,24).map(h=>{const v=r?r.hours[h]:null;return <div key={h} className="week-cell" title={`${date} ${h}: ${validPrice(v)?formatPrice(v):'Missing'}`} style={{background:validPrice(v)?heatColor(v,lo,hi):'#cbd5e1'}}>{validPrice(v)?Number(v).toFixed(0):'—'}</div>})}<div className="week-edge">{lo===null?'—':formatPrice(lo)}</div><div className="week-edge">{hi===null?'—':formatPrice(hi)}</div></React.Fragment>})}</div></div>
          <p className="insight-note">Colors are relative to each individual day; compare numeric prices to assess differences between days. The display uses HE01–HE24. Fall-back daylight-saving days may contain an additional interval not represented here.</p>
        </>:<div className="empty">No stored prices yet.</div>}
      </div>}

      {tab === 'seasonal' && <div className="card">
        <div className="section-heading"><div><h2>Seasonal and calendar patterns</h2><p>AM = HE07–HE12 · PM = HE17–HE22. Only days with all 12 comparison hours are included.</p></div></div>
        <div className="row"><label>Months to display <select value={seasonMonths} onChange={e=>setSeasonMonths(Number(e.target.value))}><option value={6}>6 months</option><option value={12}>12 months</option><option value={24}>24 months</option><option value={36}>36 months</option></select></label></div>
        <div className="opportunity-columns"><div className="trend-panel"><strong>Weekdays</strong><div>{seasonal.weekday.days} complete days</div><small>AM peak: {seasonal.weekday.am===null?'—':formatPrice(seasonal.weekday.am)} · PM peak: {seasonal.weekday.pm===null?'—':formatPrice(seasonal.weekday.pm)}<br/>PM advantage: {seasonal.weekday.diff===null?'—':formatPrice(seasonal.weekday.diff)} · AM wins: {seasonal.weekday.amWins}</small></div><div className="trend-panel"><strong>Weekends</strong><div>{seasonal.weekend.days} complete days</div><small>AM peak: {seasonal.weekend.am===null?'—':formatPrice(seasonal.weekend.am)} · PM peak: {seasonal.weekend.pm===null?'—':formatPrice(seasonal.weekend.pm)}<br/>PM advantage: {seasonal.weekend.diff===null?'—':formatPrice(seasonal.weekend.diff)} · AM wins: {seasonal.weekend.amWins}</small></div></div>
        <h3>Explore a month</h3><p className="insight-note">Select a month to see its average daily AM and PM peaks, PM advantage, and how often AM exceeds PM. Based on the last {seasonMonths} months.</p>
        <div className="row">{MONTH_ABBR.map((label,i)=><button key={i} className={selectedMonth===i?'':'ghost'} onClick={()=>setSelectedMonth(selectedMonth===i?null:i)}>{label}</button>)}</div>
        {selectedMonth!==null&&(()=>{const rows=completePeakRows(records).filter(r=>Number(r.date.slice(5,7))===selectedMonth+1);const a=average(rows.map(r=>r.am)),b=average(rows.map(r=>r.pm));return <div className="month-detail"><button onClick={()=>setSelectedMonth(null)} style={{float:'right'}}>Close</button><h3>{new Date(Date.UTC(2024,selectedMonth,1)).toLocaleString('en-US',{month:'long',timeZone:'UTC'})} across all stored years</h3><HourlyBoxPlot records={records} month={selectedMonth} label={'Hourly price distribution · '+new Date(Date.UTC(2024,selectedMonth,1)).toLocaleString('en-US',{month:'long',timeZone:'UTC'})+' · all years'}/><p>Based on {rows.length} days with complete AM/PM prices · AM peak average: {formatPrice(a)} · PM peak average: {formatPrice(b)} · PM advantage: {a===null||b===null?'—':formatPrice(b-a)} · AM higher on {rows.filter(r=>r.am>r.pm).length} days.</p><p>Calculated using the maximum price in HE07–HE12 and HE17–HE22 for each complete day in this calendar month.</p></div>})()}
        <h3>Monthly AM / PM peak comparison</h3>
        <div className="scroll"><table><thead><tr><th>Month</th><th>Complete days</th><th>Average AM peak</th><th>Average PM peak</th><th>PM advantage</th><th>AM higher (days)</th></tr></thead><tbody>{seasonal.monthly.map(m=><tr key={m.month}><td>{m.month}</td><td>{m.days}</td><td>{m.am===null?'—':formatPrice(m.am)}</td><td>{m.pm===null?'—':formatPrice(m.pm)}</td><td>{m.diff===null?'—':formatPrice(m.diff)}</td><td>{m.amWins} / {m.days}</td></tr>)}</tbody></table></div>
        <h3>Year-over-year monthly peak prices</h3>
        <p className="insight-note">Each line is one year, January through December. Dashed/faded segments mark months built from fewer than 5 complete days — treat those points cautiously. The bar strip shows sample size per month across all years combined.</p>
        {(()=>{
          const years=[...new Set(yoy.map(r=>r.year))].sort((a,b)=>b-a).slice(0,5);
          const palette=['#65b8fa','#f2b56d','#8de39c','#e38da8','#c3a0f2'];
          const amSeries=years.map((year,i)=>({name:String(year)+' AM',color:palette[i%palette.length],points:Array.from({length:12},(_,m)=>{const r=yoy.find(x=>x.year===year&&x.month===m+1);return {x:m,value:r?r.am:null,n:r?r.days:0};})}));
          const diffSeries=years.map((year,i)=>({name:String(year),color:palette[i%palette.length],points:Array.from({length:12},(_,m)=>{const r=yoy.find(x=>x.year===year&&x.month===m+1);return {x:m,value:r?r.diff:null,n:r?r.days:0};})}));
          return <>
            <PriceLineChart title="AM peak by month, all years overlaid" monthMode minN={5} series={amSeries}/>
            <PriceLineChart title="PM advantage (PM − AM) by month, all years overlaid" monthMode minN={5} showCounts series={diffSeries}/>
          </>;
        })()}
        <h3>Rolling AM / PM peak trends</h3>
        <p className="insight-note">Window applies to both the trend line and the change cards below: change compares the most recent complete window against the immediately preceding non-overlapping window of the same size. Missing dates are skipped — "days" means complete comparison days, not calendar days.</p>
        <div className="row"><label>Rolling window <select value={rollingWindow} onChange={e=>setRollingWindow(Number(e.target.value))}>{[7,14,30,90,365].map(n=><option key={n} value={n}>{n}-day rolling average</option>)}</select></label></div>
        <div className="opportunity-columns">{rolling.change.length?rolling.change.map(c=><div className="trend-panel" key={c.key}><strong>{({am:'AM peak',pm:'PM peak',diff:'PM advantage'})[c.key]}</strong><div>{c.delta>=0?'+':''}{formatPrice(c.delta)}</div><small>{c.pct===null?'% unavailable':`${c.pct>=0?'+':''}${c.pct.toFixed(1)}%`} · {Math.abs(c.delta)<0.01?'Flat':c.delta>0?'Strengthening':'Weakening'}</small></div>):<p className="insight-note">Need at least {rollingWindow*2} complete comparison days for a period-over-period indicator at this window size.</p>}</div>
        <PriceLineChart title={`${rollingWindow}-day rolling AM and PM peaks`} series={[{name:'AM peak',color:'#65b8fa',points:rolling.points.slice(-120).map((r,i)=>({x:i,value:r.am}))},{name:'PM peak',color:'#f2b56d',points:rolling.points.slice(-120).map((r,i)=>({x:i,value:r.pm}))}]}/>
        <h3>Holiday versus ordinary days</h3>
        <p className="insight-note">Major US federal holidays are classified by actual date or observed weekday. Holiday dates are excluded from the ordinary weekday/weekend groups. Only complete AM/PM days are compared; small holiday samples may be unreliable.</p>
        <div className="scroll"><table><thead><tr><th>Day type</th><th>Days</th><th>AM peak average</th><th>PM peak average</th><th>PM advantage</th></tr></thead><tbody>{holidayStats.groups.map(g=><tr key={g.key}><td>{{weekday:'Ordinary weekday',weekend:'Ordinary weekend',actual:'Actual holiday',observed:'Observed holiday'}[g.key]}</td><td>{g.days}</td><td>{formatPrice(g.am)}</td><td>{formatPrice(g.pm)}</td><td>{formatPrice(g.diff)}</td></tr>)}</tbody></table></div>
        <details><summary>See classified holiday dates ({holidayStats.holidayDays.length})</summary><div className="scroll" style={{maxHeight:230}}><table><thead><tr><th>Date</th><th>Holiday</th><th>Classification</th><th>AM</th><th>PM</th></tr></thead><tbody>{holidayStats.holidayDays.map(r=><tr key={r.date}><td>{r.date}</td><td>{r.name}</td><td>{r.kind}</td><td>{formatPrice(r.am)}</td><td>{formatPrice(r.pm)}</td></tr>)}</tbody></table></div></details>
        <h3>Hourly price distribution — box plots</h3><p className="insight-note">Each box shows the middle 50% of observed prices (25th–75th percentile), the median line, and whiskers from minimum to maximum. Compare stable high-value hours with hours that spike only occasionally.</p>
        <div className="row"><label>Period <select value={boxPeriod} onChange={e=>setBoxPeriod(e.target.value)}><option value="7">Last 7 calendar days</option><option value="14">Last 14 calendar days</option><option value="30">Last 30 calendar days</option><option value="90">Last 90 calendar days</option><option value="365">Last 365 calendar days</option></select></label></div>
        <HourlyBoxPlot records={records} days={Number(boxPeriod)}/>
        <h3>How the trend is changing</h3>
        <p className="insight-note">Compare adjacent months to see whether PM advantage is rising or falling. For seasonal conclusions, compare the same month across different years: a single month-to-month change may be normal seasonality. Holidays are classified separately above.</p>
      </div>}


      {tab === 'visuals' && <div className="card">
        <div className="section-heading"><div><h2>PM premium by calendar month and day</h2><p>PM peak minus AM peak, averaged across all available years. Positive values mean evening prices were higher.</p></div></div>
        <div className="month-card-grid">{Array.from({length:12},(_,i)=><button key={i} className={'month-card '+(opMonth===i?'month-active':'')} onClick={()=>{setOpMonth(i);setSelectedCalendarDay(null)}}>{new Date(Date.UTC(2024,i,1)).toLocaleString('en-US',{month:'long',timeZone:'UTC'})}</button>)}</div>
        <h3>{new Date(Date.UTC(2024,opMonth,1)).toLocaleString('en-US',{month:'long',timeZone:'UTC'})} · all stored years</h3>
        <OpportunityCalendar rows={opportunityData} month={opMonth} onDay={setSelectedCalendarDay}/>
        {selectedCalendarDay&&<div className="focus-detail"><div className="panel-heading"><h3>{new Date(Date.UTC(2024,opMonth,selectedCalendarDay.day)).toLocaleString('en-US',{month:'long',day:'numeric',timeZone:'UTC'})} · all years</h3><button onClick={()=>setSelectedCalendarDay(null)}>Close</button></div><p>Average AM peak: {formatPrice(selectedCalendarDay.am)} · Average PM peak: {formatPrice(selectedCalendarDay.pm)} · PM premium: {formatPrice(selectedCalendarDay.premium)} · PM higher on {selectedCalendarDay.pmWins} of {selectedCalendarDay.n} days.</p><div className="detail-table"><table><thead><tr><th>Date</th><th>AM peak</th><th>AM hour</th><th>PM peak</th><th>PM hour</th><th>PM premium</th></tr></thead><tbody>{selectedCalendarDay.rs.map(r=><tr key={r.date}><td>{r.date}</td><td>{formatPrice(r.am.price)}</td><td>HE{r.am.hour}</td><td>{formatPrice(r.pm.price)}</td><td>HE{r.pm.hour}</td><td>{formatPrice(r.pm.price-r.am.price)}</td></tr>)}</tbody></table></div></div>}
        <h2>Hourly Price Probability</h2><p className="insight-note">How frequently does each hour exceed a price level? Choose a threshold and lookback period.</p>
        <div className="row"><label>Price threshold ($/MWh) <select value={probThreshold} onChange={e=>setProbThreshold(Number(e.target.value))}>{[25,50,75,100,150,200].map(v=><option key={v} value={v}>${v}</option>)}</select></label><label>Lookback <select value={probDays} onChange={e=>setProbDays(Number(e.target.value))}>{[7,14,30,90,365].map(v=><option key={v} value={v}>Last {v} calendar days</option>)}</select></label></div>
        <ProbabilityChart records={records} threshold={probThreshold} days={probDays} onHour={setFocusHour}/>
        <h2>Peak-Hour Migration</h2><p className="insight-note">See whether the highest-priced morning and evening hours are shifting earlier or later.</p>
        <div className="row"><label>Lookback <select value={migrationDays} onChange={e=>setMigrationDays(Number(e.target.value))}>{[30,90,180,365,730].map(v=><option key={v} value={v}>Last {v} calendar days</option>)}</select></label></div>
        <MigrationChart rows={opportunityData} windowDays={migrationDays} onWeek={setSelectedWeek}/>
        {selectedWeek&&<div className="focus-detail"><div className="panel-heading"><h3>Week beginning {selectedWeek}</h3><button onClick={()=>setSelectedWeek(null)}>Close</button></div><p>Individual daily peak-hour observations underlying this weekly mean:</p><div className="detail-table"><table><thead><tr><th>Date</th><th>AM peak hour</th><th>AM price</th><th>PM peak hour</th><th>PM price</th></tr></thead><tbody>{opportunityData.filter(r=>{const d=new Date(r.date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-d.getUTCDay());return d.toISOString().slice(0,10)===selectedWeek}).map(r=><tr key={r.date}><td>{r.date}</td><td>HE{r.am.hour}</td><td>{formatPrice(r.am.price)}</td><td>HE{r.pm.hour}</td><td>{formatPrice(r.pm.price)}</td></tr>)}</tbody></table></div></div>}
        {focusHour&&<HourDetail records={records} hour={focusHour} threshold={probThreshold} onClose={()=>setFocusHour(null)}/>}
        <p className="insight-note">All charts use local MEAD day-ahead prices. Missing AM/PM hours exclude a day from the calendar and migration analysis. These are descriptive historical patterns, not tomorrow's published prices.</p>
      </div>}

      {tab === 'regimes' && <div className="card">
        <div className="section-heading"><div><h2>Day-type regime detection</h2><p>Groups historical days by price shape (level, volatility, midday dip, evening ramp, peak timing) using K-means clustering on z-scored features. No weather or solar data is available in this app, so regimes are derived and labeled from price behavior only — a label like "Midday dip" describes the price pattern, not a confirmed weather cause.</p></div></div>
        <PeriodPicker records={records} period={regimePeriod} onChange={setRegimePeriod}/>
        <p className="insight-note">Currently analyzing: <b>{periodLabel(regimePeriod)}</b> ({regimeFiltered.length} stored days in this selection). Choose "Specific year" to compare one year's regimes against another, or "All data" for the complete combined picture.</p>
        <div className="row"><label>Number of regimes (k) <select value={regimeK} onChange={e=>setRegimeK(Number(e.target.value))}>{[3,4,5,6,7].map(k=><option key={k} value={k}>{k}</option>)}</select></label><button className="ghost" onClick={()=>setShowElbow(s=>!s)}>{showElbow?'Hide':'Show'} elbow chart (choosing k)</button></div>
        {showElbow && <div className="chart-panel"><strong>Elbow method — inertia by k</strong><p className="insight-note">Inertia measures how tightly days cluster around their regime's center; it always decreases as k grows. Look for the point where adding another regime stops helping much (the "elbow") rather than picking the lowest value.</p>{elbow.length?<PlotlyChart traces={[{type:'scatter',mode:'lines+markers',x:elbow.map(e=>e.k),y:elbow.map(e=>e.inertia),line:{color:'#35c4ae',width:2.5},marker:{size:7},hovertemplate:'k=%{x}<br>inertia %{y:.1f}<extra></extra>'}]} layout={{height:240,xaxis:{title:'k',dtick:1},yaxis:{title:'Inertia'}}} height={240} style={{maxWidth:500}}/>:<p className="insight-note">Not enough complete days to compute an elbow chart.</p>}</div>}
        {!regimeResult ? <div className="empty">Not enough complete days ({'need at least '+(regimeK*3)}) with 20+ valid hourly prices to run regime detection at this k, for this period. Try a smaller k, a wider period, or import more data.</div> : <>
          <p className="insight-note">Based on {regimeResult.totalDays} days with at least 20 valid hourly prices. Regimes are sorted by frequency (most common first).</p>
          <div className="opportunity-columns">{regimeResult.clusters.map(c=><div key={c.id} className="trend-panel interactive" onClick={()=>setSelectedRegime(selectedRegime===c.id?null:c.id)} style={{cursor:'pointer',outline:selectedRegime===c.id?'2px solid #35c4ae':undefined}}><strong>{c.label}</strong><div style={{fontSize:16}}>{c.n} days <small style={{fontSize:11,color:'#9cb3c4'}}>({(c.n/regimeResult.totalDays*100).toFixed(0)}%)</small></div><small>Avg price {formatPrice(c.avgPrice)} · Avg peak {formatPrice(c.avgPeak)} · Avg spread {formatPrice(c.avgSpread)} · {Math.round(c.weekendShare*100)}% weekend/holiday</small></div>)}</div>
          {selectedRegime!==null && (()=>{const c=regimeResult.clusters.find(x=>x.id===selectedRegime);if(!c)return null;const recent=[...c.members].sort((a,b)=>b.key.localeCompare(a.key)).slice(0,20);return <div className="focus-detail"><div className="panel-heading"><h3>{c.label} · {c.n} matching days</h3><button onClick={()=>setSelectedRegime(null)}>Close</button></div><p>Centroid shape (regime average): daily average {formatPrice(c.centroid[0])} · peak {formatPrice(c.centroid[1])} · off-peak {formatPrice(c.centroid[2])} · volatility (std dev) {formatPrice(c.centroid[3])} · spread {formatPrice(c.centroid[4])} · midday deviation from daily average {formatPrice(c.centroid[5])} · evening ramp (HE17-19 minus HE15-16) {formatPrice(c.centroid[6])} · typical peak hour HE{Math.round(c.centroid[7])}.</p><div className="detail-table"><table><thead><tr><th>Date</th><th>Avg</th><th>Peak</th><th>Spread</th><th>Peak hour</th></tr></thead><tbody>{recent.map(m=><tr key={m.key}><td>{m.key}</td><td>{formatPrice(m.avg)}</td><td>{formatPrice(m.peak)}</td><td>{formatPrice(m.spread)}</td><td>HE{String(m.peakHourIdx).padStart(2,'0')}</td></tr>)}</tbody></table></div><p className="insight-note">Showing up to 20 most recent matching days of {c.n} total. Use this regime's typical shape to anticipate similar days and tailor bidding or release timing accordingly.</p></div>;})()}
        </>}

        <div className="section-heading" style={{marginTop:28}}><div><h2>Price-duration curves & tail risk</h2><p>Ranks each season's hourly prices from highest to lowest, and quantifies how extreme the top percentiles get using Conditional Value at Risk (CVaR) — the average price of hours at or above a given percentile threshold. Uses the same period selection as regime detection above.</p></div></div>
        {seasonCurves.length? <PriceDurationChart curves={seasonCurves}/> : <div className="empty">No stored prices yet in this period.</div>}
        {seasonCurves.map(c=><div key={c.key} className="card" style={{marginTop:14}}>
          <h3 style={{color:c.color}}>{c.name}</h3>
          <p className="insight-note">{c.stats.n.toLocaleString()} hourly observations.</p>
          <div className="scroll"><table><thead><tr><th>Percentile</th><th>Threshold</th><th>Hours at/above</th><th>% of hours</th><th>CVaR (avg price in that tail)</th></tr></thead><tbody>{c.stats.cvar.map(row=><tr key={row.p}><td>P{row.p}</td><td>{formatPrice(row.threshold)}</td><td>{row.count}</td><td>{row.pctOfHours.toFixed(2)}%</td><td className={row.p>=95?'spike':''}>{formatPrice(row.cvar)}</td></tr>)}</tbody></table></div>
        </div>)}
        <p className="insight-note">CVaR at P99 answers: "when prices spike into the top 1% of hours, what's the average price of that spike?" A high CVaR relative to the P99 threshold means the tail is heavy — when spikes happen, they tend to be severe, which raises the value of holding generation capacity in reserve for those hours. This is historical descriptive risk, not a forecast or a guarantee of future spike magnitude or frequency.</p>
      </div>}

      {tab === 'explore' && <div className="card">
        <div className="section-heading"><div><h2>Explore & dataset statistics</h2><p>Pick a period below — all charts and the summary panel on this tab update together. Use this to understand overall dataset behavior: which months/years run high or low, typical daily shape, and volatility over time.</p></div></div>
        <PeriodPicker records={records} period={explorePeriod} onChange={setExplorePeriod}/>
        <p className="insight-note">Currently showing: <b>{periodLabel(explorePeriod)}</b> ({exploreFiltered.length} stored days in this selection).</p>
        {exploreFiltered.length===0 ? <div className="empty">No stored days in this selection.</div> : <>
          <SummaryStatsPanel records={exploreFiltered}/>
          <DailyAverageWithMeanChart records={exploreFiltered}/>
          <VolatilityChart records={exploreFiltered}/>
          <PriceHistogramChart records={exploreFiltered}/>
          <MonthlyBoxChart records={exploreFiltered}/>
          <HourOfDayChart records={exploreFiltered}/>
          <MonthHourHeatmapChart records={exploreFiltered}/>
        </>}
      </div>}

      {tab === 'settings' && (
        <div className="card">
          <p style={{marginTop:0, fontSize:13, color:'#8b8f9a'}}>Database location</p>
          <p style={{fontSize:13}}>{dbPath}</p>
          <button onClick={handlePickDb}>Change Database Location</button>
          <p style={{fontSize:11, color:'#6b6f7a', marginTop:16}}>
            Changing this points the app at a different file — won't move existing data. To share history with teammates, point everyone at the same network path.
          </p>
        </div>
      )}
      {detail&&<div className="modal-backdrop" onClick={()=>setDetail(null)}><div className="detail-modal" onClick={e=>e.stopPropagation()}><div className="modal-heading"><h2>{detail.title}</h2><button onClick={()=>setDetail(null)}>✕ Close</button></div><p>{detail.body}</p>{detail.chart&&<div className="modal-chart" dangerouslySetInnerHTML={{__html:detail.chart}}/>}{detail.chart&&<button onClick={()=>{const svg=detail.chart.replace('<svg ','<svg xmlns="http://www.w3.org/2000/svg" ');const blob=new Blob([svg],{type:'image/svg+xml'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='hoover-mead-chart.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}}>↓ Download chart (SVG)</button>}</div></div>}
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
