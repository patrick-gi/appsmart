(() => {
"use strict";
const $ = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money = n => "$" + Math.round(Number(n)||0).toLocaleString("en-US");
const ago = t => { const s=(Date.now()-t)/1000; if(s<60)return"just now"; if(s<3600)return Math.floor(s/60)+"m ago"; if(s<86400)return Math.floor(s/3600)+"h ago"; if(s<86400*30) return Math.floor(s/86400)+"d ago"; return new Date(t).toLocaleDateString("en-US",{month:"short",day:"numeric"}); };
const { STATES, CITIES, MODELS } = window.US;
const STATE_CODES = Object.keys(STATES).sort((a,b)=>STATES[a].localeCompare(STATES[b]));
const lsGet = (k,d) => { try{ const v=localStorage.getItem(k); return v?JSON.parse(v):d; }catch(e){ return d; } };
const lsSet = (k,v) => { try{ v==null?localStorage.removeItem(k):localStorage.setItem(k,JSON.stringify(v)); }catch(e){} };

const CATS = [
  {k:"iphone", n:"iPhone", p:"iPhones"}, {k:"ipad", n:"iPad", p:"iPads"}, {k:"mac", n:"Mac", p:"Macs"},
  {k:"watch", n:"Apple Watch", p:"Apple Watches"}, {k:"airpods", n:"AirPods", p:"AirPods"}, {k:"other", n:"Accessories", p:"Accessories"}
];
const GRADES = {
  A:{n:"Grade A", t:"Pristine", d:"Flawless or like-new. Zero scratches on screen or chassis."},
  B:{n:"Grade B", t:"Very Good", d:"Light micro-scratches barely visible under ambient room lighting."},
  C:{n:"Grade C", t:"Noticeable Wear", d:"Visible scuffs or dings, but 100% operational hardware."}
};
const STORAGE = { iphone:["128 GB","256 GB","512 GB","1 TB"], ipad:["64 GB","128 GB","256 GB","512 GB","1 TB","2 TB"], mac:["256 GB","512 GB","1 TB","2 TB"] };
const CHECKS = [["faceid","Face ID / Touch ID works"],["imei","Clean IMEI / not blacklisted"],["parts","Original parts"]];
const checksFor = cat => CHECKS.filter(([k])=> k!=="faceid" || ["iphone","ipad","mac"].includes(cat));
const BATT_HINT = { iphone:"Settings → Battery → Battery Health & Charging.", ipad:"Settings → Battery → Battery Health.", mac:"System Settings → Battery → Battery Health.", watch:"Settings → Battery → Battery Health.", airpods:"Leave blank. AirPods don't report a battery health figure.", other:"Leave blank if the device doesn't report it." };
const REASONS = [["scam","Looks like a scam"],["stolen","Might be stolen"],["wrong-info","Wrong or misleading details"],["offensive","Offensive content"],["sold-elsewhere","Already sold elsewhere"],["other","Something else"]];
const catOf = k => CATS.find(c=>c.k===k) || {n:"Device", p:"Devices"};
const ICON = {
  iphone:'<svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="20" y="6" width="24" height="52" rx="6"/><rect x="27" y="10" width="10" height="3" rx="1.5"/></svg>',
  ipad:'<svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="12" y="6" width="40" height="52" rx="5"/><circle cx="32" cy="10" r="1"/></svg>',
  mac:'<svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="12" y="14" width="40" height="27" rx="3"/><path d="M6 46h52l-3 4H9z"/></svg>',
  watch:'<svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="20" y="18" width="24" height="28" rx="8"/><path d="M24 18l2-10h12l2 10M24 46l2 10h12l2-10"/></svg>',
  airpods:'<svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="14" y="22" width="36" height="28" rx="11"/><path d="M14 31h36"/><circle cx="32" cy="38" r="1.3"/></svg>',
  other:'<svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M46 10 18 50l-4 6 6-3 28-40z"/><path d="M42 16l4 4"/></svg>'
};
const I = {
  pin:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  heart:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20s-7-4.3-9-8.6C1.6 8 3.8 4.5 7.2 4.5c1.9 0 3.3 1 4.8 2.8 1.5-1.8 2.9-2.8 4.8-2.8 3.4 0 5.6 3.5 4.2 6.9C19 15.7 12 20 12 20z"/></svg>',
  eye:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  chat:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20 15.5a2 2 0 0 1-2 2H8l-4 3.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/></svg>',
  share:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
  flag:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M5 21V4h11l-1.5 4L16 12H5"/></svg>',
  left:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg>',
  right:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg>',
  upload:'<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/></svg>',
  check:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  bolt:'<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  cam:'<svg class="cam" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  plus:'<svg class="plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  send:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/></svg>',
  trend:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>',
  phone:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 5.5h2"/></svg>',
  unlock:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>',
  okc:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  shield:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/></svg>'
};

const S = {
  me:null, listings:[], loaded:false, threads:[], saved:new Set(), mine:null,
  loc: lsGet("as_loc", {state:"", city:""}),
  f:{q:"", cat:"", grades:new Set(), min:"", max:"", batt:"", lockOnly:false, hideSold:true, sort:"new"},
  route:"home", param:"", activeThread:null, msgs:[], msgTid:null, photoIx:0,
  draft:null, draftErr:"", busy:false, uploading:0, railOpen:false, menuOpen:false, allStates:false,
  mineTab:"active", sellers:{}, pending:[], msgDraft:{}, offerOpen:false, offerAmt:"", inboxTab:"all", threadsLoaded:false, authMode:"in", authErr:"", next:"", acctMsg:""
};

/* ---------- api ---------- */
async function api(method, url, body){
  const res = await fetch(url, {method, headers: body?{"Content-Type":"application/json"}:{}, body: body?JSON.stringify(body):undefined, credentials:"same-origin"});
  let data=null; try{ data=await res.json(); }catch(e){}
  if(!res.ok){ const err=new Error((data&&data.error)||"Something went wrong. Try again."); err.status=res.status; throw err; }
  return data;
}
function toast(t){ const el=$("#toast"); el.textContent=t; el.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>el.hidden=true,2800); }
function fail(e){ if(e.status===401){ S.me=null; goSignIn(); } toast(e.message); }

/* ---------- small renderers ---------- */
function initials(n){ return (n||"?").split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join("")||"?"; }
function hue(id){ let h=0; for(const c of String(id)) h=(h*31+c.charCodeAt(0))%360; return h; }
function avatar(id, name, size=32){ return `<span class="avatar" style="width:${size}px;height:${size}px;background:hsl(${hue(id)} 42% 40%);font-size:${Math.round(size*.38)}px" aria-hidden="true">${esc(initials(name))}</span>`; }
const isMe = id => !!S.me && id===S.me.id;
const showName = (id, n) => isMe(id) ? "You" : (n||"Someone");
const photoSrc = id => "/api/photos/" + encodeURIComponent(id);
const placeLabel = (city, state) => city && state ? `${city}, ${state}` : state ? STATES[state] || state : "";
const locLabel = () => S.loc.city ? `${S.loc.city}, ${S.loc.state}` : S.loc.state ? STATES[S.loc.state] : "All of the US";
const battClass = b => b==null?"":(b>=85?"ok":b>=80?"warn":"bad");
const battColor = b => `var(--${battClass(b)||"ok"})`;
function stateOptions(sel, allLabel){ return (allLabel!=null?`<option value="">${esc(allLabel)}</option>`:`<option value="" disabled ${sel?"":"selected"}>Choose a state</option>`) + STATE_CODES.map(c=>`<option value="${c}" ${sel===c?"selected":""}>${esc(STATES[c])}</option>`).join(""); }
function cityList(id, state){
  const known = new Set(CITIES[state]||[]);
  S.listings.forEach(l=>{ if(l.state===state && l.city) known.add(l.city); });
  return `<datalist id="${id}">${[...known].sort().map(c=>`<option value="${esc(c)}">`).join("")}</datalist>`;
}

/* ---------- filtering ---------- */
const active = l => l.status!=="sold";
function inLoc(l, loc=S.loc){ if(loc.state && l.state!==loc.state) return false; if(loc.city && (l.city||"").toLowerCase()!==loc.city.toLowerCase()) return false; return true; }
function filtered(){
  const f=S.f, q=f.q.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const xs = S.listings.filter(l => {
    if(f.hideSold && l.status==="sold") return false;
    if(!inLoc(l)) return false;
    if(f.cat && l.cat!==f.cat) return false;
    if(f.grades.size && !f.grades.has(l.grade)) return false;
    if(f.min && Number(l.price) < Number(f.min)) return false;
    if(f.max && Number(l.price) > Number(f.max)) return false;
    if(f.batt && !(l.battery!=null && l.battery>=Number(f.batt))) return false;
    if(f.lockOnly && !l.lockOff) return false;
    if(words.length){ const hay=`${l.title} ${l.storage} ${catOf(l.cat).n} ${l.desc} ${l.city} ${STATES[l.state]||""}`.toLowerCase(); if(!words.every(w=>hay.includes(w))) return false; }
    return true;
  });
  const by = {new:(a,b)=>b.createdAt-a.createdAt, low:(a,b)=>a.price-b.price, high:(a,b)=>b.price-a.price, batt:(a,b)=>(b.battery??-1)-(a.battery??-1)}[f.sort] || ((a,b)=>b.createdAt-a.createdAt);
  return xs.sort(by);
}
function shopHash(){
  const p=new URLSearchParams(), f=S.f;
  if(S.loc.state) p.set("state",S.loc.state); if(S.loc.city) p.set("city",S.loc.city);
  if(f.cat) p.set("cat",f.cat); if(f.q) p.set("q",f.q); if(f.min) p.set("min",f.min); if(f.max) p.set("max",f.max);
  if(f.grades.size) p.set("grade",[...f.grades].join("")); if(f.batt) p.set("batt",f.batt); if(f.lockOnly) p.set("lock","1");
  if(f.sort!=="new") p.set("sort",f.sort);
  const s=p.toString(); return "shop"+(s?"?"+s:"");
}
function syncShopHash(){ if(S.route==="shop"){ const h="#"+shopHash(); if(location.hash!==h) history.replaceState(null,"",h); } }
function setLoc(state, city){ S.loc={state:state||"", city:(state&&city)||""}; lsSet("as_loc", S.loc); }

/* ---------- cards ---------- */
function cardHTML(l, opts={}){
  const st = l.status!=="active" ? `<span class="status ${l.status}">${l.status==="sold"?"Sold":"Reserved"}</span>` : (l.origPrice && l.origPrice>l.price ? `<span class="status drop">Price drop</span>` : "<span></span>");
  const heart = (!opts.preview) ? `<button class="heart" data-act="save" data-id="${esc(l.id)}" aria-pressed="${S.saved.has(l.id)}" aria-label="${S.saved.has(l.id)?"Remove from saved":"Save listing"}">${I.heart}</button>` : "";
  const p=(l.photos||[])[0];
  const ph = opts.previewSrc ? `<img src="${esc(opts.previewSrc)}" alt="">` : p ? `<img src="${esc(photoSrc(p))}" alt="" loading="lazy">` : (ICON[l.cat]||ICON.other);
  const hasBatt = l.battery!=null && l.battery!=="";
  return `<article class="card" ${opts.preview?"":`data-go="item-${esc(l.id)}" tabindex="0" role="link"`} aria-label="${esc(l.title)}, ${money(l.price)}">
    <div class="ph">${ph}<div class="over">${st}${heart}</div><span class="ptag">${money(l.price)}${l.origPrice&&l.origPrice>l.price?`<s>${money(l.origPrice)}</s>`:""}</span></div>
    <div class="body">
      <div class="titlerow"><h3>${esc(shortTitle(l.title))}</h3><span>${l.createdAt?(Date.now()-l.createdAt<60000?"Just now":ago(l.createdAt)):""}</span></div>
      <div class="specline">
        ${l.storage?`<span class="pill">${esc(l.storage)}</span>`:""}
        <span class="pill">Grade ${esc(l.grade)}</span>
        ${hasBatt?`<span class="pill ${battClass(Number(l.battery))}">${Number(l.battery)>=80?I.bolt:""}${Number(l.battery)}% batt</span>`:""}
        ${l.lockOff?`<span class="pill ok">${I.okc}Lock off</span>`:`<span class="pill bad">Locked</span>`}
      </div>
      <div class="meta"><span>${I.pin}${esc(placeName(l.city,l.state)||"Location not set")}</span></div>
    </div></article>`;
}
// "iPhone 15 Pro, Natural Titanium" -> "iPhone 15 Pro" on cards; full title on the listing page
const shortTitle = t => { const i=String(t||"").indexOf(","); return i>3 ? t.slice(0,i) : t; };
const placeName = (city, state) => city && state ? `${city}, ${STATES[state]||state}` : state ? STATES[state]||state : "";
const skeletons = n => Array.from({length:n},()=>`<div class="card cardsk"><div class="ph"></div><div class="body"><div class="line" style="width:40%"></div><div class="line" style="width:85%"></div><div class="line" style="width:60%"></div></div></div>`).join("");

/* ---------- views: home ---------- */
function viewHome(){
  const live = S.listings.filter(active);
  const near = live.filter(l=>inLoc(l)).sort((a,b)=>b.createdAt-a.createdAt);
  const fresh = (near.length ? near : live).slice(0,8);
  const freshTitle = near.length ? `Fresh in ${locLabel()}` : S.loc.state ? `Fresh across the US` : "Fresh listings";
  const counts = {}; live.forEach(l=>{ if(l.state) counts[l.state]=(counts[l.state]||0)+1; });
  const ordered = [...STATE_CODES].sort((a,b)=>(counts[b]||0)-(counts[a]||0) || STATES[a].localeCompare(STATES[b]));
  const shownStates = S.allStates ? ordered : ordered.slice(0,12);
  const catCount = k => live.filter(l=>l.cat===k && inLoc(l)).length;
  const popular = Object.keys(counts).sort((a,b)=>counts[b]-counts[a]).slice(0,4);
  return `
  <section class="hero"><div class="wrap herogrid">
    <div>
      <div class="eyebrow">Used Apple devices · Local pickup in all 50 states</div>
      <h1>Buy and sell used Apple gear <em>near you.</em></h1>
      <p class="lede">Every listing shows battery health, condition and Activation Lock status, so you know what you're getting before you meet.</p>
      <form class="bigsearch" data-form="heroSearch" role="search">
        <input id="heroQ" placeholder="What are you looking for?" aria-label="Search" autocomplete="off">
        <select id="heroState" aria-label="State">${stateOptions(S.loc.state, "All of the US")}</select>
        <button class="btn primary lg" type="submit">Search</button>
      </form>
      <div class="quick">
        <span class="muted" style="font-size:13.5px">Popular:</span>
        ${["iPhone 15","MacBook Air","AirPods Pro","iPad Air"].map(s=>`<a class="chip" href="#shop?q=${encodeURIComponent(s)}${S.loc.state?"&state="+S.loc.state:""}">${s}</a>`).join("")}
      </div>
    </div>
    <div class="trust" aria-hidden="true">
      <div class="thead"><span class="eyebrow">What every listing shows</span><span class="pill ok">Checked</span></div>
      <div class="dev"><div class="ic">${ICON.iphone.replace('width="64" height="64"','width="40" height="40"')}</div><div><b>iPhone 15 Pro · 256 GB</b><div class="muted" style="font-size:13.5px">Example listing</div></div></div>
      <ul>
        <li><span>Battery health</span><b><span class="meter"><i style="width:92%;background:var(--ok)"></i></span>92%</b></li>
        <li><span>Condition</span><b>Grade A · Pristine</b></li>
        <li><span>Activation Lock</span><b class="ok">Off</b></li>
        <li><span>Pickup</span><b>City, State</b></li>
        <li><span>Payment</span><b>In person</b></li>
      </ul>
    </div>
  </div></section>

  <section class="section"><div class="wrap">
    <div class="sechead"><h2>Shop by device</h2><span class="muted">${esc(locLabel())}</span></div>
    <div class="cats">${CATS.map(c=>`<a class="cat" href="#shop?cat=${c.k}${S.loc.state?"&state="+S.loc.state:""}${S.loc.city?"&city="+encodeURIComponent(S.loc.city):""}"><span class="ic">${ICON[c.k]}</span><b>${c.n}</b><span>${catCount(c.k)} listed</span></a>`).join("")}</div>
  </div></section>

  <section class="section"><div class="wrap">
    <div class="sechead"><h2>${esc(freshTitle)}</h2><a class="btn sm" href="#shop">See all</a></div>
    ${!S.loaded ? `<div class="grid">${skeletons(4)}</div>` : fresh.length ? `<div class="grid">${fresh.map(l=>cardHTML(l)).join("")}</div>`
      : `<div class="empty"><div class="ic">${ICON.iphone.replace('width="64" height="64"','width="36" height="36"')}</div><h2>Be the first to list in ${esc(locLabel())}</h2><p class="muted">Post a used iPhone, iPad, Mac, Watch or AirPods in about two minutes. Buyers nearby will see it right away.</p><a class="btn primary" href="#sell">Sell a device</a></div>`}
  </div></section>

  <section class="section"><div class="wrap">
    <div class="sechead"><h2>Browse by state</h2>${popular.length?`<span class="muted">Most active: ${popular.map(s=>esc(STATES[s])).join(", ")}</span>`:""}</div>
    <div class="states">${shownStates.map(c=>`<a class="statelink ${counts[c]?"":"zero"}" href="#shop?state=${c}"><span><span class="ab">${c}</span>${esc(STATES[c])}</span><span class="n">${counts[c]||0}</span></a>`).join("")}</div>
    <div style="margin-top:12px"><button class="btn sm" data-act="allStates">${S.allStates?"Show fewer states":"Show all 50 states and DC"}</button></div>
  </div></section>

  <section class="section" id="how"><div class="wrap">
    <div class="sechead"><h2>How it works</h2></div>
    <div class="steps">
      <div class="step"><h3>List it in two minutes</h3><p>Add photos, the model, battery health and your city. Your listing shows up for buyers in your state right away.</p></div>
      <div class="step"><h3>Chat and agree a price</h3><p>Buyers message you or send an offer. Accept one and the device is reserved for them.</p></div>
      <div class="step"><h3>Meet and pay in person</h3><p>Meet somewhere public. The buyer checks it works and is signed out of Find My, then pays you.</p></div>
    </div>
  </div></section>`;
}

/* ---------- views: shop ---------- */
function viewShop(){
  const f=S.f, xs=filtered();
  const cat = f.cat ? catOf(f.cat).p : "Used Apple devices";
  const title = `${cat} ${S.loc.state ? "in "+locLabel() : "across the US"}`;
  const pool = S.listings.filter(l=>active(l) && l.state===S.loc.state && (!f.cat||l.cat===f.cat));
  const cityCounts = {}; pool.forEach(l=>{ if(l.city) cityCounts[l.city]=(cityCounts[l.city]||0)+1; });
  const cityChips = S.loc.state ? `<div class="citybar" aria-label="Cities">
      <button class="chip ${!S.loc.city?"on":""}" data-act="setCity" data-city="">All of ${esc(STATES[S.loc.state])} <span class="n">${pool.length}</span></button>
      ${Object.keys(cityCounts).sort((a,b)=>cityCounts[b]-cityCounts[a]).map(c=>`<button class="chip ${S.loc.city&&S.loc.city.toLowerCase()===c.toLowerCase()?"on":""}" data-act="setCity" data-city="${esc(c)}">${esc(c)} <span class="n">${cityCounts[c]}</span></button>`).join("")}
    </div>` : "";
  const activeF = [];
  if(f.q) activeF.push(["q",`“${f.q}”`]);
  f.grades.forEach(g=>activeF.push(["grade:"+g, GRADES[g].n]));
  if(f.min) activeF.push(["min",`Over ${money(f.min)}`]);
  if(f.max) activeF.push(["max",`Under ${money(f.max)}`]);
  if(f.batt) activeF.push(["batt",`Battery ${f.batt}%+`]);
  if(f.lockOnly) activeF.push(["lock","Lock off"]);
  let body;
  if(!S.loaded) body = `<div class="grid">${skeletons(8)}</div>`;
  else if(!xs.length) body = `<div class="empty"><h2>No matches ${S.loc.state?"in "+esc(locLabel()):""}</h2><p class="muted">${S.loc.city?`Try all of ${esc(STATES[S.loc.state])}, or clear some filters.`:S.loc.state?"Try searching across the US, or clear some filters.":"Try clearing some filters."}</p><div class="actions">${S.loc.city?`<button class="btn" data-act="setCity" data-city="">All of ${esc(STATES[S.loc.state])}</button>`:S.loc.state?`<button class="btn" data-act="clearLoc">Search all of the US</button>`:""}<button class="btn ghost" data-act="reset">Clear filters</button><a class="btn primary" href="#sell">Sell one here</a></div></div>`;
  else body = `<div class="grid">${xs.map(l=>cardHTML(l)).join("")}</div>`;
  return `<div class="wrap">
    <div class="shophead">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="#shop" data-act="clearLoc">United States</a>${S.loc.state?` / <a href="#shop?state=${S.loc.state}" data-act="setCity" data-city="">${esc(STATES[S.loc.state])}</a>`:""}${S.loc.city?` / <span>${esc(S.loc.city)}</span>`:""}</nav>
      <h1>${esc(title)}</h1>
      ${cityChips}
    </div>
    <div class="shop">
      <aside class="rail ${S.railOpen?"open":""}" aria-label="Filters">
        <fieldset><legend class="eyebrow">Location</legend>
          <select class="input" id="fState" aria-label="State">${stateOptions(S.loc.state,"All of the US")}</select>
          ${S.loc.state?`<input class="input" id="fCity" list="fCities" placeholder="Any city in ${esc(S.loc.state)}" value="${esc(S.loc.city)}" aria-label="City">${cityList("fCities",S.loc.state)}`:""}
        </fieldset>
        <fieldset><legend class="eyebrow">Device</legend><div class="chips">
          <button class="chip" data-act="cat" data-k="" aria-pressed="${!f.cat}">All</button>
          ${CATS.map(c=>`<button class="chip" data-act="cat" data-k="${c.k}" aria-pressed="${f.cat===c.k}">${c.n}</button>`).join("")}</div></fieldset>
        <fieldset><legend class="eyebrow">Condition</legend><div class="chips">${Object.entries(GRADES).map(([g,v])=>`<button class="chip" data-act="grade" data-k="${g}" aria-pressed="${f.grades.has(g)}" title="${esc(v.t)}">${v.n}</button>`).join("")}</div></fieldset>
        <fieldset><legend class="eyebrow">Price</legend><div class="row2">
          <div class="prefix"><span>$</span><input class="input" id="fmin" type="number" min="0" inputmode="numeric" placeholder="Min" value="${esc(f.min)}" aria-label="Minimum price"></div>
          <div class="prefix"><span>$</span><input class="input" id="fmax" type="number" min="0" inputmode="numeric" placeholder="Max" value="${esc(f.max)}" aria-label="Maximum price"></div></div></fieldset>
        <fieldset><legend class="eyebrow">Battery health</legend>
          <select class="input" id="fbatt" aria-label="Minimum battery health"><option value="">Any</option>${[95,90,85,80].map(v=>`<option value="${v}" ${String(f.batt)===String(v)?"selected":""}>${v}% or higher</option>`).join("")}</select></fieldset>
        <label class="check"><input id="flock" type="checkbox" ${f.lockOnly?"checked":""}> Activation Lock off only</label>
        <label class="check"><input id="fsold" type="checkbox" ${f.hideSold?"checked":""}> Hide sold</label>
        <button class="btn sm ghost" data-act="reset" style="align-self:flex-start">Clear all filters</button>
      </aside>
      <section style="min-width:0">
        <div class="listbar">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b>${xs.length} ${xs.length===1?"result":"results"}</b><button class="btn sm mfilter" data-act="rail">Filters</button><div class="activef">${activeF.map(([k,t])=>`<button data-act="unf" data-k="${esc(k)}" aria-label="Remove filter ${esc(t)}">${esc(t)} ×</button>`).join("")}</div></div>
          <select class="selectsm" id="fsort" aria-label="Sort">
            <option value="new" ${f.sort==="new"?"selected":""}>Newest first</option>
            <option value="low" ${f.sort==="low"?"selected":""}>Price: low to high</option>
            <option value="high" ${f.sort==="high"?"selected":""}>Price: high to low</option>
            <option value="batt" ${f.sort==="batt"?"selected":""}>Best battery</option>
          </select>
        </div>${body}
      </section>
    </div></div>`;
}

/* ---------- views: item ---------- */
const findListing = id => S.listings.find(l=>l.id===id) || (S.mine||[]).find(l=>l.id===id);
function sheetHTML(l){
  const g = GRADES[l.grade]||GRADES.B;
  return `<div class="sheet">
    <div class="hd"><span class="eyebrow">Inspection sheet</span><span class="mono muted" style="font-size:12px">#${esc(l.id.slice(1,9).toUpperCase())}</span></div>
    <dl>
      <dt>Device</dt><dd>${esc(catOf(l.cat).n)}</dd>
      ${l.storage?`<dt>Storage</dt><dd>${esc(l.storage)}</dd>`:""}
      <dt>Condition</dt><dd>${esc(g.n)} · ${esc(g.t)}<br><span class="muted" style="font-family:var(--font)">${esc(g.d)}</span></dd>
      ${(l.checks||[]).length?`<dt>Seller confirms</dt><dd>${l.checks.map(k=>esc((CHECKS.find(c=>c[0]===k)||[k,k])[1])).join("<br>")}</dd>`:""}
      ${l.battery!=null?`<dt>Battery health</dt><dd><span class="meter"><i style="width:${Math.max(0,Math.min(100,l.battery))}%;background:${battColor(l.battery)}"></i></span>${l.battery}%</dd>`:""}
      <dt>Activation Lock</dt><dd style="color:var(--${l.lockOff?"ok":"bad"})">${l.lockOff?"Off · ready to set up":"On · seller must remove"}</dd>
      <dt>Pickup</dt><dd>${esc(placeLabel(l.city,l.state)||"Ask seller")}</dd>
      <dt>Payment</dt><dd>In person at pickup</dd>
    </dl></div>`;
}
function buyerThread(l){ return S.threads.find(t=>t.listingId===l.id && isMe(t.buyerId)) || {id:null, listingId:l.id, sellerId:l.sellerId, sellerName:l.sellerName, buyerId:S.me.id, fresh:true}; }
const isPhone = () => matchMedia("(max-width:720px)").matches;
const clock = t => new Date(t).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});
function dayLabel(t){
  const d=new Date(t), now=new Date(), y=new Date(now); y.setDate(now.getDate()-1);
  if(d.toDateString()===now.toDateString()) return "Today";
  if(d.toDateString()===y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
}
const QUICK = ["Hi! Is this still available?","Can I see it working before I pay?","Is the price negotiable?","When and where could we meet?"];
// One conversation: listing header, messages, composer. Used full-screen (chat/thread routes) and in the desktop inbox.
function convoHTML(t, l, opts={}){
  const seller = isMe(t.sellerId);
  const otherId = seller ? t.buyerId : t.sellerId, otherName = seller ? t.buyerName : t.sellerName;
  const ms = (t.id && S.msgTid===t.id ? S.msgs : []).concat(S.pending.filter(p=>p.tid===(t.id||"new:"+t.listingId)));
  const lid = l ? l.id : t.listingId, title = l ? l.title : t.listingTitle, price = l ? l.price : t.listingPrice, status = l ? l.status : t.listingStatus;
  const photo = l ? (l.photos||[])[0] : t.listingPhoto;
  const open = !!l && status!=="sold";
  let lastDay="", lastMineIdx=-1;
  ms.forEach((m,i)=>{ if(isMe(m.from) && m.kind!=="sys") lastMineIdx=i; });
  const items = ms.map((m,i)=>{
    let out="";
    const dl=dayLabel(m.at); if(dl!==lastDay){ lastDay=dl; out+=`<div class="daysep"><span>${dl}</span></div>`; }
    const mine=isMe(m.from);
    if(m.kind==="sys") return out+`<div class="bub sys">${I.check}<span>${esc(m.text)}</span></div>`;
    let body;
    if(m.kind==="offer"){
      const canAccept = seller && !mine && status==="active" && !m.pending;
      body = `<div class="offerbub"><span class="eyebrow">${mine?"You offered":"Offer"}</span><b>${money(m.amount)}</b>${price?`<span class="muted">Asking ${money(price)}</span>`:""}${canAccept?`<button class="btn primary sm" data-act="accept" data-amt="${Number(m.amount)}">Accept &amp; reserve</button>`:""}</div>`;
    } else body = `<span class="tx">${esc(m.text)}</span>`;
    const seen = mine && i===lastMineIdx && !m.pending && t.otherReadAt && t.otherReadAt>=m.at;
    const meta = m.pending ? "Sending…" : clock(m.at) + (seen ? " · Seen" : "");
    return out+`<div class="bub ${mine?"me":""} ${m.kind==="offer"?"isoffer":""} ${m.pending?"pending":""}">${body}<span class="bt">${meta}</span></div>`;
  }).join("");
  const empty = !ms.length ? `<div class="convempty">${avatar(otherId, otherName, 52)}<b>${seller?"No messages yet":`Ask ${esc(otherName||"the seller")} about this ${esc(catOf(l?l.cat:"").n)}`}</b><p class="muted">${seller?"":"Questions about condition, battery or pickup are a good start. Keep payment and meetup in person."}</p></div>` : "";
  const quick = open && !seller && !ms.length ? `<div class="quickq">${QUICK.map(q=>`<button type="button" class="chip" data-act="quick" data-text="${esc(q)}">${esc(q)}</button>`).join("")}</div>` : "";
  const ask = Number(price)||0, presets = [ask, Math.round(ask*.95/5)*5, Math.round(ask*.9/5)*5].filter((v,i,a)=>v>0 && a.indexOf(v)===i);
  const offerPanel = open && !seller && status==="active" && S.offerOpen ? `<form class="offerpanel" data-form="offer" novalidate>
      <div class="op-h"><b>Make an offer</b><button type="button" class="iconbtn sm" data-act="offerClose" aria-label="Close offer">×</button></div>
      <div class="op-presets">${presets.map(v=>`<button type="button" class="chip" data-act="offerPreset" data-v="${v}">${money(v)}${v===ask?" · asking":""}</button>`).join("")}</div>
      <div class="op-row"><div class="bigprice sm"><span>$</span><input id="offerAmt" type="number" min="1" step="1" inputmode="numeric" value="${esc(S.offerAmt||presets[1]||ask)}" aria-label="Offer amount"></div><button class="btn primary" type="submit">Send offer</button></div>
      <p class="fine" style="text-align:left">If the seller accepts, the device is reserved for you. You pay in person at pickup.</p></form>` : "";
  const draft = (S.msgDraft[t.id||"new:"+lid]||"");
  const composer = open ? `${quick}${offerPanel}<form class="composer" data-form="msg">
      ${!seller && status==="active" && !S.offerOpen ? `<button type="button" class="btn sm offerbtn" data-act="offerOpen">${I.tagi||"$"} Offer</button>` : ""}
      <textarea id="msgText" rows="1" maxlength="1000" placeholder="Message ${esc(otherName||"")}" aria-label="Message">${esc(draft)}</textarea>
      <button class="sendbtn" type="submit" aria-label="Send">${I.send}</button></form>`
    : `<div class="closed">${l?(status==="sold"?"This device has sold. You can still read this conversation.":""):"This listing was removed."}</div>`;
  const back = opts.embedded ? "" : `<a class="iconbtn" href="${opts.backHref||"#inbox"}" aria-label="Back">${I.left}</a>`;
  return `<section class="convo ${opts.embedded?"embedded":""}" aria-label="Conversation with ${esc(otherName||"")}">
    <header class="convhead">${back}
      <a class="person" href="#seller-${esc(otherId)}">${avatar(otherId, otherName, 36)}<span><b>${esc(otherName||"Someone")}</b><span class="role">${seller?"Buyer":"Seller"}${l&&l.city?` · ${esc(l.city)}, ${esc(l.state)}`:""}</span></span></a>
    </header>
    <a class="convlisting" href="#item-${esc(lid)}"><span class="tthumb">${photo?`<img src="${esc(photoSrc(photo))}" alt="">`:(ICON[l?l.cat:"other"]||ICON.other)}</span><span class="grow"><b>${esc(title||"Listing")}</b><span>${money(price)}${status&&status!=="active"?` · <span class="status ${status}">${status}</span>`:""}</span></span>${I.right}</a>
    <div class="msgs2" id="msgs">${empty}${items}</div>
    <div class="convfoot">${composer}</div>
  </section>`;
}
function threadRow(t, cur){
  const selling=isMe(t.sellerId), on=selling?t.buyerName:t.sellerName;
  return `<a class="th-i" href="#thread-${esc(t.id)}" aria-current="${t.id===cur}"><span class="tthumb">${t.listingPhoto?`<img src="${esc(photoSrc(t.listingPhoto))}" alt="">`:ICON.other}</span>
    <span class="tx"><div class="r1"><b>${esc(on||"Someone")}</b><span class="muted">${ago(t.updatedAt)}</span></div><div class="r2">${esc(t.listingTitle)}</div><div class="r3 ${t.unread?"un":""}">${isMe(t.lastFrom)?"You: ":""}${esc(t.last)}</div></span>${t.unread&&t.id!==cur?'<span class="unreaddot" aria-label="Unread"></span>':""}</a>`;
}
function viewInbox(threadId){
  if(!S.me){ goSignIn(); return ""; }
  const tf=S.inboxTab;
  const list = S.threads.filter(t=> tf==="buying" ? isMe(t.buyerId) : tf==="selling" ? isMe(t.sellerId) : true);
  const tabs = `<div class="tabs" role="tablist">${[["all","All"],["buying","Buying"],["selling","Selling"]].map(([k,n])=>`<button role="tab" aria-selected="${tf===k}" data-act="inboxTab" data-k="${k}">${n}${k!=="all"?` <span class="mono muted">${S.threads.filter(t=>k==="buying"?isMe(t.buyerId):isMe(t.sellerId)).length}</span>`:""}</button>`).join("")}</div>`;
  if(!S.threads.length) return `<div class="wrap"><div class="pagehead"><h1>Messages</h1></div><div class="empty" style="margin-bottom:50px"><div class="ic">${I.chat}</div><h2>No conversations yet</h2><p class="muted">Tap “Message seller” on any listing to ask about it. When you sell, buyers' questions show up here too.</p><div class="actions"><a class="btn primary" href="#shop">Browse devices</a><a class="btn" href="#sell">Sell a device</a></div></div></div>`;
  const cur = threadId ? S.threads.find(t=>t.id===threadId) : (!isPhone() ? list[0] : null);
  if(threadId && !cur) return `<div class="wrap" style="padding-block:30px"><div class="empty"><h2>${S.threadsLoaded?"Conversation not found":"Loading…"}</h2><a class="btn" href="#inbox">All messages</a></div></div>`;
  if(cur){ S.activeThread=cur.id; wantMsgs(cur.id); }
  const l = cur && findListing(cur.listingId);
  if(isPhone() && cur) return convoHTML(cur, l, {backHref:"#inbox"});
  return `<div class="wrap"><div class="pagehead"><h1>Messages</h1></div>${tabs}
    <div class="inbox"><div class="threads">${list.length?list.map(t=>threadRow(t, cur&&cur.id)).join(""):`<p class="muted" style="padding:16px">Nothing here yet.</p>`}</div>
    ${!isPhone()?`<div style="min-width:0">${cur?convoHTML(cur, l, {embedded:true}):""}</div>`:""}</div></div>`;
}
function viewChat(listingId){
  if(!S.me){ goSignIn(); return ""; }
  const l = findListing(listingId);
  if(!l) return `<div class="wrap" style="padding-block:30px"><div class="empty"><h2>${S.loaded?"This listing was removed":"Loading…"}</h2><a class="btn" href="#inbox">Messages</a></div></div>`;
  if(isMe(l.sellerId)){ setTimeout(()=>{ location.hash="item-"+l.id; },0); return ""; }
  const t = buyerThread(l);
  S.activeThread = t.id; if(t.id) wantMsgs(t.id); else { S.msgTid=null; S.msgs=[]; }
  return `<div class="wrap chatwrap">${convoHTML(t, l, {backHref:"#item-"+l.id})}</div>`;
}
function scrollMsgsBottom(){ const m=$("#msgs"); if(m) m.scrollTop=m.scrollHeight; }
function growComposer(){ const ta=$("#msgText"); if(ta){ ta.style.height="auto"; ta.style.height=Math.min(140, ta.scrollHeight)+"px"; } }
function viewItem(id){
  const l = findListing(id);
  if(!l) return `<div class="wrap" style="padding-block:30px"><div class="empty"><h2>${S.loaded?"This listing was removed":"Loading…"}</h2>${S.loaded?`<a class="btn" href="#shop">Browse devices</a>`:""}</div></div>`;
  pingView(l);
  const photos = (l.photos||[]).map(photoSrc);
  const ix = Math.min(S.photoIx, Math.max(0,photos.length-1));
  const main = photos.length ? `<img src="${esc(photos[ix])}" alt="${esc(l.title)}, photo ${ix+1} of ${photos.length}">` : (ICON[l.cat]||ICON.other).replace('width="64" height="64"','width="150" height="150"');
  const mine = isMe(l.sellerId);
  let actions="", chat="", cta="", buybar="";
  if(mine){
    actions = `<div class="actions">
      <a class="btn" href="#edit-${esc(l.id)}">Edit listing</a>
      ${l.status==="active"?`<button class="btn" data-act="status" data-id="${esc(l.id)}" data-s="reserved">Mark reserved</button>`:""}
      ${l.status!=="sold"?`<button class="btn primary" data-act="status" data-id="${esc(l.id)}" data-s="sold">Mark sold</button>`:""}
      ${l.status!=="active"?`<button class="btn" data-act="status" data-id="${esc(l.id)}" data-s="active">Relist</button>`:""}
      <button class="btn ghost danger" data-act="askDel" data-id="${esc(l.id)}">Delete</button></div>`;
    const ts = S.threads.filter(t=>t.listingId===l.id && isMe(t.sellerId));
    chat = ts.length ? `<div class="sellerthreads"><div class="eyebrow">Buyers asking (${ts.length})</div><div class="threads">${ts.map(t=>threadRow(t,null)).join("")}</div></div>`
      : `<div class="notice plain"><span>No buyers have messaged yet. Share the link to get more eyes on it.</span><button class="btn sm" data-act="share">${I.share} Copy link</button></div>`;
  } else {
    const t = S.me ? S.threads.find(x=>x.listingId===l.id && isMe(x.buyerId)) : null;
    if(S.me && l.status==="reserved" && l.reservedFor && !isMe(l.reservedFor)) actions = `<div class="notice warn">Reserved for another buyer. You can still message the seller in case it falls through.</div>`;
    if(S.me && l.status==="reserved" && isMe(l.reservedFor)) actions = `<div class="notice">${I.check}<span>Reserved for you at <b>${money(l.agreedPrice||l.price)}</b>. Pay at pickup after you've checked the device works and Activation Lock is off.</span></div>`;
    const btns = l.status==="sold" ? `<button class="btn lg" disabled>Sold</button>`
      : `<a class="btn primary lg" href="#chat-${esc(l.id)}">${I.chat}${t?"Continue chat":"Message seller"}</a>${l.status==="active"?`<a class="btn lg" href="#chat-${esc(l.id)}?offer=1">Make offer</a>`:""}`;
    cta = `<div class="cta">${btns}</div>${t?`<a class="lastmsg" href="#chat-${esc(l.id)}">${t.unread?'<span class="unreaddot"></span>':""}<span>${isMe(t.lastFrom)?"You: ":esc((t.sellerName||"Seller").split(" ")[0])+": "}${esc(t.last)}</span><span class="muted">${ago(t.updatedAt)}</span></a>`:!S.me&&l.status!=="sold"?`<p class="muted" style="font-size:13px">You'll be asked to sign in first. It's free.</p>`:""}`;
    if(l.status!=="sold") buybar = `<div class="buybar"><a class="btn primary" href="#chat-${esc(l.id)}">${I.chat}${t?"Continue chat":"Message seller"}</a>${l.status==="active"?`<a class="btn" href="#chat-${esc(l.id)}?offer=1">Make offer</a>`:""}</div>`;
  }
  const similar = S.listings.filter(x=>x.id!==l.id && active(x) && x.cat===l.cat).sort((a,b)=>(b.state===l.state)-(a.state===l.state) || b.createdAt-a.createdAt).slice(0,4);
  return `<div class="wrap">
  <nav class="crumbs" aria-label="Breadcrumb" style="padding-top:20px"><a href="#shop">United States</a>${l.state?` / <a href="#shop?state=${esc(l.state)}">${esc(STATES[l.state]||l.state)}</a>`:""}${l.city?` / <a href="#shop?state=${esc(l.state)}&city=${encodeURIComponent(l.city)}">${esc(l.city)}</a>`:""} / <a href="#shop?cat=${esc(l.cat)}${l.state?"&state="+esc(l.state):""}">${esc(catOf(l.cat).p)}</a></nav>
  <div class="item">
    <div class="gallery">
      <div class="gmain">${main}
        ${photos.length>1?`<button class="gnav l" data-act="photo" data-i="${(ix-1+photos.length)%photos.length}" aria-label="Previous photo">${I.left}</button><button class="gnav r" data-act="photo" data-i="${(ix+1)%photos.length}" aria-label="Next photo">${I.right}</button><span class="gcount">${ix+1} / ${photos.length}</span>`:""}
        <div class="over">${l.status!=="active"?`<span class="status ${l.status}">${l.status==="sold"?"Sold":"Reserved"}</span>`:"<span></span>"}</div>
      </div>
      ${photos.length>1?`<div class="thumbs">${photos.map((p,i)=>`<button data-act="photo" data-i="${i}" aria-current="${i===ix}" aria-label="Photo ${i+1}"><img src="${esc(p)}" alt=""></button>`).join("")}</div>`:""}
    </div>
    <div class="side">
      <div><div class="eyebrow">${esc(catOf(l.cat).n)}${l.storage?" · "+esc(l.storage):""}</div><h1 style="margin-top:6px">${esc(l.title)}</h1></div>
      <div class="pricebig"><span class="tag">${money(l.price)}</span>${l.origPrice&&l.origPrice>l.price?`<span class="dropnote">Dropped from ${money(l.origPrice)}</span>`:""}</div>
      <div class="locline">${I.pin}<span>Pickup in ${l.city?`<a href="#shop?state=${esc(l.state)}&city=${encodeURIComponent(l.city)}">${esc(l.city)}</a>, `:""}<a href="#shop?state=${esc(l.state)}">${esc(STATES[l.state]||l.state||"—")}</a></span></div>
      <div class="stats"><span>Listed ${ago(l.createdAt)}</span>${l.views?`<span>${I.eye}${l.views} ${l.views===1?"view":"views"}</span>`:""}</div>
      ${cta}
      <a class="sellercard" href="#seller-${esc(l.sellerId)}">${avatar(l.sellerId,l.sellerName,42)}<span class="grow"><b>${esc(showName(l.sellerId,l.sellerName))}</b><span class="muted" style="display:block;font-size:13px">See all listings from this seller</span></span>${I.right}</a>
      ${actions}
      <div class="actions">${!mine&&l.status!=="sold"?`<button class="btn sm" data-act="save" data-id="${esc(l.id)}" aria-pressed="${S.saved.has(l.id)}">${I.heart} ${S.saved.has(l.id)?"Saved":"Save"}</button>`:""}<button class="btn sm" data-act="share">${I.share} Copy link</button>${!mine?`<button class="btn sm ghost" data-act="report" data-id="${esc(l.id)}">${I.flag} Report</button>`:""}</div>
      ${sheetHTML(l)}
      ${l.desc?`<div><div class="eyebrow" style="margin-bottom:6px">From the seller</div><p class="desc">${esc(l.desc)}</p></div>`:""}
      ${chat}
      <div class="notice plain" style="font-size:13.5px">${I.shield}<span>Meet in a public place. Check it powers on, shows the battery health listed, and is signed out of Find My before you pay.</span></div>
    </div>
  </div>
  ${buybar}
  ${similar.length?`<section class="section"><div class="sechead"><h2>More ${esc(catOf(l.cat).p)}${l.state?" near "+esc(STATES[l.state]||""):""}</h2></div><div class="grid">${similar.map(x=>cardHTML(x)).join("")}</div></section>`:""}
  </div>`;
}
function pingView(l){
  const k="as_v_"+l.id;
  try{ if(sessionStorage.getItem(k)) return; sessionStorage.setItem(k,"1"); }catch(e){}
  if(!isMe(l.sellerId)) api("POST",`/api/listings/${encodeURIComponent(l.id)}/view`).catch(()=>{});
}

/* ---------- views: sell (mockup layout) ---------- */
const blankDraft = () => { const st=(S.me&&S.me.state)||S.loc.state||"", ci=(S.me&&S.me.city)||S.loc.city||""; return {title:"",cat:"iphone",storage:"",grade:"A",battery:"",lockOff:true,checks:[],price:"",state:st,city:ci,place:ci&&st?`${ci}, ${STATES[st]}`:"",desc:"",photos:[]}; };
// "Mesa, Arizona" | "Mesa, AZ" | "mesa az" -> {city, state}
function parsePlace(v){
  const t=String(v||"").trim().replace(/\s+/g," ");
  let city="", st="";
  if(t.includes(",")){ const i=t.lastIndexOf(","); city=t.slice(0,i).trim(); st=t.slice(i+1).trim(); }
  else { const m=t.match(/^(.+)\s+([A-Za-z]{2})$/); if(m){ city=m[1].trim(); st=m[2]; } }
  const code = STATES[st.toUpperCase()] ? st.toUpperCase() : Object.keys(STATES).find(k=>STATES[k].toLowerCase()===st.toLowerCase());
  if(!code || !city || !/^[A-Za-z][A-Za-z .'\-]*$/.test(city)) return null;
  return {state:code, city:city.toLowerCase().replace(/(^|[\s\-'.])([a-z])/g,(m,p,c)=>p+c.toUpperCase())};
}
function placeList(){
  const set=new Set();
  for(const c of STATE_CODES){ (CITIES[c]||[]).forEach(ci=>set.add(`${ci}, ${STATES[c]}`)); }
  S.listings.forEach(l=>{ if(l.city&&l.state&&STATES[l.state]) set.add(`${l.city}, ${STATES[l.state]}`); });
  return `<datalist id="places">${[...set].sort().map(p=>`<option value="${esc(p)}">`).join("")}</datalist>`;
}
function draftChecks(d){
  return [
    ["add at least one photo", d.photos.length>0],
    ["enter the model and colour", !!d.title.trim()],
    ["set a price", Number(d.price)>0],
    ["enter your pickup area as City, State", !!(d.state && d.city)],
  ];
}
function marketEstimate(d){
  const model=(d.title||"").toLowerCase().replace(/,.*$/,"").trim();
  if(model.length<5) return "";
  const xs=S.listings.filter(l=>l.cat===d.cat && l.id!==d._for && l.status!=="sold" && l.title.toLowerCase().startsWith(model) && (!d.storage||l.storage===d.storage) && l.grade===d.grade).map(l=>l.price).sort((a,b)=>a-b);
  if(xs.length<2) return "";
  return `<div class="estimate">${I.trend}<span>Market estimate: ${money(xs[0])} – ${money(xs[xs.length-1])} for ${esc(d.storage?d.storage+" ":"")}Grade ${esc(d.grade)} <span class="muted" style="font-weight:500">(${xs.length} listed)</span></span></div>`;
}
function photoSlotsHTML(d){
  const tiles = d.photos.map((p,i)=>`<div class="slot photo" draggable="true" data-i="${i}"><img src="${esc(photoSrc(p))}" alt="Photo ${i+1}">${i===0?'<span class="prim">Primary</span>':""}
      <span class="mv">${i>0?`<button type="button" data-act="movePhoto" data-i="${i}" data-d="-1" aria-label="Move photo ${i+1} earlier">‹</button>`:""}${i<d.photos.length-1?`<button type="button" data-act="movePhoto" data-i="${i}" data-d="1" aria-label="Move photo ${i+1} later">›</button>`:""}</span>
      <button type="button" class="rm" data-act="rmPhoto" data-i="${i}" aria-label="Remove photo ${i+1}">×</button></div>`);
  for(let i=0;i<S.uploading;i++) tiles.push(`<div class="slot busy"><span class="spin" aria-label="Uploading"></span></div>`);
  const n=d.photos.length+S.uploading;
  const guides=["Cover Photo","Front & Screen","Back & Sides","Charging Port"];
  if(n<8 && n<guides.length) tiles.push(`<button type="button" class="slot" data-act="pickPhotos">${I.cam}${guides[n]}</button>`);
  if(n+1<8) tiles.push(`<button type="button" class="slot" data-act="pickPhotos">${I.plus}Add Angle</button>`);
  return tiles.join("");
}
function viewSell(editId){
  if(!S.me){ goSignIn(); return ""; }
  if(!S.draft || S.draft._for!==(editId||"new")){
    if(editId){
      const l = findListing(editId);
      if(!l) return `<div class="wrap" style="padding-block:30px"><div class="empty"><h2>${S.loaded?"This listing was removed":"Loading…"}</h2></div></div>`;
      if(!isMe(l.sellerId)) return `<div class="wrap" style="padding-block:30px"><div class="empty"><h2>Only the seller can edit this listing</h2><a class="btn" href="#item-${esc(l.id)}">Back to listing</a></div></div>`;
      S.draft = {title:l.title,cat:l.cat,storage:l.storage,grade:l.grade,battery:l.battery??"",lockOff:l.lockOff,checks:[...(l.checks||[])],price:l.price,state:l.state,city:l.city,place:l.city&&l.state?`${l.city}, ${STATES[l.state]}`:"",desc:l.desc,photos:[...(l.photos||[])],status:l.status,_for:editId};
    } else {
      const saved = lsGet("as_draft", null);
      S.draft = saved ? {...blankDraft(), ...saved, _for:"new"} : {...blankDraft(), _for:"new"};
      if(!Array.isArray(S.draft.checks)) S.draft.checks=[];
      if(!S.draft.place) S.draft.place = S.draft.city&&S.draft.state?`${S.draft.city}, ${STATES[S.draft.state]}`:"";
    }
    S.draftErr="";
  }
  const d=S.draft;
  const storages = STORAGE[d.cat]||[];
  const batt = d.battery===""||d.battery==null?null:Number(d.battery);
  return `<div class="wrap"><form class="sellv3" data-form="sell" novalidate>
    <div class="shead">
      <div class="top"><span class="eyebrow">${editId?"Edit listing":"New listing"}</span><span class="minttag">${I.bolt}Free to list</span></div>
      <h1>${editId?"Update your listing":"Sell an Apple Device"}</h1>
      <p class="sub">Accurate details and a clear grade help buyers trust your listing and decide faster.</p>
    </div>
    <div class="devtabs" role="radiogroup" aria-label="Device type">${CATS.map(c=>`<label><input type="radio" name="cat" value="${c.k}" ${d.cat===c.k?"checked":""}>${ICON[c.k].replace('width="64" height="64"','width="18" height="18"')}${c.k==="watch"?"Watch":c.n}</label>`).join("")}</div>

    <div class="sgrid">
      <div class="scol">
        <section class="sbox" id="photoBox" aria-labelledby="h-ph">
          <div class="bh"><h2 id="h-ph">Photos</h2><span class="note">${d.photos.length} of 8 uploaded</span></div>
          <div class="slots" id="photoGrid">${photoSlotsHTML(d)}</div>
          <input id="photoIn" type="file" accept="image/*" multiple hidden>
          <p class="note">Clear photos of corners, charging port, and screen with display ON speed up sales. Drag to reorder; the first photo is the primary.</p>
        </section>

        <section class="sbox" aria-labelledby="h-spec"><h2 id="h-spec">Device Specifications</h2>
          <div class="field"><label for="title">Model and Colour</label>
            <div class="withicon">${I.phone}<input id="title" name="title" maxlength="80" list="models" placeholder="${esc((MODELS[d.cat]||[])[4]||"Model")}, Blue" value="${esc(d.title)}" autocomplete="off"></div>
            <datalist id="models">${(MODELS[d.cat]||[]).map(m=>`<option value="${esc(m)}">`).join("")}</datalist></div>
          ${storages.length?`<div class="field"><span class="lbl">Storage Capacity</span>
            <div class="seg" role="radiogroup" aria-label="Storage capacity">${storages.map(x=>`<label><input type="radio" name="storage" value="${x}" ${d.storage===x?"checked":""}>${x}</label>`).join("")}</div></div>`:""}
          <div class="field"><label class="lbl" for="battery"><span>Battery Maximum Capacity</span>${batt==null?`<span class="note">Optional</span>`:`<span class="bstat ${batt<80?"low":""}">${batt>=80?I.bolt+"Normal condition":"Service recommended"}</span>`}</label>
            <div class="battrow"><div class="suffix"><input id="battery" name="battery" type="number" min="0" max="100" inputmode="numeric" placeholder="e.g. 89" value="${esc(d.battery)}"><span>%</span></div>
              <div class="peak" aria-hidden="true"><div class="ln"><span>Peak</span><b style="color:${batt==null?"var(--muted)":battColor(batt)}">${batt==null?"—":batt+"%"}</b></div><div class="tr"><i style="width:${batt==null?0:Math.max(0,Math.min(100,batt))}%;background:${batt==null?"var(--line)":battColor(batt)}"></i></div></div></div>
            <span class="hint">${esc(BATT_HINT[d.cat]||"")}</span></div>
        </section>

        <section class="sbox" aria-labelledby="h-cond"><div class="bh"><h2 id="h-cond">Cosmetic Condition</h2></div>
          <div class="gradelist" role="radiogroup" aria-label="Cosmetic condition">${Object.entries(GRADES).map(([k,g])=>`<label><input type="radio" name="grade" value="${k}" ${d.grade===k?"checked":""}><span><b>${g.n} · ${g.t}</b>${k==="A"?'<span class="toptag">Top Value</span>':""}<span class="gd">${g.d}</span></span></label>`).join("")}</div>
          <div class="lockcard">
            <label class="lk"><input type="checkbox" name="lockOff" id="lockOff" ${d.lockOff?"checked":""}><span><b>Activation Lock is Off ${I.unlock}</b><span class="d">Device is fully signed out of Apple ID, iCloud, and Find My.</span></span></label>
            <div class="checks">${checksFor(d.cat).map(([k,t])=>`<label><input type="checkbox" name="chk" value="${k}" ${d.checks.includes(k)?"checked":""}>${t}</label>`).join("")}<p class="chknote">Confirmed by you, the seller. Buyers can check these at pickup.</p></div>
          </div>
        </section>

        <section class="sbox" aria-labelledby="h-price"><h2 id="h-price">Price &amp; Location</h2>
          <div class="field"><label class="lbl" for="price"><span>Listing Price (USD)</span><span class="note">Zero seller commission</span></label>
            <div class="bigprice"><span>$</span><input id="price" name="price" type="number" min="1" step="1" inputmode="numeric" placeholder="750" value="${esc(d.price)}"></div>
            <div id="estimate">${marketEstimate(d)}</div></div>
          <div class="field"><label for="place">Pickup Area / Safe Exchange Spot</label>
            <div class="withicon">${I.pin.replace('width="15" height="15"','width="18" height="18"')}<input id="place" name="place" list="places" placeholder="City, State (e.g. Mesa, Arizona)" value="${esc(d.place)}" autocomplete="off"></div>${placeList()}
            <span class="hint" id="placeHint">${d.place && !(d.state&&d.city) ? '<span style="color:var(--bad)">Use “City, State”, for example “Mesa, Arizona”.</span>' : "Only the city and state are shown. Agree an exact public spot in chat."}</span></div>
          <div class="field"><label for="desc">Seller Notes</label><textarea id="desc" name="desc" rows="4" maxlength="1200" placeholder="What's included (box, cable, case), any repairs, AppleCare…">${esc(d.desc)}</textarea></div>
        </section>
      </div>

      <aside class="side3">
        <div class="ph3"><span class="eyebrow">Buyer card preview</span><span class="live"><i></i>Live preview</span></div>
        <div id="previewCard">${previewCard(d)}</div>
        <div class="safety">${I.shield}<span>Buyers pay upon pickup. Always meet in a public location and let the buyer test the device before accepting payment.</span></div>
        ${S.draftErr?`<p class="err" role="alert">${esc(S.draftErr)}</p>`:""}
        <button class="btn primary publish" type="submit" id="publishBtn" ${S.busy||S.uploading?"disabled":""}>${I.send}<span id="publishLbl">${publishLabel(d, editId)}</span></button>
        <p class="fine">By publishing, you confirm this device is yours to sell and the details above are accurate.</p>
        ${!editId&&(d.title||d.photos.length)?`<button type="button" class="btn sm ghost" data-act="clearDraft" style="align-self:center">Clear and start over</button>`:editId?`<a class="btn sm ghost" href="#item-${esc(editId)}" style="align-self:center">Cancel</a>`:""}
      </aside>
    </div>
  </form></div>`;
}
const publishLabel = (d, editId) => S.busy ? "Publishing…" : S.uploading ? "Waiting for photos…" : `${editId?"Save Changes":"Publish Listing"}${Number(d.price)>0?" · "+money(d.price):""}`;
const previewCard = d => cardHTML({...d, id:"preview", price:Number(d.price)||0, battery:d.battery===""||d.battery==null?null:Number(d.battery), createdAt:Date.now(), status:"active", title:d.title||"Your device"},{preview:true});
function saveDraftLocal(){ if(S.draft && S.draft._for==="new"){ const {_for,...rest}=S.draft; lsSet("as_draft", rest); } }

/* ---------- views: mine / saved / seller / account ---------- */
function rowHTML(l){
  const p=(l.photos||[])[0];
  return `<div class="rowi">
    <a class="th" href="#item-${esc(l.id)}" aria-label="${esc(l.title)}">${p?`<img src="${esc(photoSrc(p))}" alt="" loading="lazy">`:ICON[l.cat]||ICON.other}</a>
    <div style="min-width:0">
      <h3><a href="#item-${esc(l.id)}">${esc(l.title)}</a></h3>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:2px"><b>${money(l.price)}</b>${l.status!=="active"?`<span class="status ${l.status}" style="font-size:10px">${l.status}</span>`:""}<span class="muted" style="font-size:13px;display:inline-flex;gap:4px;align-items:center">${I.pin}${esc(placeLabel(l.city,l.state))}</span></div>
      <div class="rowstats"><span>${I.eye}${l.views||0} views</span><span>${I.chat}${l.threadCount||0} chats</span><span>${I.heart.replace('width="18" height="18"','width="15" height="15"')}${l.saveCount||0} saves</span><span>Listed ${ago(l.createdAt)}</span></div>
    </div>
    <div class="actions">
      <a class="btn sm" href="#edit-${esc(l.id)}">Edit</a>
      ${l.status==="sold"?`<button class="btn sm" data-act="status" data-id="${esc(l.id)}" data-s="active">Relist</button>`:`<button class="btn sm primary" data-act="status" data-id="${esc(l.id)}" data-s="sold">Mark sold</button>`}
      <button class="btn sm ghost danger" data-act="askDel" data-id="${esc(l.id)}">Delete</button>
    </div></div>`;
}
function viewMine(){
  if(!S.me){ goSignIn(); return ""; }
  const all = S.mine||[];
  const by = s => all.filter(l=>l.status===s);
  const tabs=[["active","Active"],["reserved","Reserved"],["sold","Sold"]];
  const xs = by(S.mineTab);
  return `<div class="wrap">
    <div class="pagehead"><div><div class="eyebrow">Selling</div><h1>My listings</h1></div><div class="actions"><a class="btn" href="#account">Account settings</a><a class="btn primary" href="#sell">Sell another</a></div></div>
    <div class="tabs" role="tablist">${tabs.map(([k,n])=>`<button role="tab" aria-selected="${S.mineTab===k}" data-act="mineTab" data-k="${k}">${n} <span class="mono muted">${by(k).length}</span></button>`).join("")}</div>
    ${S.mine==null?`<div class="rows"><p class="muted">Loading…</p></div>`: xs.length?`<div class="rows">${xs.map(rowHTML).join("")}</div>`
      : `<div class="empty" style="margin-bottom:50px"><h2>${S.mineTab==="active"?"Nothing for sale right now":S.mineTab==="reserved"?"Nothing reserved":"Nothing sold yet"}</h2><p class="muted">${S.mineTab==="active"?"List a device and it will show up for buyers in your state.":"Listings move here as buyers reserve and buy them."}</p>${S.mineTab==="active"?`<a class="btn primary" href="#sell">Sell a device</a>`:""}</div>`}
    <div class="supportcard"><span>Questions, a problem with a buyer or seller, or feedback? Applesmart is a product of <b>Hinovaiq</b>.</span><a href="mailto:support@hinovaiq.io">support@hinovaiq.io</a></div>
  </div>`;
}
function viewSaved(){
  if(!S.me){ goSignIn(); return ""; }
  const xs = S.listings.filter(l=>S.saved.has(l.id));
  return `<div class="wrap"><div class="pagehead"><div><div class="eyebrow">Your list</div><h1>Saved devices</h1></div></div>
    ${xs.length?`<div class="grid" style="padding-bottom:50px">${xs.map(l=>cardHTML(l)).join("")}</div>`:`<div class="empty" style="margin-bottom:50px"><div class="ic">${I.heart}</div><h2>Nothing saved yet</h2><p class="muted">Tap the heart on any listing to keep it here and compare later.</p><a class="btn primary" href="#shop">Browse devices</a></div>`}</div>`;
}
function viewSeller(id){
  const p = S.sellers[id];
  if(p===undefined){ loadSeller(id); }
  const xs = S.listings.filter(l=>l.sellerId===id && (isMe(id) || l.status!=="sold"));
  if(p===null) return `<div class="wrap" style="padding-block:30px"><div class="empty"><h2>This seller's account no longer exists</h2><a class="btn" href="#shop">Browse devices</a></div></div>`;
  const name = p ? showName(p.id,p.name) : (xs[0]?xs[0].sellerName:"Seller");
  return `<div class="wrap">
    <div class="profile">${avatar(id,p?p.name:name,72)}<div class="grow"><h1>${esc(name)}</h1><div class="muted" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:4px">${p&&p.state?`<span style="display:inline-flex;gap:4px;align-items:center">${I.pin}${esc(placeLabel(p.city,p.state))}</span>`:""}${p?`<span>Member since ${new Date(p.createdAt).toLocaleDateString("en-US",{month:"long",year:"numeric"})}</span>`:""}</div></div>
      ${p?`<div class="kpis"><div><b>${p.active}</b><span>For sale</span></div><div><b>${p.sold}</b><span>Sold</span></div></div>`:""}${isMe(id)?`<a class="btn" href="#account">Edit profile</a>`:""}</div>
    <div class="sechead"><h2>${isMe(id)?"Your listings":"Listings"}</h2></div>
    ${xs.length?`<div class="grid" style="padding-bottom:50px">${xs.map(l=>cardHTML(l)).join("")}</div>`:`<div class="empty" style="margin-bottom:50px"><h2>No devices for sale right now</h2></div>`}
  </div>`;
}
function viewAccount(){
  if(!S.me){ goSignIn(); return ""; }
  const m=S.me;
  return `<div class="wrap narrow">
    <div class="pagehead"><div><div class="eyebrow">Account</div><h1>Your profile</h1></div></div>
    <form class="card-form" data-form="account">
      <div class="field"><label for="accName">Display name</label><input id="accName" maxlength="40" value="${esc(m.name)}" autocomplete="name"><span class="hint">Shown to buyers and sellers.</span></div>
      <div class="row2">
        <div class="field"><label for="accState">State</label><select id="accState">${stateOptions(m.state,"Not set")}</select></div>
        <div class="field"><label for="accCity">City</label><input id="accCity" list="accCities" maxlength="40" value="${esc(m.city)}" autocomplete="address-level2">${m.state?cityList("accCities",m.state):""}</div>
      </div>
      <span class="hint muted" style="font-size:13px">Your location fills in new listings and sets what you see first when you browse.</span>
      <div class="field"><label>Email</label><input value="${esc(m.email||"")}" disabled></div>
      ${S.acctMsg?`<p class="${S.acctMsg.startsWith("Saved")?"muted":"err"}" role="status">${esc(S.acctMsg)}</p>`:""}
      <div class="actions"><button class="btn primary" type="submit" ${S.busy?"disabled":""}>Save changes</button><a class="btn ghost" href="#seller-${esc(m.id)}">View public profile</a><button class="btn ghost danger" type="button" data-act="logout" style="margin-left:auto">Sign out</button></div>
    </form>
    <div style="margin-top:16px"><div class="supportcard"><span>Questions, a problem with a buyer or seller, or feedback? Applesmart is a product of <b>Hinovaiq</b>.</span><a href="mailto:support@hinovaiq.io">support@hinovaiq.io</a></div></div></div>`;
}

/* ---------- views: inbox ---------- */
/* ---------- views: sign in ---------- */
function viewSignIn(){
  if(S.me){ location.hash = S.next || "home"; return ""; }
  const up = S.authMode==="up";
  return `<div class="wrap"><div class="auth">
    <div class="pitch"><h2>Used Apple, nearby and checked.</h2><ul>
      <li>${I.check}<span>Battery health, condition and Activation Lock on every listing</span></li>
      <li>${I.check}<span>Browse by state and city, from Seattle to Miami</span></li>
      <li>${I.check}<span>Chat, make offers, and pay in person at pickup</span></li></ul></div>
    <form data-form="auth" novalidate>
      <div><div class="eyebrow">${up?"Create an account":"Welcome back"}</div><h1 style="font-size:28px;margin-top:4px">${up?"Join Applesmart":"Sign in"}</h1></div>
      ${up?`<div class="field"><label for="aname">Your name</label><input id="aname" autocomplete="name" maxlength="40" placeholder="Shown to buyers and sellers"></div>
      <div class="row2"><div class="field"><label for="astate">State</label><select id="astate">${stateOptions(S.loc.state,"Choose later")}</select></div>
      <div class="field"><label for="acity">City</label><input id="acity" maxlength="40" autocomplete="address-level2" value="${esc(S.loc.city)}"></div></div>`:""}
      <div class="field"><label for="aemail">Email</label><input id="aemail" type="email" autocomplete="email" required></div>
      <div class="field"><label for="apass">Password</label><input id="apass" type="password" autocomplete="${up?"new-password":"current-password"}" minlength="8" required>${up?'<span class="hint">At least 8 characters.</span>':""}</div>
      ${S.authErr?`<p class="err" role="alert">${esc(S.authErr)}</p>`:""}
      <button class="btn primary lg block" type="submit" ${S.busy?"disabled":""}>${S.busy?"One moment…":up?"Create account":"Sign in"}</button>
      <p class="muted" style="font-size:14px">${up?"Already have an account?":"New to Applesmart?"} <button type="button" class="linkbtn" data-act="authMode">${up?"Sign in":"Create an account"}</button></p>
    </form></div></div>`;
}

/* ---------- dialogs ---------- */
const dlg = () => $("#dlg");
function openDialog(html){ const d=dlg(); d.innerHTML=html; if(!d.open) d.showModal(); const f=d.querySelector("input,select,button"); if(f) f.focus(); }
function closeDialog(){ const d=dlg(); if(d.open) d.close(); }
function locDialog(){
  const st=S.loc.state;
  openDialog(`<form class="dlg" data-form="loc"><h2 id="dlgTitle">Where are you shopping?</h2>
    <p class="muted" style="font-size:14px">Applesmart is local pickup only, so pick the area you can travel to.</p>
    <div class="field"><label for="locState">State</label><select id="locState">${stateOptions(st,"All of the US")}</select></div>
    <div class="field" ${st?"":"hidden"} id="locCityWrap"><label for="locCity">City <span class="muted" style="font-weight:400">(optional)</span></label><input id="locCity" list="locCities" value="${esc(S.loc.city)}" placeholder="Any city">${st?cityList("locCities",st):`<datalist id="locCities"></datalist>`}</div>
    <div class="dact">${S.me&&S.me.state?`<button type="button" class="btn ghost" data-act="useMyLoc" style="margin-right:auto">Use ${esc(placeLabel(S.me.city,S.me.state))}</button>`:""}<button type="button" class="btn ghost" data-act="closeDlg">Cancel</button><button class="btn primary" type="submit">Show listings</button></div></form>`);
}
function reportDialog(id){
  if(!S.me) return goSignIn();
  openDialog(`<form class="dlg" data-form="report" data-id="${esc(id)}"><h2 id="dlgTitle">Report this listing</h2>
    <div class="radios">${REASONS.map(([k,t],i)=>`<label><input type="radio" name="reason" value="${k}" ${i===0?"checked":""}>${t}</label>`).join("")}</div>
    <div class="field"><label for="repNote">Anything else? <span class="muted" style="font-weight:400">(optional)</span></label><textarea id="repNote" maxlength="500" rows="3"></textarea></div>
    <div class="dact"><button type="button" class="btn ghost" data-act="closeDlg">Cancel</button><button class="btn primary" type="submit">Send report</button></div></form>`);
}
function confirmDialog(text, action, id){
  openDialog(`<div class="dlg"><h2 id="dlgTitle">${esc(text)}</h2><p class="muted">This can't be undone. Photos and conversations about it are removed too.</p>
    <div class="dact"><button class="btn ghost" data-act="closeDlg">Keep it</button><button class="btn dark" data-act="${action}" data-id="${esc(id)}">Delete listing</button></div></div>`);
}

/* ---------- render ---------- */
function render(soft){
  const app=$("#app");
  const ae=document.activeElement, fid=ae&&ae.id&&app.contains(ae)?ae.id:null, sel=fid&&ae.selectionStart!=null?[ae.selectionStart,ae.selectionEnd]:null, val=fid?ae.value:null;
  const msgsEl=$("#msgs"), atBottom = msgsEl ? (msgsEl.scrollHeight-msgsEl.scrollTop-msgsEl.clientHeight<40) : true;
  const views = {home:viewHome, shop:viewShop, item:()=>viewItem(S.param), sell:()=>viewSell(null), edit:()=>viewSell(S.param), mine:viewMine, saved:viewSaved, seller:()=>viewSeller(S.param), account:viewAccount, inbox:()=>viewInbox(null), thread:()=>viewInbox(S.param), chat:()=>viewChat(S.param), signin:viewSignIn};
  app.innerHTML=(views[S.route]||viewHome)();
  if(fid){ const el=document.getElementById(fid); if(el && el!==document.activeElement){ if(["aemail","apass","aname","acity","accName","accCity","fCity"].includes(fid) && val!=null) el.value=val; el.focus({preventScroll:true}); if(sel) try{el.setSelectionRange(sel[0],sel[1]);}catch(e){} } }
  const m=$("#msgs"); if(m && (atBottom||!soft)) m.scrollTop=m.scrollHeight;
  growComposer();
  paintChrome();
}
function paintChrome(){
  const n=S.threads.filter(t=>t.unread).length;
  $("#unread").innerHTML = n?`<span class="badge">${n}</span>`:"";
  $("#unreadTab").innerHTML = n?`<span class="badge">${n}</span>`:"";
  $("#unreadBell").innerHTML = n?`<span class="badge">${n}</span>`:"";
  $("#pageLabel").textContent = {chat:"Messages",thread:"Messages",sell:"Sell",edit:"Edit",inbox:"Messages",mine:"Profile",account:"Account",saved:"Saved",signin:"Sign in",seller:"Seller"}[S.route]||"";
  document.body.classList.toggle("signedout", !S.me);
  document.body.classList.toggle("chatmode", isPhone() && (S.route==="chat" || S.route==="thread"));
  document.title = (n?`(${n}) `:"") + "Applesmart: buy and sell used Apple devices near you";
  document.body.classList.toggle("compact", ["chat","thread","sell","edit","inbox","mine","account","saved","signin","seller"].includes(S.route));
  $("#locBtn").innerHTML = `${I.pin}<span>${esc(locLabel())}</span>`;
  $("#who").innerHTML = S.me
    ? `<button class="avbtn" data-act="menu" aria-haspopup="true" aria-expanded="${S.menuOpen}" aria-label="Account menu">${avatar(S.me.id,S.me.name,36)}</button>
       ${S.menuOpen?`<div class="menu" role="menu"><div class="mhead"><b>${esc(S.me.name)}</b><div class="muted" style="font-size:13px">${esc(placeLabel(S.me.city,S.me.state)||S.me.email||"")}</div></div>
         <a href="#mine" role="menuitem">My listings</a><a href="#saved" role="menuitem">Saved</a><a href="#inbox" role="menuitem">Messages</a><a href="#seller-${esc(S.me.id)}" role="menuitem">Public profile</a><a href="#account" role="menuitem">Account settings</a><a href="mailto:support@hinovaiq.io" role="menuitem">Help &amp; support</a><button data-act="logout" role="menuitem">Sign out</button></div>`:""}`
    : `<a class="btn sm" href="#signin">Sign in</a>`;
  const tab = {chat:"inbox",thread:"inbox",home:"home",shop:"shop",item:"home",sell:"sell",edit:"sell",inbox:"inbox",mine:"mine",account:"mine",saved:"mine",signin:"mine",seller:"home"}[S.route];
  $$(".tabbar a").forEach(a=>a.classList.toggle("on", a.dataset.tab===tab));
  const tq=$("#q"); if(tq && document.activeElement!==tq) tq.value = S.route==="shop" ? S.f.q : "";
}
function goSignIn(){ const h=location.hash.slice(1); S.next = h && h!=="signin" ? h : S.next; if(location.hash!=="#signin") location.hash="signin"; }

/* ---------- routing ---------- */
function applyShopParams(qs){
  const p=new URLSearchParams(qs), f=S.f;
  // a link that names a place sets it; links without one keep the shopper's current location
  if(p.has("state")) setLoc(STATES[String(p.get("state")).toUpperCase()] ? String(p.get("state")).toUpperCase() : "", p.get("city")||"");
  if(!qs) return;
  f.q=p.get("q")||""; f.cat=p.get("cat")||""; f.min=p.get("min")||""; f.max=p.get("max")||""; f.batt=p.get("batt")||"";
  f.grades=new Set((p.get("grade")||"").split("").filter(g=>GRADES[g])); f.lockOnly=p.get("lock")==="1"; f.sort=p.get("sort")||"new";
}
function route(){
  const h=decodeURIComponent((location.hash||"").slice(1));
  const prev=S.route+S.param;
  const [name, qs] = h.split("?");
  S.menuOpen=false;
  if(name.startsWith("item-")){ S.route="item"; S.param=name.slice(5); }
  else if(name.startsWith("edit-")){ S.route="edit"; S.param=name.slice(5); }
  else if(name.startsWith("seller-")){ S.route="seller"; S.param=name.slice(7); }
  else if(name.startsWith("thread-")){ S.route="thread"; S.param=name.slice(7); }
  else if(name.startsWith("chat-")){ S.route="chat"; S.param=name.slice(5); if(new URLSearchParams(qs||"").get("offer")==="1") S.offerOpen=true; }
  else if(name==="shop"){ S.route="shop"; S.param=""; applyShopParams(qs||""); }
  else if(["sell","inbox","signin","mine","saved","account"].includes(name)){ S.route=name; S.param=""; }
  else { S.route="home"; S.param=""; }
  if(prev!==S.route+S.param){
    S.photoIx=0; S.authErr=""; S.acctMsg=""; S.railOpen=false;
    if(!["inbox","thread","chat"].includes(S.route)) S.activeThread=null;
    if(!(S.route==="chat" && /offer=1/.test(h))) S.offerOpen=false; S.offerAmt="";
    if(S.route!=="sell"&&S.route!=="edit") S.draft=null;
    if(S.route==="mine"||S.route==="edit") loadMine();
    window.scrollTo(0,0);
  }
  render();
  if(prev!==S.route+S.param) $("#app").focus({preventScroll:true});
}
addEventListener("hashchange", route);

/* ---------- data ---------- */
async function loadListings(){ try{ const xs=await api("GET","/api/listings"); const changed=JSON.stringify(xs)!==JSON.stringify(S.listings); S.listings=xs; const first=!S.loaded; S.loaded=true; if(changed||first) render(true); }catch(e){ S.loaded=true; render(true); } }
async function loadThreads(){ if(!S.me) return; try{ const ts=await api("GET","/api/threads"); const first=!S.threadsLoaded; S.threadsLoaded=true; if(first||JSON.stringify(ts)!==JSON.stringify(S.threads)){ S.threads=ts; render(true); } }catch(e){ if(e.status===401){ S.me=null; render(); } } }
async function loadSaved(){ if(!S.me) return; try{ S.saved=new Set(await api("GET","/api/saved")); render(true); }catch(e){} }
async function loadMine(){ if(!S.me) return; try{ S.mine=await api("GET","/api/mine"); if(["mine","edit"].includes(S.route)) render(true); }catch(e){} }
async function loadSeller(id){ S.sellers[id]=false; try{ S.sellers[id]=await api("GET",`/api/users/${encodeURIComponent(id)}`); }catch(e){ S.sellers[id]= e.status===404?null:false; } if(S.route==="seller") render(true); }
async function loadMsgs(){
  const tid=S.msgTid; if(!tid||!S.me) return;
  try{ const ms=await api("GET",`/api/threads/${encodeURIComponent(tid)}/messages`);
    if(tid===S.msgTid && JSON.stringify(ms)!==JSON.stringify(S.msgs)){ const hadSys=S.msgs.filter(x=>x.kind==="sys").length; S.msgs=ms; if(ms.filter(x=>x.kind==="sys").length>hadSys) loadListings(); render(true); } }catch(e){}
}
function wantMsgs(tid){ if(S.msgTid===tid) return; S.msgTid=tid; S.msgs=[]; setTimeout(loadMsgs,0); }
function every(ms, fn){ setInterval(()=>{ if(!document.hidden) fn(); }, ms); }
every(30000, loadListings);
every(5000, loadThreads);
every(3000, ()=>{ if(["chat","thread","inbox"].includes(S.route)) loadMsgs(); });
matchMedia("(max-width:720px)").addEventListener("change", ()=>render(true));
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden){ loadListings(); loadThreads(); loadMsgs(); } });

/* ---------- writes ---------- */
function currentConvo(){
  if(S.route==="chat"){ const l=findListing(S.param); return l&&S.me ? {l, t:buyerThread(l)} : null; }
  const t=S.threads.find(x=>x.id===S.activeThread); return t ? {t, l:findListing(t.listingId)} : null;
}
async function sendMsg(l, t, body){
  if(!S.me) return goSignIn();
  const key = t.id || "new:"+l.id;
  const tmp = {tid:key, from:S.me.id, kind:body.kind, text:body.text||"", amount:body.amount, at:Date.now(), pending:true};
  S.pending.push(tmp); render(true); scrollMsgsBottom();
  try{
    if(t.id) await api("POST",`/api/threads/${encodeURIComponent(t.id)}/messages`, body);
    else { const r=await api("POST",`/api/listings/${encodeURIComponent(l.id)}/messages`, body); S.activeThread=r.threadId; S.msgTid=r.threadId; }
    await loadThreads(); await loadMsgs();
  }catch(e){ if(body.kind==="text") S.msgDraft[key]=body.text; fail(e); }
  finally{ S.pending=S.pending.filter(p=>p!==tmp); render(true); scrollMsgsBottom(); }
}
function downscale(file, maxPx, q){
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => { const r=Math.min(1, maxPx/Math.max(img.width,img.height));
      const c=document.createElement("canvas"); c.width=Math.round(img.width*r); c.height=Math.round(img.height*r);
      const ctx=c.getContext("2d"); ctx.fillStyle="#fff"; ctx.fillRect(0,0,c.width,c.height); ctx.drawImage(img,0,0,c.width,c.height); URL.revokeObjectURL(url);
      res(c.toDataURL("image/jpeg",q)); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error(`“${file.name}” isn't an image this browser can read. Try a JPEG or PNG.`)); };
    img.src = url;
  });
}
async function addPhotos(files){
  const d=S.draft; if(!d) return;
  const imgs=[...files].filter(f=>/^image\//.test(f.type)||/\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
  const room = 8 - d.photos.length - S.uploading;
  if(!imgs.length){ toast("Choose image files to upload."); return; }
  if(room<=0){ toast("You can add up to 8 photos."); return; }
  const list=imgs.slice(0,room);
  if(imgs.length>room) toast(`Added ${room} of ${imgs.length}. Listings hold up to 8 photos.`);
  S.uploading+=list.length; S.draftErr=""; render();
  // upload in parallel, but add them in the order the seller picked them so the first one stays the cover
  const ids = await Promise.all(list.map(async f=>{
    try{ const data=await downscale(f,1600,.82); return (await api("POST","/api/photos",{data})).id; }
    catch(e){ S.draftErr=e.message; if(e.status===401) goSignIn(); return null; }
  }));
  S.uploading -= list.length;
  if(S.draft===d) ids.forEach(id=>{ if(id) d.photos.push(id); });
  saveDraftLocal(); render(true);
}
async function saveListing(){
  const d=S.draft; const isNew=d._for==="new";
  const body={title:d.title,cat:d.cat,storage:d.storage,grade:d.grade,battery:d.battery===""?null:Number(d.battery),lockOff:!!d.lockOff,checks:d.checks,price:Number(d.price),state:d.state,city:d.city,desc:d.desc,photos:d.photos};
  const miss = draftChecks(d).filter(c=>!c[1]).map(c=>c[0].toLowerCase());
  if(miss.length && !(miss.length===1 && miss[0].startsWith("add at least") && !isNew)){ S.draftErr = "To publish, "+miss.join(", ")+"."; render(); $(".err")&&$(".err").scrollIntoView({block:"center",behavior:"smooth"}); return; }
  S.busy=true; S.draftErr=""; render();
  try{
    let id=d._for;
    if(isNew) id=(await api("POST","/api/listings",body)).id; else await api("PUT",`/api/listings/${encodeURIComponent(id)}`,body);
    S.busy=false; S.draft=null; if(isNew) lsSet("as_draft",null);
    if(S.me && !S.me.state){ S.me.state=body.state; S.me.city=body.city; }
    await loadListings(); loadMine(); toast(isNew?"Your listing is live":"Listing updated"); location.hash="item-"+id;
  }catch(e){ S.busy=false; S.draftErr=e.message; if(e.status===401) goSignIn(); render(); }
}
async function setStatus(id, s){
  try{ await api("PATCH",`/api/listings/${encodeURIComponent(id)}/status`,{status:s}); await loadListings(); loadMine(); render(true);
    toast(s==="sold"?"Marked sold":s==="reserved"?"Marked reserved":"Relisted"); }catch(err){ fail(err); }
}
async function copyLink(){
  const url=location.href;
  try{ await navigator.clipboard.writeText(url); toast("Link copied"); }
  catch(e){ openDialog(`<div class="dlg"><h2 id="dlgTitle">Share this listing</h2><input class="input" id="shareUrl" value="${esc(url)}" readonly><div class="dact"><button class="btn primary" data-act="closeDlg">Done</button></div></div>`); const i=$("#shareUrl"); i.select(); }
}

/* ---------- events ---------- */
document.addEventListener("click", async e => {
  if(S.menuOpen && !e.target.closest(".who")){ S.menuOpen=false; paintChrome(); }
  const t=e.target.closest("[data-act],[data-go]"); if(!t) return;
  if(t.dataset.go && !e.target.closest("[data-act]")){ location.hash=t.dataset.go; return; }
  const a=t.dataset.act, f=S.f;
  const shopChanged = () => { render(); syncShopHash(); };
  switch(a){
    case "menu": S.menuOpen=!S.menuOpen; paintChrome(); break;
    case "openLoc": locDialog(); break;
    case "focusSearch": setTimeout(()=>{ const q=$("#q"); if(q) q.focus(); },80); break;
    case "closeDlg": closeDialog(); break;
    case "useMyLoc": setLoc(S.me.state,S.me.city); closeDialog(); afterLocChange(); break;
    case "allStates": S.allStates=!S.allStates; render(true); break;
    case "scrollTo": e.preventDefault(); if(S.route!=="home") location.hash="home"; setTimeout(()=>{ const el=document.getElementById(t.dataset.target); el&&el.scrollIntoView({behavior:"smooth"}); },60); break;
    case "cat": f.cat=t.dataset.k; shopChanged(); break;
    case "grade": f.grades.has(t.dataset.k)?f.grades.delete(t.dataset.k):f.grades.add(t.dataset.k); shopChanged(); break;
    case "setCity": e.preventDefault(); setLoc(S.loc.state, t.dataset.city); if(S.route!=="shop") location.hash=shopHash(); else shopChanged(); break;
    case "clearLoc": e.preventDefault(); setLoc("",""); if(S.route!=="shop") location.hash="shop"; else shopChanged(); break;
    case "unf": { const k=t.dataset.k; if(k==="q"){ f.q=""; } else if(k.startsWith("grade:")) f.grades.delete(k.slice(6)); else if(k==="lock") f.lockOnly=false; else f[k]=""; shopChanged(); break; }
    case "reset": Object.assign(f,{q:"",cat:"",grades:new Set(),min:"",max:"",batt:"",lockOnly:false,hideSold:true,sort:"new"}); shopChanged(); break;
    case "rail": S.railOpen=!S.railOpen; render(true); break;
    case "photo": S.photoIx=Number(t.dataset.i); render(true); break;
    case "inboxTab": S.inboxTab=t.dataset.k; render(true); break;
    case "offerOpen": S.offerOpen=true; render(true); setTimeout(()=>{ const i=$("#offerAmt"); i&&i.focus(); i&&i.select(); },30); break;
    case "offerClose": S.offerOpen=false; render(true); break;
    case "offerPreset": S.offerAmt=t.dataset.v; { const i=$("#offerAmt"); if(i) i.value=t.dataset.v; } break;
    case "authMode": S.authMode=S.authMode==="up"?"in":"up"; S.authErr=""; render(); break;
    case "logout": try{ await api("POST","/api/auth/logout"); }catch(err){} S.me=null; S.threads=[]; S.saved=new Set(); S.mine=null; S.msgTid=null; S.menuOpen=false; toast("Signed out"); location.hash="home"; render(); break;
    case "save": { e.stopPropagation(); if(!S.me) return goSignIn(); const id=t.dataset.id; const on=!S.saved.has(id); on?S.saved.add(id):S.saved.delete(id); render(true); toast(on?"Saved":"Removed from saved");
      try{ await api(on?"PUT":"DELETE",`/api/saved/${encodeURIComponent(id)}`); }catch(err){ fail(err); } break; }
    case "share": copyLink(); break;
    case "report": reportDialog(t.dataset.id); break;
    case "askDel": confirmDialog("Delete this listing?", "del", t.dataset.id); break;
    case "del": { const id=t.dataset.id; closeDialog(); try{ await api("DELETE",`/api/listings/${encodeURIComponent(id)}`); toast("Listing deleted"); await loadListings(); loadMine(); if(S.route==="item") location.hash="mine"; else render(true); }catch(err){ fail(err); } break; }
    case "status": setStatus(t.dataset.id, t.dataset.s); break;
    case "mineTab": S.mineTab=t.dataset.k; render(true); break;
    case "quick": { const c=currentConvo(); if(c&&c.l) sendMsg(c.l,c.t,{kind:"text",text:t.dataset.text}); break; }
    case "accept": if(!S.activeThread) return;
      try{ await api("POST",`/api/threads/${encodeURIComponent(S.activeThread)}/accept`,{amount:Number(t.dataset.amt)}); await loadListings(); await loadMsgs(); toast("Reserved for this buyer"); }catch(err){ fail(err); } break;
    case "pickPhotos": $("#photoIn")&&$("#photoIn").click(); break;
    case "rmPhoto": S.draft.photos.splice(Number(t.dataset.i),1); S.draftErr=""; saveDraftLocal(); render(true); break;
    case "movePhoto": { const i=Number(t.dataset.i), j=i+Number(t.dataset.d), p=S.draft.photos; [p[i],p[j]]=[p[j],p[i]]; saveDraftLocal(); render(true); break; }
    case "clearDraft": lsSet("as_draft",null); S.draft=null; render(); break;
  }
});
document.addEventListener("keydown", e => {
  if(e.target.id==="msgText" && e.key==="Enter" && !e.shiftKey && !e.isComposing){ e.preventDefault(); const f=e.target.form; f&&f.requestSubmit(); return; }
  if(e.key==="Enter" && e.target.matches(".card[data-go]")) location.hash=e.target.dataset.go;
  if(e.key==="Escape" && S.menuOpen){ S.menuOpen=false; paintChrome(); }
  if(S.route==="item" && !e.target.closest("input,textarea,select") && (e.key==="ArrowLeft"||e.key==="ArrowRight")){
    const l=findListing(S.param); const n=(l&&l.photos||[]).length; if(n>1){ S.photoIx=(S.photoIx+(e.key==="ArrowRight"?1:-1)+n)%n; render(true); }
  }
});
function afterLocChange(){ if(S.route==="shop"){ render(); syncShopHash(); } else if(S.route==="home") render(); else location.hash=shopHash(); }
document.addEventListener("submit", async e => {
  const form=e.target.closest("[data-form]") || (e.target.id==="searchForm"?e.target:null); if(!form) return; e.preventDefault();
  if(form.id==="searchForm"){ S.f.q=$("#q").value.trim(); location.hash=shopHash(); if(S.route==="shop") render(); return; }
  const kind=form.dataset.form;
  if(kind==="heroSearch"){ S.f.q=$("#heroQ").value.trim(); S.f.cat=""; setLoc($("#heroState").value,""); location.hash=shopHash(); return; }
  if(kind==="loc"){ const st=$("#locState").value; setLoc(st, st?$("#locCity").value.trim():""); closeDialog(); afterLocChange(); return; }
  if(kind==="sell") return saveListing();
  if(kind==="report"){ const reason=(form.querySelector("input[name=reason]:checked")||{}).value; try{ await api("POST",`/api/listings/${encodeURIComponent(form.dataset.id)}/report`,{reason,note:$("#repNote").value}); closeDialog(); toast("Thanks. We'll review this listing."); }catch(err){ closeDialog(); fail(err); } return; }
  if(kind==="account"){
    S.busy=true; S.acctMsg=""; render();
    try{ S.me=await api("PUT","/api/me",{name:$("#accName").value,state:$("#accState").value,city:$("#accCity").value}); S.busy=false; S.acctMsg="Saved."; if(S.me.state) setLoc(S.me.state,S.me.city); toast("Profile saved"); }
    catch(err){ S.busy=false; S.acctMsg=err.message; } render(); return;
  }
  if(kind==="auth"){
    const up=S.authMode==="up";
    const body={email:$("#aemail").value, password:$("#apass").value}; if(up){ body.name=$("#aname").value; body.state=$("#astate").value; body.city=$("#acity").value; }
    S.busy=true; S.authErr=""; render();
    try{ S.me=await api("POST", up?"/api/auth/register":"/api/auth/login", body); S.busy=false; toast(up?"Welcome to Applesmart":"Signed in");
      if(S.me.state && !S.loc.state) setLoc(S.me.state,S.me.city);
      loadThreads(); loadSaved(); loadMine(); location.hash = S.next && S.next!=="signin" ? S.next : "home"; render(); }
    catch(err){ S.busy=false; S.authErr=err.message; render(); }
    return;
  }
  const c = currentConvo(); if(!c || !c.l) return;
  const key = c.t.id || "new:"+c.l.id;
  if(kind==="msg"){ const inp=$("#msgText"); const v=inp.value.trim(); if(!v) return; inp.value=""; S.msgDraft[key]=""; growComposer(); sendMsg(c.l,c.t,{kind:"text",text:v}); inp.focus(); }
  if(kind==="offer"){ const v=Math.round(Number($("#offerAmt").value)); if(!(v>0)) return toast("Enter an offer above $0"); S.offerOpen=false; S.offerAmt=""; sendMsg(c.l,c.t,{kind:"offer",amount:v}); }
});
let qT;
document.addEventListener("input", e => {
  const el=e.target, f=S.f;
  if(el.id==="msgText"){ const c=currentConvo(); if(c&&c.l) S.msgDraft[c.t.id||"new:"+c.l.id]=el.value; growComposer(); return; }
  if(el.id==="offerAmt"){ S.offerAmt=el.value; return; }
  if(S.route==="shop"){
    if(el.id==="fmin"||el.id==="fmax"){ clearTimeout(qT); qT=setTimeout(()=>{ f[el.id.slice(1)]=el.value; render(); syncShopHash(); },250); return; }
    if(el.id==="fCity"){ clearTimeout(qT); qT=setTimeout(()=>{ const v=el.value.trim(); const match=[...$("#fCities").options].some(o=>o.value.toLowerCase()===v.toLowerCase()); if(!v||match){ setLoc(S.loc.state,v); render(); syncShopHash(); } },300); return; }
  }
  if(el.id==="locState"){ const st=el.value; $("#locCityWrap").hidden=!st; $("#locCity").value=""; $("#locCities").outerHTML=st?cityList("locCities",st):`<datalist id="locCities"></datalist>`; return; }
  if(el.id==="accState"){ const dl=$("#accCities"); const html=el.value?cityList("accCities",el.value):""; if(dl) dl.outerHTML=html||"<span></span>"; else if(html) $("#accCity").insertAdjacentHTML("afterend",html); return; }
  if(S.draft && el.closest('[data-form="sell"]')){
    const d=S.draft;
    if(el.id==="place"){ d.place=el.value; const p=parsePlace(el.value); d.state=p?p.state:""; d.city=p?p.city:"";
      $("#placeHint").innerHTML = !el.value.trim()||p ? "Only the city and state are shown. Agree an exact public spot in chat." : '<span style="color:var(--bad)">Use “City, State”, for example “Mesa, Arizona”.</span>'; }
    else if(el.name && !["radio","checkbox"].includes(el.type) && el.tagName!=="SELECT") d[el.name]=el.value;
    saveDraftLocal(); refreshSellSide(el.id);
  }
});
document.addEventListener("change", e => {
  const el=e.target, f=S.f;
  if(S.route==="shop"){
    if(el.id==="fsort"){ f.sort=el.value; render(); syncShopHash(); }
    if(el.id==="flock"){ f.lockOnly=el.checked; render(); syncShopHash(); }
    if(el.id==="fsold"){ f.hideSold=el.checked; render(); }
    if(el.id==="fbatt"){ f.batt=el.value; render(); syncShopHash(); }
    if(el.id==="fState"){ setLoc(el.value,""); render(); syncShopHash(); }
    if(el.id==="fCity"){ setLoc(S.loc.state, el.value.trim()); render(); syncShopHash(); }
  }
  if(el.id==="photoIn" && el.files.length){ addPhotos(el.files); el.value=""; return; }
  if(S.draft && el.closest('[data-form="sell"]')){
    const d=S.draft;
    // toggles, grade and storage change values only: update in place so the page doesn't jump
    if(el.name==="lockOff"){ d.lockOff=el.checked; saveDraftLocal(); refreshSellSide("title"); return; }
    if(el.name==="chk"){ d.checks = $$('input[name=chk]:checked').map(x=>x.value); saveDraftLocal(); return; }
    if(el.name==="grade"||el.name==="storage"){ d[el.name]=el.value; saveDraftLocal(); refreshSellSide("title"); return; }
    if(el.name==="cat"){ d.cat=el.value; if(!(STORAGE[d.cat]||[]).includes(d.storage)) d.storage=""; d.checks=d.checks.filter(k=>checksFor(d.cat).some(c=>c[0]===k)); if(["airpods","other"].includes(d.cat)) d.battery=""; }
    else if(el.type==="radio") d[el.name]=el.value;
    else return;
    saveDraftLocal(); render(true);
  }
});;
function refreshSellSide(changedId){
  const d=S.draft; if(!d) return;
  const col=$("#previewCard"); if(col) col.innerHTML=previewCard(d);
  const lbl=$("#publishLbl"); if(lbl) lbl.textContent=publishLabel(d, d._for==="new"?null:d._for);
  if(changedId==="battery"){
    const b=d.battery===""?null:Number(d.battery); const f=$("label[for=battery]");
    if(f) f.innerHTML=`<span>Battery Maximum Capacity</span>${b==null?`<span class="note">Optional</span>`:`<span class="bstat ${b<80?"low":""}">${b>=80?I.bolt+"Normal condition":"Service recommended"}</span>`}`;
    const pk=$(".peak"); if(pk) pk.innerHTML=`<div class="ln"><span>Peak</span><b style="color:${b==null?"var(--muted)":battColor(b)}">${b==null?"—":b+"%"}</b></div><div class="tr"><i style="width:${b==null?0:Math.max(0,Math.min(100,b))}%;background:${b==null?"var(--line)":battColor(b)}"></i></div>`;
  }
  if(changedId==="title"){ const e=$("#estimate"); if(e) e.innerHTML=marketEstimate(d); }
}
// photo drag and drop: files onto the drop zone, and reordering within the grid
let dragFrom=null;
document.addEventListener("dragstart", e => { const fig=e.target.closest && e.target.closest("#photoGrid .slot.photo"); if(fig){ dragFrom=Number(fig.dataset.i); fig.classList.add("dragging"); e.dataTransfer.effectAllowed="move"; } });
document.addEventListener("dragend", () => { dragFrom=null; $$("#photoGrid .slot.photo").forEach(f=>f.classList.remove("dragging","target")); });
document.addEventListener("dragover", e => {
  if(S.route!=="sell"&&S.route!=="edit") return;
  const fig=e.target.closest && e.target.closest("#photoGrid .slot.photo");
  if(dragFrom!=null && fig){ e.preventDefault(); $$("#photoGrid .slot.photo").forEach(f=>f.classList.toggle("target", f===fig)); return; }
  if(e.dataTransfer && [...e.dataTransfer.types].includes("Files")){ e.preventDefault(); const dz=$("#photoBox"); dz&&dz.classList.add("dropping"); }
});
document.addEventListener("dragleave", e => { const b=$("#photoBox"); if(b && !b.contains(e.relatedTarget)) b.classList.remove("dropping"); });
document.addEventListener("drop", e => {
  if(S.route!=="sell"&&S.route!=="edit") return;
  const fig=e.target.closest && e.target.closest("#photoGrid .slot.photo");
  if(dragFrom!=null && fig){ e.preventDefault(); const to=Number(fig.dataset.i), p=S.draft.photos; const [m]=p.splice(dragFrom,1); p.splice(to,0,m); dragFrom=null; saveDraftLocal(); render(true); return; }
  if(e.dataTransfer && e.dataTransfer.files.length){ e.preventDefault(); const dz=$("#photoBox"); dz&&dz.classList.remove("dropping"); addPhotos(e.dataTransfer.files); }
});
document.addEventListener("paste", e => { if((S.route==="sell"||S.route==="edit") && e.clipboardData && e.clipboardData.files.length) addPhotos(e.clipboardData.files); });
$("#dlg").addEventListener("click", e => { if(e.target.id==="dlg") closeDialog(); });

/* ---------- boot ---------- */
(async () => {
  paintChrome();
  try{ S.me = await api("GET","/api/me"); }catch(e){}
  if(S.me && S.me.state && !lsGet("as_loc",null)) setLoc(S.me.state, S.me.city);
  route();
  await loadListings();
  if(S.me){ loadThreads(); loadSaved(); loadMine(); }
})();
})();
