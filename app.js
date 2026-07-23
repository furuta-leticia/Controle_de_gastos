/* =========================================================
   CONFIG
   ========================================================= */
const STORAGE_KEY = 'controle_gastos_v1';

const CURRENCIES = [
  {code:'EUR', locale:'fr-FR'},
  {code:'BRL', locale:'pt-BR'},
  {code:'USD', locale:'en-US'},
  {code:'GBP', locale:'en-GB'},
  {code:'CHF', locale:'de-CH'},
  {code:'JPY', locale:'ja-JP'},
  {code:'MXN', locale:'es-MX'},
  {code:'ARS', locale:'es-AR'},
  {code:'CLP', locale:'es-CL'},
  {code:'COP', locale:'es-CO'},
];

const DEFAULT_CATEGORIES = [
  {name:'Restaurante',     color:'#E6B655'},
  {name:'Mercado',         color:'#C8895A'},
  {name:'Transporte',      color:'#5B9BD5'},
  {name:'Roupas',          color:'#D98EB0'},
  {name:'Saude',           color:'#7FC08A'},
  {name:'Lazer',           color:'#EB8B6B'},
  {name:'Contas',          color:'#6E8BE0'},
  {name:'Outros',          color:'#868D9A'},
];
const DEFAULT_CITIES = [{name:'Valladolid', color:'#5B9BD5'}];
const PALETTE = [
  '#E6B655','#C8895A','#5B9BD5','#9B7EDE','#4FB2B2','#D98EB0','#7FC08A','#EB8B6B',
  '#6E8BE0','#E06B6B','#4FB286','#868D9A','#D4A76A','#8B6FC0','#52B8CF','#C75D8E',
];

/* =========================================================
   ESTADO
   ========================================================= */
let state = load();
let selectedCat  = state.categories[0]?.name || null;
let selectedCity = initCity();
let viewDate = new Date(); viewDate.setDate(1);

function load(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const s = JSON.parse(raw);
      s.expenses   = s.expenses   || [];
      s.categories = s.categories || DEFAULT_CATEGORIES.slice();
      s.cities     = s.cities     || DEFAULT_CITIES.slice();
      if(s.cities.length && typeof s.cities[0]==='string'){
        s.cities=s.cities.map((c,i)=>({name:c, color:PALETTE[i%PALETTE.length]}));
      }
      s.caps              = s.caps              || {weekly:null, monthly:null};
      if(s.caps.daily===undefined)        s.caps.daily=null;
      if(s.cityEnabled===undefined)       s.cityEnabled=true;
      if(s.currency===undefined)          s.currency='EUR';
      if(!s.visibleCards)                 s.visibleCards={daily:false, weekly:true, monthly:true};
      if(s.notifBudget===undefined)       s.notifBudget=true;
      if(s.notifDailySummary===undefined) s.notifDailySummary=false;
      if(s.notifDailyTime===undefined)    s.notifDailyTime='21:00';
      return s;
    }
  }catch(e){ console.error('Falha ao ler dados salvos:', e); }
  return { expenses:[], categories:DEFAULT_CATEGORIES.slice(), cities:DEFAULT_CITIES.map(c=>({...c})),
    caps:{weekly:null, monthly:null, daily:null}, cityEnabled:true, currency:'EUR',
    visibleCards:{daily:false, weekly:true, monthly:true},
    notifBudget:true, notifDailySummary:false, notifDailyTime:'21:00' };
}

function save(){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch(e){ console.error('Falha ao salvar:', e); }
}

function initCity(){
  if(state.expenses.length){
    const last=[...state.expenses].sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id)[0];
    if(last.city && state.cities.some(c=>c.name===last.city)) return last.city;
  }
  return state.cities[0]?.name || null;
}

/* =========================================================
   UTILITARIOS
   ========================================================= */
let nf = new Intl.NumberFormat('fr-FR', {style:'currency', currency:'EUR'});
const fmt = v => nf.format(v);

function applyCurrency(){
  const cur = CURRENCIES.find(c=>c.code===state.currency) || CURRENCIES[0];
  nf = new Intl.NumberFormat(cur.locale, {style:'currency', currency:cur.code});
}

