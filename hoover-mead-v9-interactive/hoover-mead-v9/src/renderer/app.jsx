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
  return [...by].map(([key,a])=>({year:Number(key.slice(0,4)),month:Number(key.slice(5,7)),days:a.length,am:average(a.map(r=>r.am)),pm:average(a.map(r=>r.pm))}));
}
function PriceLineChart({series,title}){
  const width=840,height=260,pad=42;
  const all=series.flatMap(s=>s.points.map(p=>p.value)).filter(validPrice);
  if(!all.length)return <p className="insight-note">Not enough complete price history for this chart.</p>;
  let lo=Math.min(...all),hi=Math.max(...all);if(lo===hi){lo-=1;hi+=1;}
  const maxX=Math.max(1,...series.map(s=>Math.max(0,...s.points.map(p=>p.x))));
  const x=v=>pad+(width-2*pad)*v/maxX,y=v=>height-pad-(v-lo)/(hi-lo)*(height-2*pad);
  return <div className="chart-panel"><strong>{title}</strong><div className="chart-legend">{series.map(s=><span key={s.name} style={{color:s.color}}>● {s.name}</span>)}</div><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} style={{width:'100%',height:'auto'}}>{[0,1,2,3,4].map(i=>{const v=lo+(hi-lo)*i/4;return <g key={i}><line x1={pad} x2={width-pad} y1={y(v)} y2={y(v)} stroke="#34404e"/><text x="3" y={y(v)+4} fill="#b6c4d0">${v.toFixed(0)}</text></g>})}{series.map(s=><polyline key={s.name} fill="none" stroke={s.color} strokeWidth="3" strokeLinejoin="round" points={s.points.map(p=>`${x(p.x)},${y(p.value)}`).join(' ')}/>)}{Array.from({length:Math.min(12,maxX+1)},(_,i)=>{const index=Math.round(i*maxX/Math.max(1,Math.min(12,maxX+1)-1));return <text key={i} x={x(index)} y={height-12} textAnchor="middle" fill="#b6c4d0">{maxX<=11?index+1:index}</text>})}</svg></div>;
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

function LineChart(props) {
  const series = props.series;
  const width = props.width || 1100;
  const height = props.height || 260;
  const pad = { l: 48, r: 16, t: 10, b: 26 };
  const allY = series.flatMap(function(s) { return s.points.map(function(p) { return p.y; }); })
    .filter(function(v) { return v !== null && v !== undefined && !isNaN(v); });
  if (allY.length === 0) return <div className="empty">No data to chart</div>;
  const yMin = Math.min(0, Math.min.apply(null, allY));
  const yMax = Math.max.apply(null, allY) * 1.08;
  const xScale = function(i) { return pad.l + (i/24) * (width - pad.l - pad.r); };
  const yScale = function(v) { return height - pad.b - ((v - yMin)/(yMax - yMin || 1)) * (height - pad.t - pad.b); };

  const yTicks = [];
  for (let i = 0; i <= 5; i++) {
    const v = yMin + (yMax-yMin)*i/5;
    yTicks.push({ v: v, y: yScale(v) });
  }
  const xTicks = [0,4,8,12,16,20,24];

  return (
    <svg width="100%" viewBox={'0 0 ' + width + ' ' + height}>
      {yTicks.map(function(t, i) {
        return (
          <g key={i}>
            <line x1={pad.l} y1={t.y} x2={width-pad.r} y2={t.y} stroke="#21242d" strokeWidth="1" />
            <text x={pad.l-8} y={t.y+3} textAnchor="end" fill="#8b8f9a" fontSize="10">{t.v.toFixed(0)}</text>
          </g>
        );
      })}
      {xTicks.map(function(i) {
        return <text key={i} x={xScale(i)} y={height-6} textAnchor="middle" fill="#8b8f9a" fontSize="10">{'HE' + (i+1)}</text>;
      })}
      {series.map(function(s, si) {
        const pts = s.points.filter(function(p) { return p.y !== null && p.y !== undefined && !isNaN(p.y); });
        const path = pts.map(function(p, i) { return (i===0?'M':'L') + xScale(p.x) + ',' + yScale(p.y); }).join(' ');
        return <path key={si} d={path} fill="none" stroke={s.color} strokeWidth={s.width || 2} />;
      })}
    </svg>
  );
}


