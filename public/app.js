(() => {
"use strict";
const $ = (s, el=document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money = n => "$" + Math.round(Number(n)||0).toLocaleString("en-US");
const ago = t => { const s=(Date.now()-t)/1000; if(s<60)return"just now"; if(s<3600)return Math.floor(s/60)+"m ago"; if(s<86400)return Math.floor(s/3600)+"h ago"; return Math.floor(s/86400)+"d ago"; };

const CATS = [
  {k:"iphone", n:"iPhone"}, {k:"ipad", n:"iPad"}, {k:"mac", n:"Mac"},
  {k:"watch", n:"Watch"}, {k:"airpods", n:"AirPods"}, {k:"other", n:"Accessories"}
];
const GRADES = {
  A:{n:"Grade A", d:"Like new. No visible marks."},
  B:{n:"Grade B", d:"Light wear. Minor scuffs, screen clean."},
  C:{n:"Grade C", d:"Visible wear. Fully working."}
};
const catName = k => (CATS.find(c=>c.k===k)||{n:"Device"}).n;
const ICON = {
  iphone:'<svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" stroke-width="2"><rect x="20" y="6" width="24" height="52" rx="5"/><rect x="27" y="9" width="10" height="3" rx="1.5"/></svg>',
  ipad:'<svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" stroke-width="2"><rect x="12" y="6" width="40" height="52" rx="4"/><circle cx="32" cy="9.5" r="1"/></svg>',
  mac:'<svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" stroke-width="2"><rect x="12" y="14" width="40" height="27" rx="2.5"/><path d="M6 46h52l-3 4H9z"/></svg>',
  watch:'<svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" stroke-width="2"><rect x="20" y="18" width="24" height="28" rx="7"/><path d="M24 18l2-10h12l2 10M24 46l2 10h12l2-10"/></svg>',
  airpods:'<svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" stroke-width="2"><rect x="14" y="22" width="36" height="28" rx="10"/><path d="M14 31h36"/><circle cx="32" cy="38" r="1.2"/></svg>',
  other:'<svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10h20v12H22zM32 22v10"/><path d="M32 32c0 12-14 10-14 22"/></svg>'
};
const HEART = '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.2 3.2 4.5 7 4.5c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.8 0 6.1 3.7 4.6 7.3C19.5 16.4 12 21 12 21z"/></svg>';

const S = {
  me:null, listings:[], loaded:false, threads:[], saved:new Set(),
  f:{q:"", cats:new Set(), grade:new Set(), max:"", area:"", lockOnly:false, hideSold:true, sort:"new", savedOnly:false},
  route:"browse", param:"", activeThread:null, msgs:[], msgTid:null,
  photoIx:0, confirm:null, draft:null, draftErr:"", busy:false, railOpen:false,
  authMode:"in", authErr:"", next:""
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

/* ---------- people ---------- */
function initials(n){ return (n||"?").split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join("")||"?"; }
function hue(id){ let h=0; for(const c of String(id)) h=(h*31+c.charCodeAt(0))%360; return h; }
function avatar(id, name, size=30){
  return `<span class="avatar" style="width:${size}px;height:${size}px;background:hsl(${hue(id)} 45% 42%);font-size:${Math.round(size*.4)}px" aria-hidden="true">${esc(initials(name))}</span>`;
}
const isMe = id => S.me && id===S.me.id;
const showName = (id, n) => isMe(id) ? "You" : (n||"Someone");

/* ---------- photos ---------- */
const photoSrc = id => "/api/photos/" + encodeURIComponent(id);
function photoBox(l){
  const p=(l.photos||[])[0];
  return p ? `<img src="${esc(photoSrc(p))}" alt="" loading="lazy">` : (ICON[l.cat]||ICON.other);
}
function downscale(file, maxPx, q){
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => { const r=Math.min(1, maxPx/Math.max(img.width,img.height));
      const c=document.createElement("canvas"); c.width=Math.round(img.width*r); c.height=Math.round(img.height*r);
      c.getContext("2d").drawImage(img,0,0,c.width,c.height); URL.revokeObjectURL(url);
      res(c.toDataURL("image/jpeg",q)); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("That file isn't an image we can read.")); };
    img.src = url;
  });
}

/* ---------- filtering ---------- */
function filtered(){
  const f=S.f, q=f.q.trim().toLowerCase();
  const xs = S.listings.filter(l => {
    if(f.hideSold && l.status==="sold") return false;
    if(f.cats.size && !f.cats.has(l.cat)) return false;
    if(f.grade.size && !f.grade.has(l.grade)) return false;
    if(f.max && Number(l.price) > Number(f.max)) return false;
    if(f.lockOnly && !l.lockOff) return false;
    if(f.savedOnly && !S.saved.has(l.id)) return false;
    if(f.area && !(l.area||"").toLowerCase().includes(f.area.toLowerCase())) return false;
    if(q && !(`${l.title} ${l.storage} ${catName(l.cat)} ${l.desc}`).toLowerCase().includes(q)) return false;
    return true;
  });
  const by = {new:(a,b)=>b.createdAt-a.createdAt, low:(a,b)=>a.price-b.price, high:(a,b)=>b.price-a.price, batt:(a,b)=>(b.battery??-1)-(a.battery??-1)}[f.sort];
  return xs.sort(by);
}
const battClass = b => b==null?"":(b>=85?"ok":b>=80?"warn":"bad");

/* ---------- views ---------- */
function cardHTML(l, preview){
  const st = l.status!=="active" ? `<span class="status ${l.status}">${l.status==="sold"?"Sold":"Reserved"}</span>` : "";
  const heart = (!preview && S.me) ? `<button class="heart" data-act="save" data-id="${esc(l.id)}" aria-pressed="${S.saved.has(l.id)}" aria-label="Save listing">${HEART}</button>` : "";
  const ph = preview && l._previewSrc ? `<img src="${esc(l._previewSrc)}" alt="">` : photoBox(l);
  return `<article class="card" ${preview?"":`data-go="item-${esc(l.id)}" tabindex="0" role="link"`} aria-label="${esc(l.title)}, ${money(l.price)}">
    <div class="ph" style="position:relative">${ph}${heart}</div>
    <span class="tag">${money(l.price)}</span>${st}
    <div class="body">
      <h3>${esc(l.title)}</h3>
      <div class="specline">
        ${l.storage?`<span class="pill">${esc(l.storage)}</span>`:""}
        <span class="pill">${esc(l.grade)}</span>
        ${l.battery!=null?`<span class="pill ${battClass(l.battery)}">${l.battery}% batt</span>`:""}
        ${l.lockOff?`<span class="pill ok">Lock off</span>`:`<span class="pill bad">Lock on</span>`}
      </div>
      <div class="foot"><span>${esc(l.area||"Local pickup")}</span><span>${ago(l.createdAt)}</span></div>
    </div></article>`;
}

function viewBrowse(){
  const f=S.f, xs=filtered();
  const chips = (set, items, key) => items.map(([k,n])=>`<button class="chip" data-act="chip" data-set="${key}" data-k="${k}" aria-pressed="${set.has(k)}">${n}</button>`).join("");
  let body;
  if(!S.loaded) body = `<div class="empty"><p class="muted">Loading listings…</p></div>`;
  else if(S.listings.length===0) body = `<div class="empty">${ICON.iphone}<h2>No devices listed yet</h2><p class="muted">Post the first one. It takes about a minute: photos, storage, condition, battery health and your price.</p><a class="btn primary" href="#sell">Sell a device</a></div>`;
  else if(xs.length===0) body = `<div class="empty"><h2>Nothing matches those filters</h2><p class="muted">Try a higher price limit or fewer categories.</p><button class="btn" data-act="reset">Clear filters</button></div>`;
  else body = `<div class="grid">${xs.map(l=>cardHTML(l)).join("")}</div>`;
  return `<div class="browse">
    <aside class="rail ${S.railOpen?"open":""}" aria-label="Filters">
      <fieldset><legend class="eyebrow">Device</legend><div class="chips">${chips(f.cats, CATS.map(c=>[c.k,c.n]), "cats")}</div></fieldset>
      <fieldset><legend class="eyebrow">Condition</legend><div class="chips">${chips(f.grade, Object.keys(GRADES).map(g=>[g,"Grade "+g]), "grade")}</div></fieldset>
      <div class="field"><label for="fmax">Max price</label><input id="fmax" type="number" min="0" step="10" inputmode="numeric" placeholder="Any" value="${esc(f.max)}"></div>
      <div class="field"><label for="farea">Pickup area</label><input id="farea" type="text" placeholder="Any area" value="${esc(f.area)}"></div>
      <label class="check"><input id="flock" type="checkbox" ${f.lockOnly?"checked":""}> Activation Lock off only</label>
      <label class="check"><input id="fsold" type="checkbox" ${f.hideSold?"checked":""}> Hide sold</label>
      ${S.me?`<label class="check"><input id="fsaved" type="checkbox" ${f.savedOnly?"checked":""}> Saved only</label>`:""}
      <button class="btn ghost" data-act="reset" style="align-self:flex-start">Clear filters</button>
    </aside>
    <section style="min-width:0">
      <div class="listhead">
        <div><div class="eyebrow">Used Apple devices · local pickup</div><h1>${xs.length} ${xs.length===1?"device":"devices"} for sale</h1></div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="btn mobile-filter" data-act="rail">Filters</button>
          <label class="muted" for="fsort" style="font-size:13.5px">Sort</label>
          <select id="fsort" class="btn" style="padding:8px 12px">
            <option value="new" ${f.sort==="new"?"selected":""}>Newest</option>
            <option value="low" ${f.sort==="low"?"selected":""}>Price: low to high</option>
            <option value="high" ${f.sort==="high"?"selected":""}>Price: high to low</option>
            <option value="batt" ${f.sort==="batt"?"selected":""}>Best battery</option>
          </select>
        </div>
      </div>${body}
    </section></div>`;
}

const findListing = id => S.listings.find(l=>l.id===id);

function sheetHTML(l){
  const g = GRADES[l.grade]||GRADES.B;
  return `<div class="sheet">
    <div class="hd"><span class="eyebrow">Inspection sheet</span><span class="mono muted">${esc(l.id.slice(1,9).toUpperCase())}</span></div>
    <dl>
      <dt>Device</dt><dd>${esc(catName(l.cat))}</dd>
      ${l.storage?`<dt>Storage</dt><dd>${esc(l.storage)}</dd>`:""}
      <dt>Condition</dt><dd>${esc(g.n)}<br><span class="muted" style="font-family:var(--body)">${esc(g.d)}</span></dd>
      ${l.battery!=null?`<dt>Battery health</dt><dd><span class="meter"><i style="width:${Math.max(0,Math.min(100,l.battery))}%;background:var(--${battClass(l.battery)||"ok"})"></i></span>${l.battery}%</dd>`:""}
      <dt>Activation Lock</dt><dd style="color:var(--${l.lockOff?"ok":"bad"})">${l.lockOff?"Off · ready to set up":"On · seller must remove"}</dd>
      <dt>Pickup</dt><dd>${esc(l.area||"Ask seller")}</dd>
      <dt>Payment</dt><dd>At pickup</dd>
    </dl></div>`;
}

// a conversation as the current user sees it; `fresh` = buyer hasn't written yet
function buyerThread(l){ return S.threads.find(t=>t.listingId===l.id && isMe(t.buyerId)) || {id:null, listingId:l.id, sellerId:l.sellerId, sellerName:l.sellerName, buyerId:S.me.id, fresh:true}; }

function chatHTML(t, l, opts={}){
  const seller = isMe(t.sellerId);
  const otherId = seller? t.buyerId : t.sellerId, otherName = seller? t.buyerName : t.sellerName;
  const ms = t.id && S.msgTid===t.id ? S.msgs : [];
  const items = ms.map(m => {
    const mine = isMe(m.from);
    if(m.kind==="sys") return `<div class="msg sys">${esc(m.text)}</div>`;
    if(m.kind==="offer"){
      const canAccept = seller && !mine && l && l.status==="active";
      return `<div class="msg offer" style="align-self:${mine?"flex-end":"flex-start"}"><div class="eyebrow">${mine?"Your offer":"Offer"}</div><b>${money(m.amount)}</b>${canAccept?`<div class="actions" style="margin-top:6px"><button class="btn primary" data-act="accept" data-amt="${Number(m.amount)}">Accept and reserve</button></div>`:""}<div class="t">${ago(m.at)}</div></div>`;
    }
    return `<div class="msg ${mine?"me":""}">${esc(m.text)}<div class="t">${ago(m.at)}</div></div>`;
  }).join("");
  const empty = !ms.length ? `<p class="muted" style="margin:auto;text-align:center;font-size:14px">${seller?"No messages yet.":"Ask about the device or make an offer. Agree on a public meetup spot before you go."}</p>` : "";
  const open = l && l.status!=="sold";
  return `<div class="chat">
    <div class="hd"><div class="seller">${avatar(otherId, otherName, 28)}<div><b>${esc(showName(otherId, otherName))}</b><div class="role">${seller?"Buyer":"Seller"}</div></div></div>${opts.link&&l?`<a class="btn ghost" href="#item-${esc(l.id)}">View listing</a>`:""}</div>
    <div class="msgs" id="msgs">${items}${empty}</div>
    ${open?`<form class="compose" data-form="msg"><input id="msgText" placeholder="Write a message" autocomplete="off" aria-label="Message" maxlength="1000"><button class="btn primary" type="submit" ${S.busy?"disabled":""}>Send</button></form>
    ${!seller && l.status==="active"?`<div class="quick">${["Is this still available?","Can I see it working before paying?","When could you meet?"].map(q=>`<button class="chip" data-act="quick" data-text="${esc(q)}">${esc(q)}</button>`).join("")}</div>
    <form class="offerrow" data-form="offer"><label for="offerAmt" class="muted" style="font-size:13.5px">Offer</label><input id="offerAmt" type="number" min="1" step="5" inputmode="numeric" value="${Math.round(l.price*0.9/5)*5}"><button class="btn" type="submit">Send offer</button></form>`:""}`
    : `<p class="muted" style="padding:10px 14px;margin:0;font-size:13.5px">${l?"This device has sold.":"This listing was removed."}</p>`}
  </div>`;
}

function viewItem(id){
  const l = findListing(id);
  if(!l) return `<a class="btn ghost back" href="#browse">← All devices</a><div class="empty"><h2>${S.loaded?"This listing was removed":"Loading…"}</h2></div>`;
  const photos = (l.photos||[]).map(photoSrc);
  const ix = Math.min(S.photoIx, Math.max(0,photos.length-1));
  const main = photos.length ? `<img src="${esc(photos[ix])}" alt="${esc(l.title)}">` : (ICON[l.cat]||ICON.other).replace('width="64" height="64"','width="140" height="140"');
  const mine = isMe(l.sellerId);
  let actions="", chat="";
  if(mine){
    const c = S.confirm==="delete" ? `<div class="confirm">Delete this listing for good? <button class="btn danger" data-act="del">Delete</button><button class="btn ghost" data-act="cancelConfirm">Keep it</button></div>` : "";
    actions = `<div class="actions">
      <a class="btn" href="#edit-${esc(l.id)}">Edit</a>
      ${l.status==="active"?`<button class="btn" data-act="status" data-s="reserved">Mark reserved</button>`:""}
      ${l.status!=="sold"?`<button class="btn primary" data-act="status" data-s="sold">Mark sold</button>`:""}
      ${l.status!=="active"?`<button class="btn" data-act="status" data-s="active">Relist</button>`:""}
      <button class="btn ghost danger" data-act="askDel">Delete</button></div>${c}`;
    const ts = S.threads.filter(t=>t.listingId===l.id && isMe(t.sellerId));
    if(ts.length){
      const cur = ts.find(t=>t.id===S.activeThread) || ts[0];
      S.activeThread = cur.id; wantMsgs(cur.id);
      chat = `<div class="eyebrow">Buyers asking (${ts.length})</div>
        ${ts.length>1?`<div class="chips">${ts.map(t=>`<button class="chip" data-act="pick" data-tid="${esc(t.id)}" aria-pressed="${t.id===cur.id}">${esc(t.buyerName||"Someone")}${t.unread?" •":""}</button>`).join("")}</div>`:""}
        ${chatHTML(cur,l)}`;
    } else chat = `<p class="muted">No buyers have messaged yet. Share the link to this listing to get it seen.</p>`;
  } else if(S.me){
    const t = buyerThread(l); S.activeThread=t.id; if(t.id) wantMsgs(t.id);
    if(l.status==="reserved" && l.reservedFor && !isMe(l.reservedFor)) actions = `<div class="notice warn">Reserved for another buyer. You can still message the seller in case it falls through.</div>`;
    if(l.status==="reserved" && isMe(l.reservedFor)) actions = `<div class="notice">Reserved for you at <b>${money(l.agreedPrice||l.price)}</b>. Pay the seller at pickup after you've checked the device and confirmed Activation Lock is off.</div>`;
    chat = chatHTML(t,l);
  } else {
    actions = `<div class="notice warn"><span>Sign in to message the seller or make an offer.</span><a class="btn primary" href="#signin" style="margin-left:auto">Sign in</a></div>`;
  }
  return `<a class="btn ghost back" href="#browse">← All devices</a>
  <div class="item">
    <div class="gallery">
      <div class="main">${main}${l.status!=="active"?`<span class="status ${l.status}">${l.status==="sold"?"Sold":"Reserved"}</span>`:""}</div>
      ${photos.length>1?`<div class="thumbs">${photos.map((p,i)=>`<button data-act="photo" data-i="${i}" aria-current="${i===ix}" aria-label="Photo ${i+1}"><img src="${esc(p)}" alt=""></button>`).join("")}</div>`:""}
      ${l.desc?`<div><div class="eyebrow" style="margin:8px 0 4px">From the seller</div><p class="desc" style="margin:0">${esc(l.desc)}</p></div>`:""}
    </div>
    <div class="side">
      <div><div class="eyebrow">${esc(catName(l.cat))}${l.storage?" · "+esc(l.storage):""}</div><h1>${esc(l.title)}</h1></div>
      <div><span class="tag big">${money(l.price)}</span></div>
      <div class="seller">${avatar(l.sellerId,l.sellerName,38)}<div><b>${esc(showName(l.sellerId,l.sellerName))}</b><div class="muted" style="font-size:13px">Listed ${ago(l.createdAt)}</div></div></div>
      ${actions}${sheetHTML(l)}${chat}
    </div>
  </div>`;
}

const blankDraft = () => ({title:"",cat:"iphone",storage:"",grade:"A",battery:"",lockOff:true,price:"",area:"",desc:"",photos:[]});

function viewSell(editId){
  if(!S.me) return goSignIn(), "";
  if(!S.draft || S.draft._for!==(editId||"new")){
    const l = editId && findListing(editId);
    if(editId && !l) return `<div class="empty"><h2>${S.loaded?"This listing was removed":"Loading…"}</h2></div>`;
    if(l && !isMe(l.sellerId)) return `<div class="empty"><h2>Only the seller can edit this listing</h2><a class="btn" href="#item-${esc(l.id)}">Back to listing</a></div>`;
    S.draft = l ? {...l, battery:l.battery??"", photos:[...(l.photos||[])], _for:editId} : {...blankDraft(), _for:"new"};
    S.draftErr="";
  }
  const d=S.draft;
  const preview = {...d, id:"preview", price:Number(d.price)||0, battery:d.battery===""?null:Number(d.battery), createdAt:Date.now(), status:"active", title:d.title||"Your device title"};
  return `<a class="btn ghost back" href="${editId?"#item-"+esc(editId):"#browse"}">← ${editId?"Back to listing":"All devices"}</a>
  <div class="sell">
    <form class="form" data-form="sell" novalidate>
      <div><div class="eyebrow">${editId?"Edit listing":"New listing"}</div><h1 style="font-size:28px">${editId?"Update your device":"Sell a used Apple device"}</h1></div>
      <fieldset style="border:0;padding:0;margin:0"><legend class="eyebrow" style="padding:0">Device type</legend>
        <div class="seg" style="margin-top:6px">${CATS.map(c=>`<label><input type="radio" name="cat" value="${c.k}" ${d.cat===c.k?"checked":""}>${c.n}</label>`).join("")}</div></fieldset>
      <div class="field"><label for="title">Model and colour</label><input id="title" name="title" maxlength="80" placeholder="iPhone 13, Midnight" value="${esc(d.title)}"></div>
      <div class="row2">
        <div class="field"><label for="storage">Storage</label><select id="storage" name="storage">${["","64 GB","128 GB","256 GB","512 GB","1 TB","2 TB"].map(s=>`<option value="${s}" ${d.storage===s?"selected":""}>${s||"Not applicable"}</option>`).join("")}</select></div>
        <div class="field"><label for="battery">Battery health %</label><input id="battery" name="battery" type="number" min="0" max="100" inputmode="numeric" placeholder="e.g. 89" value="${esc(d.battery)}"><span class="hint">Settings → Battery → Battery Health. Leave blank for AirPods.</span></div>
      </div>
      <fieldset style="border:0;padding:0;margin:0"><legend class="eyebrow" style="padding:0">Condition</legend>
        <div class="seg" style="margin-top:6px">${Object.entries(GRADES).map(([k,g])=>`<label title="${esc(g.d)}"><input type="radio" name="grade" value="${k}" ${d.grade===k?"checked":""}>${g.n}</label>`).join("")}</div>
        <span class="hint muted" style="font-size:12.5px">${esc((GRADES[d.grade]||GRADES.A).d)}</span></fieldset>
      <label class="check"><input type="checkbox" name="lockOff" id="lockOff" ${d.lockOff?"checked":""}> Activation Lock is off (signed out of Find My)</label>
      <div class="row2">
        <div class="field"><label for="price">Price (USD)</label><input id="price" name="price" type="number" min="1" step="5" inputmode="numeric" placeholder="450" value="${esc(d.price)}"></div>
        <div class="field"><label for="area">Pickup area</label><input id="area" name="area" maxlength="40" placeholder="Neighbourhood or landmark" value="${esc(d.area)}"></div>
      </div>
      <div class="field"><label for="desc">Details</label><textarea id="desc" name="desc" rows="4" maxlength="800" placeholder="What's included, any marks, repairs, AppleCare…">${esc(d.desc)}</textarea></div>
      <div class="drop">
        <b>Photos</b><span class="muted" style="font-size:13.5px">Up to 6. Show the screen on, the back, and any marks.</span>
        <div class="prevs">${d.photos.map((p,i)=>`<figure><img src="${esc(photoSrc(p))}" alt="Photo ${i+1}"><button type="button" data-act="rmPhoto" data-i="${i}" aria-label="Remove photo ${i+1}">×</button></figure>`).join("")}</div>
        ${d.photos.length<6?`<label class="btn" for="photoIn">${S.busy?"Uploading…":"Add photos"}</label><input id="photoIn" type="file" accept="image/*" multiple hidden>`:""}
      </div>
      ${S.draftErr?`<p class="err" role="alert">${esc(S.draftErr)}</p>`:""}
      <div class="actions"><button class="btn primary" type="submit" ${S.busy?"disabled":""}>${S.busy?"Saving…":editId?"Save changes":"Post listing"}</button><a class="btn ghost" href="${editId?"#item-"+esc(editId):"#browse"}">Cancel</a></div>
    </form>
    <aside class="preview-col"><div class="eyebrow">Preview</div><div id="previewCard" style="max-width:300px">${cardHTML(preview,true)}</div>
      <p class="muted" style="font-size:13.5px;max-width:34ch">Buyers pay at pickup. Meet somewhere public and let them check the device works before money changes hands.</p></aside>
  </div>`;
}

function viewInbox(){
  if(!S.me) return goSignIn(), "";
  if(!S.threads.length) return `<div class="listhead"><h1>Messages</h1></div><div class="empty"><h2>No conversations yet</h2><p class="muted">Message a seller from any listing, or post a device and buyers will reach you here.</p><a class="btn primary" href="#browse">Browse devices</a></div>`;
  const cur = S.threads.find(t=>t.id===S.activeThread) || S.threads[0];
  S.activeThread=cur.id; wantMsgs(cur.id);
  const l = findListing(cur.listingId);
  return `<div class="listhead"><h1>Messages</h1></div>
  <div class="inbox">
    <div class="threads">${S.threads.map(t=>{ const selling=isMe(t.sellerId); const oid=selling?t.buyerId:t.sellerId, on=selling?t.buyerName:t.sellerName;
      return `<button class="th" data-act="pick" data-tid="${esc(t.id)}" aria-current="${t.id===cur.id}">${avatar(oid,on,34)}<span class="tx"><div><b>${esc(on||"Someone")}</b> <span class="role">${selling?"buying":"selling"}</span></div><div class="muted" style="font-size:13px">${esc(t.listingTitle)} · ${esc(t.last)}</div></span>${t.unread&&t.id!==cur.id?'<span class="badge">•</span>':""}</button>`; }).join("")}</div>
    <div style="min-width:0">${chatHTML(cur,l,{link:true})}</div>
  </div>`;
}

function viewSignIn(){
  if(S.me){ location.hash = S.next || "browse"; return ""; }
  const up = S.authMode==="up";
  return `<div class="auth">
    <form class="form" data-form="auth" novalidate>
      <div><div class="eyebrow">${up?"Create an account":"Welcome back"}</div><h1 style="font-size:28px">${up?"Join Applesmart":"Sign in to Applesmart"}</h1></div>
      ${up?`<div class="field"><label for="aname">Your name</label><input id="aname" name="name" autocomplete="name" maxlength="40" placeholder="Shown to buyers and sellers"></div>`:""}
      <div class="field"><label for="aemail">Email</label><input id="aemail" name="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="apass">Password</label><input id="apass" name="password" type="password" autocomplete="${up?"new-password":"current-password"}" minlength="8" required>${up?'<span class="hint">At least 8 characters.</span>':""}</div>
      ${S.authErr?`<p class="err" role="alert">${esc(S.authErr)}</p>`:""}
      <button class="btn primary" type="submit" ${S.busy?"disabled":""} style="justify-content:center">${S.busy?"One moment…":up?"Create account":"Sign in"}</button>
      <p class="muted" style="margin:0;font-size:14px">${up?"Already have an account?":"New here?"} <button type="button" class="linkbtn" data-act="authMode">${up?"Sign in":"Create an account"}</button></p>
    </form></div>`;
}

/* ---------- render ---------- */
function render(soft){
  const app=$("#app");
  const ae=document.activeElement, fid=ae&&ae.id, sel=fid&&ae.selectionStart!=null?[ae.selectionStart,ae.selectionEnd]:null, val=fid&&ae.value;
  const msgsEl=$("#msgs"), atBottom = msgsEl ? (msgsEl.scrollHeight-msgsEl.scrollTop-msgsEl.clientHeight<40) : true;
  let html;
  if(S.route==="item") html=viewItem(S.param);
  else if(S.route==="sell") html=viewSell(null);
  else if(S.route==="edit") html=viewSell(S.param);
  else if(S.route==="inbox") html=viewInbox();
  else if(S.route==="signin") html=viewSignIn();
  else html=viewBrowse();
  app.innerHTML=html;
  if(fid){ const el=document.getElementById(fid); if(el && el!==document.activeElement){ if((el.id==="msgText"||el.id==="aemail"||el.id==="apass"||el.id==="aname") && val!=null) el.value=val; el.focus({preventScroll:true}); if(sel) try{el.setSelectionRange(sel[0],sel[1]);}catch(e){} } }
  const m=$("#msgs"); if(m && (atBottom||!soft)) m.scrollTop=m.scrollHeight;
  paintHeader();
}
function paintHeader(){
  const n=S.threads.filter(t=>t.unread).length;
  $("#unread").innerHTML = n?`<span class="badge">${n}</span>`:"";
  $("#who").innerHTML = S.me
    ? `<span title="Signed in as ${esc(S.me.name)}">${avatar(S.me.id,S.me.name,30)}</span><button class="btn ghost" data-act="logout">Sign out</button>`
    : `<a class="btn" href="#signin">Sign in</a>`;
}
function goSignIn(){ S.next = location.hash.slice(1); if(location.hash!=="#signin") location.hash="signin"; }

/* ---------- routing ---------- */
function route(){
  const h=(location.hash||"").slice(1);
  const prev=S.route+S.param;
  if(h.startsWith("item-")){ S.route="item"; S.param=h.slice(5); }
  else if(h.startsWith("edit-")){ S.route="edit"; S.param=h.slice(5); }
  else if(["sell","inbox","signin"].includes(h)){ S.route=h; S.param=""; }
  else { S.route="browse"; S.param=""; }
  if(prev!==S.route+S.param){ S.photoIx=0; S.confirm=null; S.authErr=""; if(S.route!=="inbox") S.activeThread=null; if(S.route!=="sell"&&S.route!=="edit") S.draft=null; window.scrollTo(0,0); }
  render();
}
addEventListener("hashchange", route);

/* ---------- data loading & polling ---------- */
async function loadListings(){ try{ S.listings = await api("GET","/api/listings"); S.loaded=true; render(true); }catch(e){ S.loaded=true; render(true); } }
async function loadThreads(){ if(!S.me) return; try{ const ts=await api("GET","/api/threads"); if(JSON.stringify(ts)!==JSON.stringify(S.threads)){ S.threads=ts; render(true); } }catch(e){ if(e.status===401){ S.me=null; render(); } } }
async function loadSaved(){ if(!S.me) return; try{ S.saved=new Set(await api("GET","/api/saved")); render(true); }catch(e){} }
async function loadMsgs(){
  const tid=S.msgTid; if(!tid||!S.me) return;
  try{ const ms=await api("GET",`/api/threads/${encodeURIComponent(tid)}/messages`);
    if(tid===S.msgTid && JSON.stringify(ms)!==JSON.stringify(S.msgs)){ S.msgs=ms; render(true); } }catch(e){}
}
function wantMsgs(tid){
  if(S.msgTid===tid) return;
  S.msgTid=tid; S.msgs=[]; setTimeout(loadMsgs,0);
}
function every(ms, fn){ setInterval(()=>{ if(!document.hidden) fn(); }, ms); }
every(20000, loadListings);
every(8000, loadThreads);
every(4000, ()=>{ if(S.route==="item"||S.route==="inbox") loadMsgs(); });
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden){ loadListings(); loadThreads(); loadMsgs(); } });