function isoLocal(d){
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
const parseDate = iso => { const [y,m,d]=iso.split('-').map(Number); return new Date(y,m-1,d); };

function startOfWeek(d){
  const x=new Date(d); const off=(x.getDay()+6)%7;
  x.setDate(x.getDate()-off); x.setHours(0,0,0,0); return x;
}
function inCurrentWeek(iso){
  const d=parseDate(iso), s=startOfWeek(new Date()), e=new Date(s);
  e.setDate(e.getDate()+7); return d>=s && d<e;
}
function inViewMonth(iso){
  const d=parseDate(iso);
  return d.getFullYear()===viewDate.getFullYear() && d.getMonth()===viewDate.getMonth();
}
function isCurrentMonthView(){
  const n=new Date();
  return viewDate.getFullYear()===n.getFullYear() && viewDate.getMonth()===n.getMonth();
}

const sum = arr => arr.reduce((a,b)=>a+b.amount, 0);
const catColor = name => (state.categories.find(c=>c.name===name)||{}).color || 'var(--muted)';
const cityColor = name => (state.cities.find(c=>c.name===name)||{}).color || 'var(--accent)';
const escapeHtml = s => s.replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* =========================================================
   NOTIFICACOES
   ========================================================= */
const notifSupported = 'Notification' in window;

function notifPermission(){ return notifSupported ? Notification.permission : 'unsupported'; }

async function requestNotifPermission(){
  if(!notifSupported) return false;
  if(Notification.permission==='granted') return true;
  const r = await Notification.requestPermission();
  renderNotifStatus();
  return r==='granted';
}

function sendNotif(title, body){
  if(notifPermission()!=='granted') return;
  new Notification(title, { body, icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text y="52" font-size="52">💸</text></svg>' });
}

function checkBudgetNotif(){
  if(!state.notifBudget || notifPermission()!=='granted') return;
  const today = isoLocal(new Date());
  const lastKey = 'lastBudgetNotifDate';
  if(localStorage.getItem(lastKey)===today) return;

  const daySpent   = sum(state.expenses.filter(e=>e.date===today));
  const weekSpent  = sum(state.expenses.filter(e=>inCurrentWeek(e.date)));
  const monthSpent = sum(state.expenses.filter(e=>{
    const d=parseDate(e.date), n=new Date();
    return d.getFullYear()===n.getFullYear() && d.getMonth()===n.getMonth();
  }));

  if(state.caps.daily && daySpent>=state.caps.daily){
    sendNotif('Teto diário atingido 🔴', `Você gastou ${fmt(daySpent)} hoje (limite: ${fmt(state.caps.daily)})`);
    localStorage.setItem(lastKey, today);
  } else if(state.caps.weekly && weekSpent>=state.caps.weekly){
    sendNotif('Teto semanal atingido 🔴', `Você gastou ${fmt(weekSpent)} esta semana (limite: ${fmt(state.caps.weekly)})`);
    localStorage.setItem(lastKey, today);
  } else if(state.caps.monthly && monthSpent>=state.caps.monthly){
    sendNotif('Teto mensal atingido 🔴', `Você gastou ${fmt(monthSpent)} este mês (limite: ${fmt(state.caps.monthly)})`);
    localStorage.setItem(lastKey, today);
  }
}

function checkDailySummary(){
  if(!state.notifDailySummary || notifPermission()!=='granted') return;
  const now = new Date();
  const today = isoLocal(now);
  if(localStorage.getItem('lastDailySummaryDate')===today) return;
  const [h,m] = state.notifDailyTime.split(':').map(Number);
  if(now.getHours()>h || (now.getHours()===h && now.getMinutes()>=m)){
    const todaySpent = sum(state.expenses.filter(e=>e.date===today));
    sendNotif('Resumo do dia 📊', todaySpent>0
      ? `Você gastou ${fmt(todaySpent)} hoje`
      : 'Nenhum gasto registrado hoje');
    localStorage.setItem('lastDailySummaryDate', today);
  }
}

function renderNotifStatus(){
  const el = document.getElementById('notifStatus');
  if(!el) return;
  if(!notifSupported){ el.textContent='Não suportado neste navegador'; el.className='notif-status unsupported'; return; }
  const p = notifPermission();
  if(p==='granted'){  el.textContent='Ativadas'; el.className='notif-status granted'; }
  else if(p==='denied'){ el.textContent='Bloqueadas pelo navegador — libere nas configurações do browser'; el.className='notif-status denied'; }
  else { el.textContent='Permissão não concedida'; el.className='notif-status pending'; }
  document.getElementById('notifRequestBtn').style.display = p==='granted' ? 'none' : '';
}

/* =========================================================
   RENDER
   ========================================================= */
function render(){
  renderPeriod(); renderStatus(); renderChips(); renderCitySelect();
  renderDonut(); renderByCity(); renderBars(); renderList();
  document.getElementById('curSym').textContent = fmt(0).replace(/[\d.,\s]/g,'') || '€';
  const cityField = document.getElementById('city').closest('.meta-row > div');
  if(cityField) cityField.style.display = state.cityEnabled ? '' : 'none';
}

function renderPeriod(){
  document.getElementById('periodLabel').textContent =
    viewDate.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
  const n=new Date();
  document.getElementById('nextMonth').disabled =
    (viewDate.getFullYear()>n.getFullYear()) ||
    (viewDate.getFullYear()===n.getFullYear() && viewDate.getMonth()>=n.getMonth());
  document.getElementById('barsSection').style.display = isCurrentMonthView() ? '' : 'none';
}

function changeMonth(delta){ viewDate.setMonth(viewDate.getMonth()+delta); render(); }

function fillCard(prefix, spent, cap, noCapSub){
  const ids={week:'cardWeek', month:'cardMonth', day:'cardDay'};
  const card=document.getElementById(ids[prefix]);
  const remEl=document.getElementById(prefix+'Remain');
  const subEl=document.getElementById(prefix+'Sub');
  const barEl=document.getElementById(prefix+'Bar');
  card.className='card';
  if(!cap){
    card.classList.add('is-none'); remEl.textContent=fmt(spent);
    subEl.textContent=noCapSub||'gasto · sem teto'; barEl.style.width='0%'; return;
  }
  const ratio=spent/cap, remaining=cap-spent;
  let cls='is-good'; if(ratio>=1) cls='is-over'; else if(ratio>=0.8) cls='is-warn';
  card.classList.add(cls);
  remEl.textContent = remaining>=0 ? fmt(remaining) : '-'+fmt(Math.abs(remaining));
  subEl.textContent = remaining>=0 ? `restam de ${fmt(cap)}` : `ultrapassou ${fmt(cap)}`;
  barEl.style.width = Math.min(ratio,1)*100+'%';
}

function renderStatus(){
  const vc = state.visibleCards || {daily:false, weekly:true, monthly:true};
  const isCurrent = isCurrentMonthView();
  const today = isoLocal(new Date());
  const monthSpent = sum(state.expenses.filter(e=>inViewMonth(e.date)));
  const showDay = vc.daily && isCurrent;

  document.getElementById('cardDay').style.display   = showDay    ? '' : 'none';
  document.getElementById('cardWeek').style.display  = vc.weekly  ? '' : 'none';
  document.getElementById('cardMonth').style.display = vc.monthly ? '' : 'none';

  if(showDay){
    fillCard('day', sum(state.expenses.filter(e=>e.date===today)), state.caps.daily, 'gasto hoje');
  }
  if(isCurrent){
    document.querySelector('#cardWeek .label').textContent  = 'Esta semana';
    document.querySelector('#cardMonth .label').textContent = 'Este mês';
    if(vc.weekly) fillCard('week', sum(state.expenses.filter(e=>inCurrentWeek(e.date))), state.caps.weekly);
  } else {
    document.querySelector('#cardWeek .label').textContent  = 'Total do mês';
    document.querySelector('#cardMonth .label').textContent = 'vs teto mensal';
    if(vc.weekly) fillCard('week', monthSpent, null, 'gasto no mês');
  }
  if(vc.monthly) fillCard('month', monthSpent, state.caps.monthly);
}

function renderChips(){
  const box=document.getElementById('catChips'); box.innerHTML='';
  if(!state.categories.some(c=>c.name===selectedCat)) selectedCat=state.categories[0]?.name||null;
  state.categories.forEach(c=>{
    const b=document.createElement('button'); b.className='chip'; b.type='button';
    b.setAttribute('aria-pressed', String(c.name===selectedCat));
    b.innerHTML=`<span class="dot" style="background:${c.color}"></span>${c.name}`;
    b.onclick=()=>{ selectedCat=c.name; renderChips(); };
    box.appendChild(b);
  });
}

function renderCitySelect(){
  const sel=document.getElementById('city'); sel.innerHTML='';
  if(state.cities.length && !state.cities.some(c=>c.name===selectedCity)) selectedCity=state.cities[0].name;
  if(state.cities.length===0){
    const o=document.createElement('option'); o.textContent='—'; o.value='';
    sel.appendChild(o); selectedCity=null; return;
  }
  state.cities.forEach(c=>{
    const o=document.createElement('option'); o.value=c.name; o.textContent=c.name;
    if(c.name===selectedCity) o.selected=true; sel.appendChild(o);
  });
}

function renderDonut(){
  const svg=document.getElementById('donut'), legend=document.getElementById('legend');
  svg.innerHTML=''; legend.innerHTML='';
  const month=state.expenses.filter(e=>inViewMonth(e.date)), total=sum(month);
  if(total===0){
    legend.innerHTML='<div class="empty">Nenhum gasto neste mês ainda.</div>';
    svg.innerHTML=`<circle cx="52" cy="52" r="40" fill="none" stroke="var(--surface-2)" stroke-width="12"/>`;
    return;
  }
  const byCat={}; month.forEach(e=>byCat[e.category]=(byCat[e.category]||0)+e.amount);
  const items=Object.entries(byCat).sort((a,b)=>b[1]-a[1]);
  const r=40, C=2*Math.PI*r; let offset=0;
  svg.innerHTML=`<circle cx="52" cy="52" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="12"/>`;
  items.forEach(([name,val])=>{
    const seg=(val/total)*C;
    const cir=document.createElementNS('http://www.w3.org/2000/svg','circle');
    cir.setAttribute('cx','52'); cir.setAttribute('cy','52'); cir.setAttribute('r',r);
    cir.setAttribute('fill','none'); cir.setAttribute('stroke',catColor(name));
    cir.setAttribute('stroke-width','12');
    cir.setAttribute('stroke-dasharray',`${seg} ${C-seg}`);
    cir.setAttribute('stroke-dashoffset',-offset);
    cir.setAttribute('transform','rotate(-90 52 52)');
    svg.appendChild(cir); offset+=seg;
    const row=document.createElement('div'); row.className='leg';
    row.innerHTML=`<span class="dot" style="background:${catColor(name)}"></span><span class="nm">${name}</span>
      <span class="vl">${Math.round((val/total)*100)}% · ${fmt(val)}</span>`;
    legend.appendChild(row);
  });
  const t=document.createElementNS('http://www.w3.org/2000/svg','text');
  t.setAttribute('x','52'); t.setAttribute('y','56'); t.setAttribute('text-anchor','middle');
  t.setAttribute('fill','var(--ink)'); t.setAttribute('font-size','13');
  t.setAttribute('font-family','var(--mono)');
  t.textContent=fmt(total).replace(/\s?[€R$]+/,''); svg.appendChild(t);
}

function renderByCity(){
  const box=document.getElementById('cityList'); box.innerHTML='';
  const section=box.closest('.charts > div');
  if(!state.cityEnabled){ section.style.display='none'; return; }
  section.style.display='';
  const month=state.expenses.filter(e=>inViewMonth(e.date));
  if(month.length===0){ box.innerHTML='<div class="empty">Sem gastos neste mês.</div>'; return; }
  const by={}; month.forEach(e=>{ const c=e.city||'Sem cidade'; by[c]=(by[c]||0)+e.amount; });
  const items=Object.entries(by).sort((a,b)=>b[1]-a[1]); const max=items[0][1];
  items.forEach(([city,val])=>{
    const row=document.createElement('div'); row.className='cityrow';
    const clr=cityColor(city);
    row.innerHTML=`<span class="dot" style="background:${clr};flex:0 0 auto"></span><span class="nm">${escapeHtml(city)}</span>
      <span class="track"><i style="width:${(val/max)*100}%;background:${clr}"></i></span>
      <span class="vl">${fmt(val)}</span>`;
    box.appendChild(row);
  });
}

function renderBars(){
  const box=document.getElementById('bars'); box.innerHTML='';
  const days=[]; for(let i=6;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); days.push(d); }
  const dayData=days.map(d=>{
    const iso=isoLocal(d), exps=state.expenses.filter(e=>e.date===iso);
    const byCat={}; exps.forEach(e=>byCat[e.category]=(byCat[e.category]||0)+e.amount);
    return {total:sum(exps), byCat};
  });
  const max=Math.max(...dayData.map(d=>d.total),1);
  days.forEach((d,i)=>{
    const col=document.createElement('div');
    col.className='barcol'+(dayData[i].total===0?' zero':'');
    const h=Math.max((dayData[i].total/max)*100,2);
    const wd=d.toLocaleDateString('pt-BR',{weekday:'short'}).replace('.','');
    let segs='';
    if(dayData[i].total>0){
      Object.entries(dayData[i].byCat).sort((a,b)=>b[1]-a[1]).forEach(([cat,val])=>{
        const segH=(val/dayData[i].total)*100;
        segs+=`<div class="bar-seg" style="height:${segH}%;background:${catColor(cat)}" title="${cat}: ${fmt(val)}"></div>`;
      });
    }
    col.innerHTML=`<div class="bar-stack" style="height:${h}%" title="${fmt(dayData[i].total)}">${segs}</div><small>${wd}</small>`;
    box.appendChild(col);
  });
}

function renderList(){
  const box=document.getElementById('list'); box.innerHTML='';
  const monthExp=state.expenses.filter(e=>inViewMonth(e.date));
  if(monthExp.length===0){ box.innerHTML='<div class="empty">Sem lançamentos neste mês.</div>'; return; }
  const sorted=monthExp.sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id).slice(0,80);
  sorted.forEach(e=>{
    const row=document.createElement('div'); row.className='row';
    const dt=parseDate(e.date).toLocaleDateString('pt-BR',{day:'2-digit',month:'short'});
    const meta=[dt, e.city, e.note&&escapeHtml(e.note)].filter(Boolean).join(' · ');
    row.innerHTML=`<span class="dot" style="background:${catColor(e.category)}"></span>
      <div class="info"><b>${e.category}</b><small>${meta}</small></div>
      <span class="val">${fmt(e.amount)}</span><button class="del" aria-label="Excluir">×</button>`;
    row.querySelector('.del').onclick=()=>deleteExpense(e.id);
    box.appendChild(row);
  });
}

/* =========================================================
   ACOES
   ========================================================= */
function addExpense(){
  const hint=document.getElementById('hint');
  const raw=document.getElementById('amount').value.trim().replace(/\./g,'').replace(',','.');
  const amount=parseFloat(raw);
  const date=document.getElementById('date').value || isoLocal(new Date());
  const note=document.getElementById('note').value.trim();
  if(!amount||amount<=0){ hint.textContent='Digite um valor maior que zero.'; return; }
  if(!selectedCat){ hint.textContent='Escolha uma categoria.'; return; }
  hint.textContent='';
  const city = state.cityEnabled ? selectedCity : null;
  state.expenses.push({ id:Date.now(), amount, category:selectedCat, city, date, note });
  save();
  document.getElementById('amount').value=''; document.getElementById('note').value='';
  viewDate = parseDate(date); viewDate.setDate(1);
  render();
  checkBudgetNotif();
}

function deleteExpense(id){ state.expenses=state.expenses.filter(e=>e.id!==id); save(); render(); }

/* =========================================================
   CONFIGURACOES
   ========================================================= */
let pickedCatColor=PALETTE[0], pickedCityColor=PALETTE[0];

function openSettings(){
  document.getElementById('capDay').value   = state.caps.daily   ?? '';
  document.getElementById('capWeek').value  = state.caps.weekly  ?? '';
  document.getElementById('capMonth').value = state.caps.monthly ?? '';
  document.getElementById('currency').value = state.currency || 'EUR';
  const vc = state.visibleCards || {daily:false, weekly:true, monthly:true};
  document.getElementById('visDaily').checked   = vc.daily   ?? false;
  document.getElementById('visWeekly').checked  = vc.weekly  ?? true;
  document.getElementById('visMonthly').checked = vc.monthly ?? true;
  document.getElementById('cityEnabled').checked      = state.cityEnabled;
  document.getElementById('notifBudget').checked      = state.notifBudget;
  document.getElementById('notifDailySummary').checked = state.notifDailySummary;
  document.getElementById('notifDailyTime').value     = state.notifDailyTime;
  updateNotifTimeVisibility();
  renderNotifStatus();
  updateCitySettingsVisibility();
  pickedCatColor=PALETTE[state.categories.length%PALETTE.length];
  pickedCityColor=PALETTE[state.cities.length%PALETTE.length];
  renderCatListSettings(); renderCityListSettings();
  renderColorPicker('catColorPick', pickedCatColor, c=>{pickedCatColor=c});
  renderColorPicker('cityColorPick', pickedCityColor, c=>{pickedCityColor=c});
  document.getElementById('overlay').classList.add('open');
}

function updateCitySettingsVisibility(){
  document.getElementById('citySettingsContent').style.display =
    document.getElementById('cityEnabled').checked ? '' : 'none';
}

function closeSettings(){
  state.caps.daily         = parseFloat(document.getElementById('capDay').value)   || null;
  state.caps.weekly        = parseFloat(document.getElementById('capWeek').value)  || null;
  state.caps.monthly       = parseFloat(document.getElementById('capMonth').value) || null;
  state.currency           = document.getElementById('currency').value;
  state.visibleCards = {
    daily:   document.getElementById('visDaily').checked,
    weekly:  document.getElementById('visWeekly').checked,
    monthly: document.getElementById('visMonthly').checked,
  };
  state.cityEnabled        = document.getElementById('cityEnabled').checked;
  state.notifBudget        = document.getElementById('notifBudget').checked;
  state.notifDailySummary  = document.getElementById('notifDailySummary').checked;
  state.notifDailyTime     = document.getElementById('notifDailyTime').value || '21:00';
  applyCurrency();
  save(); document.getElementById('overlay').classList.remove('open'); render();
}

function updateNotifTimeVisibility(){
  document.getElementById('notifTimeRow').style.display =
    document.getElementById('notifDailySummary').checked ? '' : 'none';
}

function renderCatListSettings(){
  const box=document.getElementById('catListSettings'); box.innerHTML='';
  state.categories.forEach((c,idx)=>{
    const item=document.createElement('div'); item.className='cat-item';
    item.innerHTML=`<span class="dot" style="background:${c.color}"></span><span class="nm">${c.name}</span><button aria-label="Remover">×</button>`;
    item.querySelector('button').onclick=()=>{
      if(state.categories.length<=1) return;
      state.categories.splice(idx,1); save(); renderCatListSettings(); renderChips();
    };
    box.appendChild(item);
  });
}

function renderCityListSettings(){
  const box=document.getElementById('cityListSettings'); box.innerHTML='';
  state.cities.forEach((c,idx)=>{
    const item=document.createElement('div'); item.className='cat-item';
    item.innerHTML=`<span class="dot" style="background:${c.color}"></span><span class="nm">${escapeHtml(c.name)}</span><button aria-label="Remover">×</button>`;
    item.querySelector('button').onclick=()=>{
      state.cities.splice(idx,1); save(); renderCityListSettings(); renderCitySelect();
    };
    box.appendChild(item);
  });
}

function renderColorPicker(containerId, current, onPick){
  const box=document.getElementById(containerId); box.innerHTML='';
  PALETTE.forEach(color=>{
    const s=document.createElement('span');
    s.className='swatch'+(color===current?' active':'');
    s.style.background=color;
    s.onclick=()=>{ onPick(color); renderColorPicker(containerId, color, onPick); };
    box.appendChild(s);
  });
}

function addCategory(){
  const inp=document.getElementById('newCat'), name=inp.value.trim();
  if(!name||state.categories.some(c=>c.name.toLowerCase()===name.toLowerCase())) return;
  state.categories.push({name, color:pickedCatColor}); inp.value='';
  pickedCatColor=PALETTE[state.categories.length%PALETTE.length];
  save(); renderCatListSettings(); renderChips();
  renderColorPicker('catColorPick', pickedCatColor, c=>{pickedCatColor=c});
}

function addCity(){
  const inp=document.getElementById('newCity'), name=inp.value.trim();
  if(!name||state.cities.some(c=>c.name.toLowerCase()===name.toLowerCase())) return;
  state.cities.push({name, color:pickedCityColor}); inp.value='';
  pickedCityColor=PALETTE[state.cities.length%PALETTE.length];
  save(); renderCityListSettings(); renderCitySelect();
  renderColorPicker('cityColorPick', pickedCityColor, c=>{pickedCityColor=c});
}

function exportData(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=`gastos-backup-${isoLocal(new Date())}.json`; a.click(); URL.revokeObjectURL(a.href);
}

function importData(file){
  const r=new FileReader();
  r.onload=()=>{
    try{
      const s=JSON.parse(r.result); if(!Array.isArray(s.expenses)) throw 0;
      state=s;
      state.categories=state.categories||DEFAULT_CATEGORIES.slice();
      state.cities=state.cities||DEFAULT_CITIES.slice();
      if(state.cities.length && typeof state.cities[0]==='string'){
        state.cities=state.cities.map((c,i)=>({name:c, color:PALETTE[i%PALETTE.length]}));
      }
      state.caps=state.caps||{weekly:null,monthly:null,daily:null};
      if(state.caps.daily===undefined) state.caps.daily=null;
      if(!state.currency) state.currency='EUR';
      if(!state.visibleCards) state.visibleCards={daily:false,weekly:true,monthly:true};
      selectedCity=initCity(); applyCurrency(); save(); render(); closeSettings();
    }catch(e){ alert('Não consegui ler esse arquivo. Verifique se é um backup válido.'); }
  };
  r.readAsText(file);
}

function clearAll(){
  if(confirm('Isso apaga todos os gastos e configurações. Continuar?')){
    localStorage.removeItem(STORAGE_KEY); state=load(); applyCurrency();
    selectedCat=state.categories[0]?.name||null; selectedCity=initCity();
    closeSettings(); render();
  }
}

/* =========================================================
   TEMA
   ========================================================= */
function applyTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  document.getElementById('themeToggle').textContent = t==='light' ? '🌙' : '☀';
  document.querySelector('meta[name="theme-color"]').content = t==='light' ? '#F5F0E8' : '#15171C';
  localStorage.setItem('theme', t);
}