function DailyBarChart({days}) {
  const width=1000,height=300,pad={l:62,r:15,t:18,b:58};
  const vals=days.map(r=>{const st=computeStats(r.hours);return st?st.avg:null;});
  const usable=vals.filter(validPrice);
  if(!usable.length)return <div className="empty">No daily averages available</div>;
  const lo=Math.min(0,...usable),hi=Math.max(0,...usable);
  const scale=v=>pad.t+(hi-v)/(hi-lo||1)*(height-pad.t-pad.b);
  const zero=scale(0),inner=width-pad.l-pad.r,step=inner/days.length,bar=Math.max(3,step*.68);
  return <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Daily average price bar chart, dollars per megawatt-hour">
    {[0,1,2,3,4].map(i=>{const v=lo+(hi-lo)*i/4,y=scale(v);return <g key={i}><line x1={pad.l} y1={y} x2={width-pad.r} y2={y} stroke="#303746"/><text x={pad.l-9} y={y+4} textAnchor="end" fill="#9ba5b4" fontSize="12">{v.toFixed(0)}</text></g>})}
    {days.map((r,i)=>{const v=vals[i];if(!validPrice(v))return null;const x=pad.l+i*step+(step-bar)/2,y=scale(v);return <g key={r.key}><rect x={x} y={Math.min(y,zero)} width={bar} height={Math.max(1,Math.abs(zero-y))} rx="2" fill={v>=0?'#35c4ae':'#ed8b7c'}><title>{r.key}: {formatPrice(v)}/MWh</title></rect>{(i%Math.max(1,Math.ceil(days.length/9))===0||i===days.length-1)&&<text x={x+bar/2} y={height-24} textAnchor="end" transform={`rotate(-35 ${x+bar/2} ${height-24})`} fontSize="11" fill="#9ba5b4">{r.key.slice(5)}</text>}</g>})}
  </svg>;
}