/* ---------- writes ---------- */
async function sendMsg(l, t, body){
  if(!S.me) return goSignIn();
  try{
    if(t.id) await api("POST",`/api/threads/${encodeURIComponent(t.id)}/messages`, body);
    else { const r=await api("POST",`/api/listings/${encodeURIComponent(l.id)}/messages`, body); S.activeThread=r.threadId; await loadThreads(); wantMsgs(r.threadId); }
    await loadMsgs(); await loadThreads(); render(true);
  }catch(e){ fail(e); }
}
async function addPhotos(files){
  const d=S.draft; const list=[...files].slice(0, 6-d.photos.length);
  S.busy=true; render();
  for(const f of list){
    try{ const data=await downscale(f,1400,.82); const r=await api("POST","/api/photos",{data}); d.photos.push(r.id); }
    catch(e){ S.draftErr=e.message; }
  }
  S.busy=false; render();
}
async function saveListing(){
  const d=S.draft;
  const body={title:d.title,cat:d.cat,storage:d.storage,grade:d.grade,battery:d.battery===""?null:Number(d.battery),lockOff:!!d.lockOff,price:Number(d.price),area:d.area,desc:d.desc,photos:d.photos};
  if(!body.title.trim()){ S.draftErr="Add the model, for example “iPhone 13, Midnight”."; return render(); }
  if(!(body.price>0)){ S.draftErr="Set a price above $0."; return render(); }
  S.busy=true; S.draftErr=""; render();
  try{
    let id=d._for;
    if(id==="new"){ id=(await api("POST","/api/listings",body)).id; } else await api("PUT",`/api/listings/${encodeURIComponent(id)}`,body);
    S.busy=false; S.draft=null; await loadListings(); toast(d._for==="new"?"Listing posted":"Listing updated"); location.hash="item-"+id;
  }catch(e){ S.busy=false; S.draftErr=e.message; if(e.status===401) goSignIn(); render(); }
}