/* =========================================================
   TAMANHO DE FONTE
   ========================================================= */
const FONT_STEPS = [12, 13, 14, 15, 16, 18, 20];
let fontIdx = FONT_STEPS.indexOf(parseInt(localStorage.getItem('fontSize'))||14);
if(fontIdx<0) fontIdx=2;

function applyFontSize(){
  const sz=FONT_STEPS[fontIdx];
  document.querySelector('.wrap').style.fontSize=sz+'px';
  localStorage.setItem('fontSize', sz);
  document.getElementById('fontDown').disabled = fontIdx===0;
  document.getElementById('fontUp').disabled = fontIdx===FONT_STEPS.length-1;
}

/* =========================================================
   EVENTOS + INICIO
   ========================================================= */
document.getElementById('date').value = isoLocal(new Date());
document.getElementById('prevMonth').onclick = ()=>changeMonth(-1);
document.getElementById('nextMonth').onclick = ()=>changeMonth(1);
document.getElementById('city').onchange = e => selectedCity = e.target.value;
document.getElementById('addBtn').onclick = addExpense;
document.getElementById('amount').addEventListener('keydown', e=>{ if(e.key==='Enter') addExpense(); });
document.getElementById('openSettings').onclick = openSettings;
document.getElementById('closeSettings').onclick = closeSettings;
document.getElementById('overlay').onclick = e=>{ if(e.target.id==='overlay') closeSettings(); };
document.getElementById('addCat').onclick = addCategory;
document.getElementById('addCity').onclick = addCity;
document.getElementById('exportBtn').onclick = exportData;
document.getElementById('importBtn').onclick = ()=>document.getElementById('importFile').click();
document.getElementById('importFile').onchange = e=>{ if(e.target.files[0]) importData(e.target.files[0]); };
document.getElementById('clearBtn').onclick = clearAll;
document.getElementById('cityEnabled').onchange = updateCitySettingsVisibility;
document.getElementById('notifRequestBtn').onclick = requestNotifPermission;
document.getElementById('notifDailySummary').onchange = updateNotifTimeVisibility;

document.getElementById('themeToggle').onclick = ()=>{
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(cur==='dark' ? 'light' : 'dark');
};
applyTheme(localStorage.getItem('theme') || 'dark');

document.getElementById('fontUp').onclick = ()=>{ if(fontIdx<FONT_STEPS.length-1){fontIdx++;applyFontSize();} };
document.getElementById('fontDown').onclick = ()=>{ if(fontIdx>0){fontIdx--;applyFontSize();} };
applyFontSize();

// checagem de resumo diário a cada minuto
checkDailySummary();
setInterval(checkDailySummary, 60_000);

applyCurrency();
render();