function HourlyBoxPlot({records,days}){
 const sorted=[...records].sort((a,b)=>b.key.localeCompare(a.key));const cutoff=sorted.length?addDaysToIso(sorted[0].key,-days+1):'';
 const included=sorted.filter(r=>r.key>=cutoff);
 const quantile=(arr,q)=>{if(!arr.length)return null;const n=(arr.length-1)*q,lo=Math.floor(n),hi=Math.ceil(n);return arr[lo]+(arr[hi]-arr[lo])*(n-lo)};
 const stats=HE_COLS.slice(0,24).map((h,i)=>{const v=included.map(r=>r.hours[h]).filter(validPrice).sort((a,b)=>a-b);return {h,i,n:v.length,min:v[0],q1:quantile(v,.25),med:quantile(v,.5),q3:quantile(v,.75),max:v[v.length-1]}}).filter(s=>s.n);
 if(!stats.length)return <p>No hourly data in this period.</p>;
 let lo=Math.min(...stats.map(s=>s.min)),hi=Math.max(...stats.map(s=>s.max));if(hi===lo)hi=lo+1;
 const y=v=>230-(v-lo)/(hi-lo)*195;
 return <div className="chart-panel"><strong>Hourly price box plots ({included.length} stored days)</strong><svg viewBox="0 0 950 285" style={{width:'100%'}} role="img" aria-label="Hourly price box plots">{stats.map(s=>{const x=38+s.i*37;return <g key={s.h}><line x1={x} x2={x} y1={y(s.min)} y2={y(s.max)} stroke="#64748b" strokeWidth="2"/><rect x={x-10} y={y(s.q3)} width="20" height={Math.max(1,y(s.q1)-y(s.q3))} fill="#3b82b6" opacity=".8"/><line x1={x-10} x2={x+10} y1={y(s.med)} y2={y(s.med)} stroke="#f59e0b" strokeWidth="3"/><text x={x} y="254" fontSize="11" textAnchor="middle">{s.i+1}</text><title>{s.h}: n={s.n}, min={formatPrice(s.min)}, Q1={formatPrice(s.q1)}, median={formatPrice(s.med)}, Q3={formatPrice(s.q3)}, max={formatPrice(s.max)}</title></g>})}<text x="8" y="18" fontSize="12">$/MWh</text></svg><p className="insight-note">Hover over an hour to see exact quartiles and sample size. Click to enlarge; export from the expanded view.</p></div>
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
  // No hypothetical MWh allocation in this version.

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

  const seasonal = useMemo(()=>seasonalSummary(records,seasonMonths),[records,seasonMonths]);
  const trends = useMemo(()=>trendInsights(records,seasonMonths),[records,seasonMonths]);
  const holidayStats = useMemo(()=>holidayAnalysis(records,seasonMonths),[records,seasonMonths]);
  const rolling7 = useMemo(()=>rollingAnalysis(records,7),[records]);
  const rolling30 = useMemo(()=>rollingAnalysis(records,30),[records]);
  const yoy = useMemo(()=>yearMonthSeries(records),[records]);
  const matrixRecord = useMemo(()=>records.find(r=>r.key===matrixDate)||[...records].sort((a,b)=>b.key.localeCompare(a.key))[0]||null,[records,matrixDate]);
  const audit = useMemo(()=>dayAudit(records),[records]);
  const peaks = useMemo(()=>peakAnalysis(records,trendWindow),[records,trendWindow]);
  const outlook = useMemo(()=>tomorrowOutlook(records),[records]);
  const opp = useMemo(()=>opportunity(records,trendWindow,amPremium),[records,trendWindow,amPremium]);
  const releaseDays = useMemo(()=>[...records].sort((a,b)=>b.key.localeCompare(a.key)),[records]);

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
  const chartDays = sortedList.slice(0, 30).reverse();
  const peakHours = latest ? HE_COLS.map(function(h){return {hour:h,price:latest.hours[h]};}).filter(function(x){return typeof x.price === 'number' && Number.isFinite(x.price);}).sort(function(a,b){return b.price-a.price;}).slice(0,5) : [];
  return (
    <div className={"app shell theme-"+theme}>
      <aside className="sidebar">
        <div className="brand"><div className="brand-icon">≋</div><div><strong>HOOVER<span> / </span>MEAD</strong><small>ENERGY INTELLIGENCE</small></div></div>
        <div className="side-label">WORKSPACE</div>
        <nav className="side-nav">
          {[['dashboard','◫','Overview'],['import','↓','Download prices'],['history','▤','Historical data'],['analysis','⌁','Price analysis'],['heatmap','▦','Daily price map'],['seasonal','▥','Seasonal trends'],['quality','✓','Data quality']].map(function(item){return <button key={item[0]} className={'nav-item'+(tab===item[0]?' selected':'')} onClick={function(){setTab(item[0]);}}><span className="nav-symbol">{item[1]}</span>{item[2]}</button>;})}
        </nav>
        <div className="sidebar-bottom"><div className="node-pill"><span className="live-dot"></span> CAISO · MEADS_2_N101</div><button className={'nav-item'+(tab==='settings'?' selected':'')} onClick={function(){setTab('settings');}}>⚙ &nbsp; Settings</button></div>
      </aside>
      <main className="main-panel" onClickCapture={e=>{const chart=e.target.closest('.chart-panel,.chart-card');if(chart&&!e.target.closest('button,select,input')){setDetail({title:chart.querySelector('strong,h3')?.textContent||'Price chart',chart:chart.querySelector('svg')?.outerHTML||null,body:'Values are calculated from stored MEAD hourly prices. Hover over chart elements for additional values.'});}}}>
      <header className="topbar"><div><div className="eyebrow">HOOVER DAM / LAKE MEAD</div><h1>{({dashboard:'Energy price overview',import:'Download CAISO prices',history:'Historical price library',analysis:'Market price analysis',heatmap:'One-day price map',seasonal:'Seasonal trends',quality:'Database completeness',settings:'Application settings'})[tab]}</h1><div className="sub">Day-ahead locational marginal prices · Pacific operating time</div></div><div className="top-actions"><span className="data-count">{records.length.toLocaleString()} days stored{records.length?` · ${sortedList[sortedList.length-1].key} to ${sortedList[0].key}`:''}</span><button className="theme-switch" onClick={()=>setTheme(theme==='light'?'dark':'light')}>{theme==='light'?'☾ Dark mode':'☀ Light mode'}</button><button onClick={function(){setTab('import');}}>↓ Download data</button></div></header>
      {tab === 'dashboard' && <section className="dashboard">
        <div className="section-heading"><div><h2>Market snapshot</h2><p>{latest ? 'Latest available operating day: '+latest.date : 'Connect your database and download prices to populate the dashboard'}</p></div><span className="source-tag">SOURCE · CAISO DAY-AHEAD</span></div>
        <div className="kpi-grid">
          <div className="kpi interactive" onClick={()=>setDetail({title:"Average historical price",body:"Arithmetic mean of all valid hourly prices in the stored data. Missing hourly prices are excluded. This is not a volume-weighted generation price."})}><span>Average historical price</span><strong>{globalStats?formatPrice(globalStats.avgAll):'—'}</strong><small>$/MWh · stored days</small></div>
          <div className="kpi interactive" onClick={()=>setDetail({title:"Latest daily peak",body:"Highest available hourly MEAD price on the latest stored operating day; the operating date and hour ending appear below the number."})}><span>Latest daily peak</span><strong>{latestStats?formatPrice(latestStats.max):'—'}</strong><small>{latestStats?'On '+latest.key+' · '+latestStats.peakHour:'No prices loaded'}</small></div>
          <div className="kpi interactive" onClick={()=>setDetail({title:"Latest daily spread",body:"Highest minus lowest hourly price for the latest stored operating day. This measures price variation, not achievable generation revenue."})}><span>Latest daily spread</span><strong>{latestStats?formatPrice(latestStats.max-latestStats.min):'—'}</strong><small>Maximum minus minimum</small></div>
          <div className="kpi interactive" onClick={()=>setDetail({title:"Historical data coverage",body:records.length?`${records.length} stored operating-day records, from ${sortedList[sortedList.length-1].key} through ${sortedList[0].key}. This count does not guarantee that every intervening day or hour is complete; check Data Quality.`:"No stored days."})}><span>Historical days</span><strong>{records.length.toLocaleString()}</strong><small>{records.length?`${sortedList[sortedList.length-1].key} → ${sortedList[0].key}`:"Available in local database"}</small></div>
        </div>
        <div className="dashboard-grid"><div className="card chart-card"><div className="panel-heading"><div><h3>Recent daily average prices</h3><p>Up to 30 most recent stored operating days</p></div><span className="unit-label">$/MWh</span></div>{chartDays.length?<DailyBarChart days={chartDays}/>:<div className="empty">No historical prices yet. Download CAISO data to see price trends.</div>}</div>
        <div className="card insight-card"><div className="panel-heading"><div><h3>High-value hours</h3><p>{latest?'Highest prices on '+latest.date:'Latest available day'}</p></div></div>{peakHours.length?peakHours.map(function(item,i){return <div className="rank-row" key={item.hour}><span className="rank">{String(i+1).padStart(2,'0')}</span><strong>{item.hour}</strong><div className="rank-bar"><i style={{width:(Math.max(0,item.price)/Math.max(1,peakHours[0].price)*100)+'%'}}></i></div><b>{formatPrice(item.price)}</b></div>}):<div className="empty">No hourly prices available.</div>}<div className="insight-note">Indicative price ranking only. Release schedules must also consider operating constraints.</div></div></div>
        <div className="card action-card"><div><h3>Explore your price history</h3><p>Compare historical periods, investigate volatility and identify recurring high-price hours.</p></div><div className="action-buttons"><button className="ghost" onClick={function(){setTab('history');}}>View history →</button><button onClick={function(){setTab('analysis');}}>Open analysis →</button></div></div>
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
        <h3>Explore a month</h3><p className="insight-note">Select a month to see its average daily AM and PM peaks, PM advantage, and how often AM exceeds PM.</p>
        <div className="month-card-grid">{Array.from({length:12},(_,i)=>{const m=seasonal.monthly.find(x=>Number(String(x.month).slice(-2))===i+1 || String(x.month).toLowerCase().startsWith(new Date(Date.UTC(2024,i,1)).toLocaleString('en-US',{month:'short'}).toLowerCase()));return <button className="month-card" key={i} onClick={()=>setSelectedMonth(i)}>{new Date(Date.UTC(2024,i,1)).toLocaleString('en-US',{month:'long'})}<small>{m&&m.days?`${m.days} complete days`:'Select for details'}</small></button>})}</div>
        {selectedMonth!==null&&(()=>{const rows=completePeakRows(records).filter(r=>Number(r.date.slice(5,7))===selectedMonth+1);const a=average(rows.map(r=>r.am)),b=average(rows.map(r=>r.pm));return <div className="month-detail"><button onClick={()=>setSelectedMonth(null)} style={{float:'right'}}>Close</button><h3>{new Date(Date.UTC(2024,selectedMonth,1)).toLocaleString('en-US',{month:'long'})} across all stored years</h3><p>{rows.length} complete AM/PM days · AM peak average: {formatPrice(a)} · PM peak average: {formatPrice(b)} · PM advantage: {a===null||b===null?'—':formatPrice(b-a)} · AM higher on {rows.filter(r=>r.am>r.pm).length} days.</p><p>Calculated using the maximum price in HE07–HE12 and HE17–HE22 for each complete day in this calendar month.</p></div>})()}
        <h3>Monthly AM / PM peak comparison</h3>
        <div className="scroll"><table><thead><tr><th>Month</th><th>Complete days</th><th>Average AM peak</th><th>Average PM peak</th><th>PM advantage</th><th>AM higher (days)</th></tr></thead><tbody>{seasonal.monthly.map(m=><tr key={m.month}><td>{m.month}</td><td>{m.days}</td><td>{m.am===null?'—':formatPrice(m.am)}</td><td>{m.pm===null?'—':formatPrice(m.pm)}</td><td>{m.diff===null?'—':formatPrice(m.diff)}</td><td>{m.amWins} / {m.days}</td></tr>)}</tbody></table></div>
        <h3>Year-over-year: same month, different years</h3>
        <p className="insight-note">Compare the same calendar month across years. A month with fewer complete days may be less representative.</p>
        <div className="scroll" style={{maxHeight:330}}><table><thead><tr><th>Year / month</th><th>Complete days</th><th>AM peak avg</th><th>PM peak avg</th><th>PM advantage</th><th>AM wins</th></tr></thead><tbody>{trends.months.map(m=><tr key={m.month}><td>{m.month}</td><td>{m.days}</td><td>{formatPrice(m.am)}</td><td>{formatPrice(m.pm)}</td><td>{formatPrice(m.diff)}</td><td>{m.amWins} / {m.days}</td></tr>)}</tbody></table></div>
        <h3>Rolling AM / PM peak trends</h3>
        <p className="insight-note">30 most recent complete comparison days versus the previous 30 complete days; missing dates are skipped. This is a rolling observation, not a price forecast.</p>
        {trends.change?<div className="opportunity-columns"><div className="trend-panel"><strong>AM peak change</strong><div>{formatPrice(trends.change.am)}</div><small>Recent minus previous average</small></div><div className="trend-panel"><strong>PM peak change</strong><div>{formatPrice(trends.change.pm)}</div><small>Recent minus previous average</small></div><div className="trend-panel"><strong>PM advantage change</strong><div>{formatPrice(trends.change.diff)}</div><small>Positive means evening premium strengthened</small></div></div>:<p className="insight-note">At least 14 complete comparison days are needed to calculate a recent change.</p>}
        <div className="scroll" style={{maxHeight:300}}><table><thead><tr><th>Operating date</th><th>Rolling days</th><th>AM peak avg</th><th>PM peak avg</th><th>PM advantage</th></tr></thead><tbody>{[...trends.rolling].reverse().slice(0,45).map(r=><tr key={r.date}><td>{r.date}</td><td>{r.days}</td><td>{formatPrice(r.am)}</td><td>{formatPrice(r.pm)}</td><td>{formatPrice(r.diff)}</td></tr>)}</tbody></table></div>
        <h3>Year-over-year monthly peak prices</h3>
        <p className="insight-note">Select a year to compare January–December AM and PM average daily peaks. Each month uses complete AM/PM days only; hover on the monthly table below for sample sizes.</p>
        <div className="yoy-charts">{[...new Set(yoy.map(r=>r.year))].sort((a,b)=>b-a).slice(0,5).map(year=><PriceLineChart key={year} title={`${year} monthly AM / PM peaks`} series={[{name:'AM peak',color:'#65b8fa',points:yoy.filter(r=>r.year===year).map(r=>({x:r.month-1,value:r.am}))},{name:'PM peak',color:'#f2b56d',points:yoy.filter(r=>r.year===year).map(r=>({x:r.month-1,value:r.pm}))}]}/>)}</div>
        <h3>Holiday versus ordinary days</h3>
        <p className="insight-note">Major US federal holidays are classified by actual date or observed weekday. Holiday dates are excluded from the ordinary weekday/weekend groups. Only complete AM/PM days are compared; small holiday samples may be unreliable.</p>
        <div className="scroll"><table><thead><tr><th>Day type</th><th>Days</th><th>AM peak average</th><th>PM peak average</th><th>PM advantage</th></tr></thead><tbody>{holidayStats.groups.map(g=><tr key={g.key}><td>{{weekday:'Ordinary weekday',weekend:'Ordinary weekend',actual:'Actual holiday',observed:'Observed holiday'}[g.key]}</td><td>{g.days}</td><td>{formatPrice(g.am)}</td><td>{formatPrice(g.pm)}</td><td>{formatPrice(g.diff)}</td></tr>)}</tbody></table></div>
        <details><summary>See classified holiday dates ({holidayStats.holidayDays.length})</summary><div className="scroll" style={{maxHeight:230}}><table><thead><tr><th>Date</th><th>Holiday</th><th>Classification</th><th>AM</th><th>PM</th></tr></thead><tbody>{holidayStats.holidayDays.map(r=><tr key={r.date}><td>{r.date}</td><td>{r.name}</td><td>{r.kind}</td><td>{formatPrice(r.am)}</td><td>{formatPrice(r.pm)}</td></tr>)}</tbody></table></div></details>
        <h3>7-day and 30-day rolling peak trends</h3>
        <p className="insight-note">Rolling windows use the last 7 or 30 complete AM/PM operating days, not necessarily consecutive calendar days. Change compares the latest window against the immediately preceding non-overlapping window. Positive AM change means morning opportunity strengthened in price terms.</p>
        {[{name:'7 complete days',data:rolling7},{name:'30 complete days',data:rolling30}].map(({name,data})=><div key={name} className="rolling-section"><h4>{name}</h4><div className="opportunity-columns">{data.change.length?data.change.map(c=><div className="trend-panel" key={c.key}><strong>{({am:'AM peak',pm:'PM peak',diff:'PM advantage'})[c.key]}</strong><div>{c.delta>=0?'+':''}{formatPrice(c.delta)}</div><small>{c.pct===null?'% unavailable':`${c.pct>=0?'+':''}${c.pct.toFixed(1)}%`} · {Math.abs(c.delta)<0.01?'Flat':c.delta>0?'Strengthening':'Weakening'}</small></div>):<p className="insight-note">Need {name.startsWith('7')?14:60} complete comparison days for a period-over-period indicator.</p>}</div><PriceLineChart title={`${name}: rolling AM and PM peaks`} series={[{name:'AM peak',color:'#65b8fa',points:data.points.slice(-90).map((r,i)=>({x:i,value:r.am}))},{name:'PM peak',color:'#f2b56d',points:data.points.slice(-90).map((r,i)=>({x:i,value:r.pm}))}]}/></div>)}
        <h3>Hourly price distribution — box plots</h3><p className="insight-note">Each box shows the middle 50% of observed prices (25th–75th percentile), the median line, and whiskers from minimum to maximum. Compare stable high-value hours with hours that spike only occasionally.</p>
        <div className="row"><label>Period <select value={boxPeriod} onChange={e=>setBoxPeriod(e.target.value)}><option value="7">Last 7 calendar days</option><option value="30">Last 30 calendar days</option><option value="90">Last 90 calendar days</option><option value="365">Last 365 calendar days</option></select></label></div>
        <HourlyBoxPlot records={records} days={Number(boxPeriod)}/>
        <h3>How the trend is changing</h3>
        <p className="insight-note">Compare adjacent months to see whether PM advantage is rising or falling. For seasonal conclusions, compare the same month across different years: a single month-to-month change may be normal seasonality. Holidays are classified separately above.</p>
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