/* ---------- events ---------- */
document.addEventListener("click", async e => {
  const t=e.target.closest("[data-act],[data-go]"); if(!t) return;
  if(t.dataset.go && !e.target.closest("[data-act]")){ location.hash=t.dataset.go; return; }
  const a=t.dataset.act, f=S.f;
  if(a==="chip"){ const set=f[t.dataset.set]; set.has(t.dataset.k)?set.delete(t.dataset.k):set.add(t.dataset.k); render(); }
  else if(a==="reset"){ Object.assign(f,{q:"",cats:new Set(),grade:new Set(),max:"",area:"",lockOnly:false,hideSold:true,savedOnly:false}); $("#q").value=""; render(); }
  else if(a==="rail"){ S.railOpen=!S.railOpen; render(); }
  else if(a==="photo"){ S.photoIx=Number(t.dataset.i); render(); }
  else if(a==="pick"){ S.activeThread=t.dataset.tid; render(); }
  else if(a==="authMode"){ S.authMode=S.authMode==="up"?"in":"up"; S.authErr=""; render(); }
  else if(a==="logout"){ try{ await api("POST","/api/auth/logout"); }catch(err){} S.me=null; S.threads=[]; S.saved=new Set(); S.msgTid=null; toast("Signed out"); render(); }
  else if(a==="save"){ e.stopPropagation(); const id=t.dataset.id; const on=!S.saved.has(id); on?S.saved.add(id):S.saved.delete(id); render(true);
    try{ await api(on?"PUT":"DELETE",`/api/saved/${encodeURIComponent(id)}`); }catch(err){ fail(err); } }
  else if(a==="rmPhoto"){ S.draft.photos.splice(Number(t.dataset.i),1); S.draftErr=""; render(); }
  else if(a==="askDel"){ S.confirm="delete"; render(); }
  else if(a==="cancelConfirm"){ S.confirm=null; render(); }
  else if(a==="del"){ try{ await api("DELETE",`/api/listings/${encodeURIComponent(S.param)}`); toast("Listing deleted"); await loadListings(); location.hash="browse"; }catch(err){ fail(err); } }
  else if(a==="status"){ try{ await api("PATCH",`/api/listings/${encodeURIComponent(S.param)}/status`,{status:t.dataset.s}); await loadListings();
      toast(t.dataset.s==="sold"?"Marked sold":t.dataset.s==="reserved"?"Marked reserved":"Relisted"); }catch(err){ fail(err); } }
  else if(a==="quick"){ const l=findListing(S.param); if(l) sendMsg(l,buyerThread(l),{kind:"text",text:t.dataset.text}); }
  else if(a==="accept"){
    if(!S.activeThread) return;
    try{ await api("POST",`/api/threads/${encodeURIComponent(S.activeThread)}/accept`,{amount:Number(t.dataset.amt)}); await loadListings(); await loadMsgs(); toast("Reserved for this buyer"); }catch(err){ fail(err); }
  }
});
document.addEventListener("keydown", e => { if(e.key==="Enter" && e.target.matches(".card[data-go]")) location.hash=e.target.dataset.go; });
document.addEventListener("submit", async e => {
  const form=e.target.closest("[data-form]"); if(!form) return; e.preventDefault();
  const kind=form.dataset.form;
  if(kind==="sell") return saveListing();
  if(kind==="auth"){
    const up=S.authMode==="up";
    const body={email:$("#aemail").value, password:$("#apass").value}; if(up) body.name=$("#aname").value;
    S.busy=true; S.authErr=""; render();
    try{ S.me=await api("POST", up?"/api/auth/register":"/api/auth/login", body); S.busy=false; toast(up?"Account created":"Signed in");
      loadThreads(); loadSaved(); location.hash = S.next && S.next!=="signin" ? S.next : "browse"; render(); }
    catch(err){ S.busy=false; S.authErr=err.message; render(); }
    return;
  }
  const l = S.route==="item" ? findListing(S.param) : findListing((S.threads.find(x=>x.id===S.activeThread)||{}).listingId);
  if(!l) return;
  const th = S.threads.find(x=>x.id===S.activeThread) || buyerThread(l);
  if(kind==="msg"){ const inp=$("#msgText"); const v=inp.value.trim(); if(!v) return; inp.value=""; sendMsg(l,th,{kind:"text",text:v}); }
  if(kind==="offer"){ const v=Number($("#offerAmt").value); if(!(v>0)) return toast("Enter an offer above $0"); sendMsg(l,th,{kind:"offer",amount:Math.round(v)}); }
});
let qT;
document.addEventListener("input", e => {
  const el=e.target, f=S.f;
  if(el.id==="q"){ clearTimeout(qT); qT=setTimeout(()=>{ f.q=el.value; if(S.route!=="browse") location.hash="browse"; else render(); },150); return; }
  if(el.id==="fmax"){ f.max=el.value; render(); }
  if(el.id==="farea"){ f.area=el.value; render(); }
  if(S.draft && el.closest('[data-form="sell"]') && el.name && el.type!=="radio" && el.type!=="checkbox" && el.tagName!=="SELECT"){ S.draft[el.name]=el.value; refreshPreview(); }
});
document.addEventListener("change", e => {
  const el=e.target, f=S.f;
  if(el.id==="fsort"){ f.sort=el.value; render(); }
  if(el.id==="flock"){ f.lockOnly=el.checked; render(); }
  if(el.id==="fsold"){ f.hideSold=el.checked; render(); }
  if(el.id==="fsaved"){ f.savedOnly=el.checked; render(); }
  if(el.id==="photoIn" && el.files.length){ S.draftErr=""; addPhotos(el.files); return; }
  if(S.draft && el.closest('[data-form="sell"]') && (el.type==="radio"||el.tagName==="SELECT"||el.type==="checkbox")){
    if(el.name==="lockOff") S.draft.lockOff=el.checked; else if(el.name) S.draft[el.name]=el.value; render(); }
});
function refreshPreview(){
  const col=$("#previewCard"); if(!col) return; const d=S.draft;
  col.innerHTML=cardHTML({...d,id:"preview",price:Number(d.price)||0,battery:d.battery===""?null:Number(d.battery),createdAt:Date.now(),status:"active",title:d.title||"Your device title"},true);
}

/* ---------- boot ---------- */
(async () => {
  try{ S.me = await api("GET","/api/me"); }catch(e){}
  route();
  await loadListings();
  if(S.me){ loadThreads(); loadSaved(); }
})();
})();
