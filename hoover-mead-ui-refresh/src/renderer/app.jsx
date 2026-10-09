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
  if (v === null || v === undefined || isNaN(v)) return '#1a1d26';
  const t = max > min ? (v - min) / (max - min) : 0.5;
  const stops = [[91,141,238],[240,198,116],[224,80,80]];
  const seg = t < 0.5 ? 0 : 1;
  const lt = t < 0.5 ? t*2 : (t-0.5)*2;
  const c0 = stops[seg], c1 = stops[seg+1] || stops[seg];
  const r = Math.round(c0[0] + (c1[0]-c0[0])*lt);
  const g = Math.round(c0[1] + (c1[1]-c0[1])*lt);
  const b = Math.round(c0[2] + (c1[2]-c0[2])*lt);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
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
          await importRecords([res.data], true);
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
        setMsg({type:'ok', text: 'Fetched ' + dayResults.length + ' day(s) of ' + totalDays + ' requested, from CAISO'});
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
    if (all.length === 0) return null;
    return {
      avgAll: all.reduce(function(a,b) { return a+b.avg; }, 0) / all.length,
      maxAll: Math.max.apply(null, all.map(function(s) { return s.max; })),
      minAll: Math.min.apply(null, all.map(function(s) { return s.min; })),
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
  const chartDays = sortedList.slice(0, 30).reverse();
  const dailySeries = [{color:'#35c4ae',width:3,points:chartDays.map(function(r,i){const st=computeStats(r.hours);return {x:chartDays.length === 1 ? 12 : i*24/(chartDays.length-1),y:st?st.avg:null};})}];
  const peakHours = latest ? HE_COLS.map(function(h){return {hour:h,price:latest.hours[h]};}).filter(function(x){return typeof x.price === 'number' && Number.isFinite(x.price);}).sort(function(a,b){return b.price-a.price;}).slice(0,5) : [];
  return (
    <div className="app shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-icon">≋</div><div><strong>HOOVER<span> / </span>MEAD</strong><small>ENERGY INTELLIGENCE</small></div></div>
        <div className="side-label">WORKSPACE</div>
        <nav className="side-nav">
          {[['dashboard','◫','Overview'],['import','↓','Download prices'],['history','▤','Historical data'],['analysis','⌁','Price analysis'],['heatmap','▦','Price heatmap']].map(function(item){return <button key={item[0]} className={'nav-item'+(tab===item[0]?' selected':'')} onClick={function(){setTab(item[0]);}}><span className="nav-symbol">{item[1]}</span>{item[2]}</button>;})}
        </nav>
        <div className="sidebar-bottom"><div className="node-pill"><span className="live-dot"></span> CAISO · MEADS_2_N101</div><button className={'nav-item'+(tab==='settings'?' selected':'')} onClick={function(){setTab('settings');}}>⚙ &nbsp; Settings</button></div>
      </aside>
      <main className="main-panel">
      <header className="topbar"><div><div className="eyebrow">HOOVER DAM / LAKE MEAD</div><h1>{({dashboard:'Energy price overview',import:'Download CAISO prices',history:'Historical price library',analysis:'Market price analysis',heatmap:'Hourly price heatmap',settings:'Application settings'})[tab]}</h1><div className="sub">Day-ahead locational marginal prices · Pacific operating time</div></div><div className="top-actions"><span className="data-count">{records.length.toLocaleString()} days stored</span><button onClick={function(){setTab('import');}}>↓ Download data</button></div></header>
      {tab === 'dashboard' && <section className="dashboard">
        <div className="section-heading"><div><h2>Market snapshot</h2><p>{latest ? 'Latest available operating day: '+latest.date : 'Connect your database and download prices to populate the dashboard'}</p></div><span className="source-tag">SOURCE · CAISO DAY-AHEAD</span></div>
        <div className="kpi-grid">
          <div className="kpi"><span>Average historical price</span><strong>{globalStats?formatPrice(globalStats.avgAll):'—'}</strong><small>$/MWh · stored days</small></div>
          <div className="kpi"><span>Latest daily peak</span><strong>{latestStats?formatPrice(latestStats.max):'—'}</strong><small>{latestStats?'Peak at '+latestStats.peakHour:'No prices loaded'}</small></div>
          <div className="kpi"><span>Latest daily spread</span><strong>{latestStats?formatPrice(latestStats.max-latestStats.min):'—'}</strong><small>Maximum minus minimum</small></div>
          <div className="kpi"><span>Historical days</span><strong>{records.length.toLocaleString()}</strong><small>Available in local database</small></div>
        </div>
        <div className="dashboard-grid"><div className="card chart-card"><div className="panel-heading"><div><h3>Recent daily average prices</h3><p>Up to 30 most recent stored operating days</p></div><span className="unit-label">$/MWh</span></div>{chartDays.length?<LineChart series={dailySeries} height={290}/>:<div className="empty">No historical prices yet. Download CAISO data to see price trends.</div>}</div>
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
              Single day or a range. Range fetches one day at a time with a short delay between requests. DAM data for a trading day is typically not published until the afternoon before.
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
                <button onClick={function(){ resolveOverwrite(true); }}>Overwrite and fetch all</button>
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

      {tab === 'analysis' && (
        <div>
          {!globalStats ? (
            <div className="card"><div className="empty">No data yet.</div></div>
          ) : (
            <Fragment>
              <div className="card">
                <div className="stat-grid">
                  <div className="stat"><div className="label">Avg price</div><div className="val">{formatPrice(globalStats.avgAll)}</div></div>
                  <div className="stat"><div className="label">All-time max</div><div className="val">{formatPrice(globalStats.maxAll)}</div></div>
                  <div className="stat"><div className="label">All-time min</div><div className="val">{formatPrice(globalStats.minAll)}</div></div>
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

      {tab === 'heatmap' && (
        <div className="card">
          {records.length === 0 ? (
            <div className="empty">No data yet.</div>
          ) : (
            <div className="scroll" style={{overflowX:'auto'}}>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    {HE_COLS.map(function(h) {
                      return <th key={h} style={{fontSize:10}}>{h.replace('HE','')}</th>;
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sortedList.slice(0,60).map(function(r) {
                    return (
                      <tr key={r.key}>
                        <td style={{whiteSpace:'nowrap'}}>{r.date}</td>
                        {HE_COLS.map(function(h) {
                          const v = r.hours[h];
                          const title = (v !== null && v !== undefined) ? formatPrice(v) : 'n/a';
                          return (
                            <td key={h} style={{padding:2}}>
                              <div
                                className="hcell"
                                title={title}
                                style={{background: heatColor(v, heatMin, heatMax), width:20, height:20, display:'inline-block', borderRadius:2}}
                              ></div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

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
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);