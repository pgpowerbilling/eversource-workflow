/* ---------- Pre Flight: before-work photo, planned units and Dig Safe per location ---------- */
/* pole.pf = {photo, units:{key:qty}, notes, by, at}; pole.digsafe = {ticket, clear, expires, by, at}; pole.digsafeLog = [older tickets] */
const DS_WARN=3;  /* days before expiry that "Renew Dig Safe" shows */
const canPf=j=>!!j&&!j.archived&&canShutdown(j);
const pfHas=p=>!!(p.pf&&(p.pf.photo||Object.keys(p.pf.units||{}).length));
function dsDaysTo(d){if(!d)return null;const a=new Date(todayStr()+"T00:00:00"),b=new Date(d+"T00:00:00");return Math.round((b-a)/86400000);}
/* Dig Safe status for a location. A finished location needs no renewal. */
function dsStatus(j,p){const d=p.digsafe;const done=workSt(j,p).k==="done";
  if(!d||!(d.ticket||d.clear||d.expires))return done?{k:"done",lab:"Location complete",chip:"c-done",sub:"",rank:9}:{k:"none",lab:"No Dig Safe",chip:"c-stage",sub:"",rank:5};
  if(done)return{k:"done",lab:"Location complete",chip:"c-done",sub:d.ticket?"Ticket "+d.ticket:"",rank:9};
  const today=todayStr();
  if(d.expires&&d.expires<today)return{k:"expired",lab:"Expired",chip:"c-bad",sub:"Expired "+fmtD(d.expires)+" — renew before digging",rank:0};
  const n=dsDaysTo(d.expires);
  if(d.expires&&n<=DS_WARN)return{k:"renew",lab:"Renew Dig Safe",chip:"c-req",sub:(n===0?"Expires today":"Expires "+fmtD(d.expires)+" ("+n+" day"+(n===1?"":"s")+")"),rank:1};
  if(d.clear&&d.clear>today)return{k:"wait",lab:"Waiting to clear",chip:"c-sch",sub:"Clears "+fmtD(d.clear)+(d.expires?" · expires "+fmtD(d.expires):""),rank:2};
  return{k:"clear",lab:"Clear to dig",chip:"c-done",sub:d.expires?"Expires "+fmtD(d.expires):"No expiration date",rank:3};}
const dsChip=(j,p)=>{const s=dsStatus(j,p);return'<span class="chip '+s.chip+'">'+esc(s.lab)+"</span>"+(s.sub?'<div class="sub">'+esc(s.sub)+"</div>":"");};
/* planned units priced at the location's pricing area */
function pfEstimate(j,p){const u=p.pf&&p.pf.units||{};const ks=Object.keys(u).filter(k=>Number(u[k])>0);if(!ks.length)return{total:0,missing:[]};
  const ar=poleArea(j,p);let t=0;const miss=[];ks.forEach(k=>{const r=(unitInfo(k).rates||{})[ar];if(typeof r!=="number")miss.push(unitInfo(k).item||k);else t+=r*Number(u[k]);});return{total:cents(t),missing:miss};}
/* planned vs what the unit sheets actually carry */
function pfDiff(p,sh){const plan=p.pf&&p.pf.units||{};if(!Object.keys(plan).length||!sh.length)return null;const act={};sh.forEach(s=>(s.lines||[]).forEach(l=>{act[l.key]=(act[l.key]||0)+Number(l.qty||0);}));
  const keys=[...new Set(Object.keys(plan).concat(Object.keys(act)))];const out=[];keys.forEach(k=>{const a=act[k]||0,b=Number(plan[k]||0);if(Math.abs(a-b)>1e-9)out.push({key:k,plan:b,act:a});});return out;}
const pfUnitName=k=>{const u=unitInfo(k);return(u.workType?u.workType+" — ":"")+(u.item||k);};
function pfDiffHtml(d){return d.map(x=>"<li>"+esc(pfUnitName(x.key))+": planned <b>"+fmtN(x.plan)+"</b>, unit sheets <b>"+fmtN(x.act)+"</b></li>").join("");}
/* location cell in the job's Locations table: sheet count, or the pre-flight photo when no sheet is in yet */
function pfSheetCell(j,p,sh){let h='<span class="mono">'+sh.length+"</span>";
  if(!sh.length&&p.pf&&p.pf.photo)h='<img class="pf-thumb" data-photo="'+esc(JSON.stringify(p.pf.photo))+'" alt="Pre-flight photo" title="Pre-flight photo — '+esc(p.pf.by)+'">';
  else if(!sh.length&&pfHas(p))h='<span class="chip c-sch" title="Pre-flight done">Pre-flight</span>';
  const df=pfDiff(p,sh);if(df&&df.length)h+=' <span class="chip c-req" title="'+esc(df.map(x=>pfUnitName(x.key)+": planned "+fmtN(x.plan)+", sheets "+fmtN(x.act)).join("\n"))+'">≠ plan</span>';
  return h;}

/* ---------- Pre Flight page for one job ---------- */
function renderPreflight(){
  const j=jobById(S.docId);if(!j){main.innerHTML='<a class="back" href="#overview">← Overview</a><div class="empty"><b>Job not found</b></div>';return;}
  const ed=canPf(j);const sx=sheets();const f=S.pff||(S.pff={q:"",st:""});
  const all=(j.poles||[]).map(p=>{const sh=sx.filter(s=>s.jobId===j.id&&s.poleId===p.id);return{p,sh,ds:dsStatus(j,p),est:pfEstimate(j,p),df:pfDiff(p,sh),done:workSt(j,p,sh).k==="done"};});
  const n=k=>all.filter(r=>r.ds.k===k).length;const pfN=all.filter(r=>pfHas(r.p)).length;
  const estT=all.reduce((a,r)=>a+r.est.total,0),estMiss=all.some(r=>r.est.missing.length);
  main.innerHTML='<a class="back" href="#job-'+esc(j.id)+'">← '+esc(j.name)+"</a>"+
    '<section class="jobhead"><div><h1>Pre Flight — '+esc(j.name)+'</h1><div class="meta"><span>Before-work photo, planned units and Dig Safe for each location</span>'+(ed?"":'<span class="chip c-stage">View only</span>')+"</div></div></section>"+
    '<section class="tiles">'+tile("Pre-flight done",pfN+" / "+all.length,"Photo or planned units",false)+tile("Clear to dig",n("clear"),"Dig Safe cleared",false)+tile("Waiting to clear",n("wait"),"Dig Safe not clear yet",false)+
      tile("Renew Dig Safe",n("renew"),"Expires within "+DS_WARN+" days",n("renew")>0)+tile("Expired",n("expired"),"Renew before digging",n("expired")>0)+tile("No Dig Safe",n("none"),"Not entered yet",false)+
      (can.seePrice()?tile("Planned value",money(estT),estMiss?"Some units have no rate":"Planned units at job rates",false):"")+"</section>"+
    '<div class="filters" style="margin-bottom:10px"><input type="search" id="pf-q" placeholder="Search street, pole #, ticket, Dig Safe #…" aria-label="Search locations" value="'+esc(f.q)+'"><select id="pf-st" aria-label="Filter"><option value="">All locations</option>'+
      [["todo","Pre-flight not done"],["pfdone","Pre-flight done"],["expired","Dig Safe expired"],["renew","Renew Dig Safe"],["wait","Waiting to clear"],["clear","Clear to dig"],["none","No Dig Safe"],["diff","Unit sheets ≠ plan"]].map(o=>'<option value="'+o[0]+'"'+(f.st===o[0]?" selected":"")+">"+o[1]+"</option>").join("")+'</select><span class="sub" id="pf-c"></span></div>'+
    '<div class="tablebox"><table><thead><tr><th class="nosort">#</th><th class="nosort">Ticket ID</th><th class="nosort">Pole # / location</th><th class="nosort">Pre-flight photo</th><th class="nosort">Planned units</th>'+(can.seePrice()?'<th class="nosort num">Planned $</th>':"")+'<th class="nosort">Dig Safe</th><th class="nosort">Dig Safe #</th><th class="nosort">Work status</th><th class="nosort">Plan vs sheets</th></tr></thead><tbody id="pf-b"></tbody></table></div>';
  const qi=document.getElementById("pf-q"),si=document.getElementById("pf-st");qi.oninput=()=>{f.q=qi.value;fill();};si.onchange=()=>{f.st=si.value;fill();};
  function fill(){const q=f.q.trim().toLowerCase();
    const L=all.filter(r=>(!q||[r.p.street,r.p.esPole,r.p.ticket,r.p.town,r.p.digsafe&&r.p.digsafe.ticket].join(" ").toLowerCase().indexOf(q)>=0)&&
      (!f.st||(f.st==="todo"?!pfHas(r.p)&&!r.done:f.st==="pfdone"?pfHas(r.p):f.st==="diff"?!!(r.df&&r.df.length):r.ds.k===f.st)));
    document.getElementById("pf-c").textContent=L.length+" of "+all.length+" locations";
    const tb=document.getElementById("pf-b");
    tb.innerHTML=L.map(r=>{const p=r.p;const u=p.pf&&p.pf.units||{};const nu=Object.keys(u).filter(k=>Number(u[k])>0);const w=workSt(j,p,r.sh);
      return'<tr tabindex="0" data-id="'+esc(p.id)+'"><td class="mono">'+esc(p.n)+'</td><td class="mono">'+esc(p.ticket)+"</td><td><b>"+esc(p.esPole||"")+"</b> "+esc(p.street||"")+(p.town?'<div class="sub">'+esc(p.town)+"</div>":"")+"</td>"+
        "<td>"+(p.pf&&p.pf.photo?'<img class="pf-thumb" data-photo="'+esc(JSON.stringify(p.pf.photo))+'" alt="Pre-flight photo">':'<span class="sub">—</span>')+"</td>"+
        '<td class="wrapc">'+(nu.length?nu.map(k=>esc(unitInfo(k).item||k)+" × "+fmtN(u[k])).join("<br>"):'<span class="sub">—</span>')+"</td>"+
        (can.seePrice()?'<td class="mono num">'+(nu.length?money(r.est.total)+(r.est.missing.length?'<div class="sub" title="'+esc(r.est.missing.join(", "))+'">'+r.est.missing.length+" without rate</div>":""):"")+"</td>":"")+
        "<td>"+dsChip(j,p)+'</td><td class="mono">'+esc(p.digsafe&&p.digsafe.ticket||"")+"</td>"+
        '<td><span class="chip '+w.chip+'">'+esc(w.lab)+"</span></td><td>"+(r.df==null?'<span class="sub">—</span>':r.df.length?'<span class="chip c-req" title="'+esc(r.df.map(x=>pfUnitName(x.key)+": planned "+fmtN(x.plan)+", sheets "+fmtN(x.act)).join("\n"))+'">'+r.df.length+" difference"+(r.df.length===1?"":"s")+"</span>":'<span class="chip c-done">Matches</span>')+"</td></tr>";}).join("")||
      '<tr><td colspan="10"><div class="empty"><b>No locations match</b></div></td></tr>';
    fillPhotoImgs(tb);bindRows(tb,pid=>openPfLocation(j.id,pid));}
  fill();}

/* ---------- one location: photo, planned units, Dig Safe ---------- */
function openPfLocation(jid,pid){const j=jobById(jid);const p=poleById(j,pid);if(!p)return;const ed=canPf(j);
  const pf=p.pf||{};const ds=p.digsafe||{};const units=Object.assign({},pf.units||{});
  const slot={meta:pf.photo||null,blob:null,url:null};
  const crewKeys=new Set(CREW_SECTIONS.flatMap(s=>s[1].map(i=>i[0])));
  const others=Object.keys(units).filter(k=>!crewKeys.has(k)).map(k=>({key:k,qty:units[k]}));
  const otherUnits=(rates()?rates().units:[]).filter(u=>!crewKeys.has(u.key)&&!RETIRED.has(u.key));
  const dis=ed?"":" disabled";
  const m=modal("Pre Flight — #"+esc(p.n)+" "+esc([p.esPole,p.street].filter(Boolean).join(" · ")),
    '<p class="sub" style="margin:0 0 8px">'+esc([p.ticket?"Ticket "+p.ticket:"",p.town].filter(Boolean).join(" · "))+". The photo becomes the unit sheet's Before photo and the planned units prefill the unit sheet when the crew does this location.</p>"+
    '<h3 class="pv-h3">Before-work photo</h3><div class="ph-slot" style="max-width:420px"><div class="ph-frame"><img alt="Pre-flight photo" hidden id="pfl-img"><span class="ph-empty" id="pfl-em">No photo yet</span></div>'+
      (ed?'<div class="row-inline"><label class="btn sm primary" style="cursor:pointer">Take photo<input type="file" accept="image/*" capture="environment" class="pfl-in" hidden></label><label class="btn sm" style="cursor:pointer">From photos<input type="file" accept="image/*" class="pfl-in" hidden></label><span class="sub" id="pfl-st"></span></div>':"")+"</div>"+
    '<h3 class="pv-h3">Planned units at this location</h3><div class="pf-grid">'+CREW_SECTIONS.map(s=>'<div class="cl-sec"><div class="cl-h"><span>'+esc(s[0])+"</span><span>Qty</span></div>"+s[1].map(it=>'<label class="cl-row"><span>'+esc(it[1])+'</span><input type="number" min="0" step="any" inputmode="decimal" data-pq="'+esc(it[0])+'" value="'+esc(units[it[0]]==null?"":units[it[0]])+'"'+dis+"></label>").join("")+"</div>").join("")+"</div>"+
    '<div id="pfl-oth"></div>'+(ed?'<button class="btn sm" type="button" id="pfl-addo">+ Other unit</button>':"")+
    '<h3 class="pv-h3">Dig Safe</h3><div class="row-inline" style="gap:8px;flex-wrap:wrap;align-items:flex-end">'+
      '<label class="f" style="flex:1 1 160px">Dig Safe ticket #<input id="pfl-dt" value="'+esc(ds.ticket||"")+'"'+dis+'></label>'+
      '<label class="f" style="flex:1 1 140px">Clears on<input type="date" id="pfl-dc" value="'+esc(ds.clear||"")+'"'+dis+'></label>'+
      '<label class="f" style="flex:1 1 140px">Expires on<input type="date" id="pfl-de" value="'+esc(ds.expires||"")+'"'+dis+"></label></div>"+
    '<p style="margin:4px 0 0">Now: '+dsChip(j,p)+"</p>"+
    (ed&&(ds.ticket||ds.expires)?'<label class="chk" style="margin:6px 0"><input type="checkbox" id="pfl-renew"> <b>This is a renewal</b> <span class="sub">Keeps the current ticket and dates in the history and saves the new ones.</span></label>':"")+
    ((p.digsafeLog||[]).length?'<details style="margin-top:6px"><summary class="sub">Earlier Dig Safe tickets ('+p.digsafeLog.length+")</summary><ul>"+p.digsafeLog.slice().reverse().map(o=>"<li>"+esc(o.ticket||"no #")+" · clears "+esc(fmtD(o.clear)||"—")+" · expires "+esc(fmtD(o.expires)||"—")+' <span class="sub">('+esc(o.by||"")+")</span></li>").join("")+"</ul></details>":"")+
    '<label class="f wide" style="margin-top:8px">Pre-flight notes<textarea id="pfl-n"'+dis+">"+esc(pf.notes||"")+"</textarea></label>"+
    (pf.by?'<p class="sub" style="margin:4px 0 0">Pre-flight by '+esc(pf.by)+" · "+esc(fmtT(pf.at))+"</p>":""),
    '<button class="btn" type="button" data-x>'+(ed?"Cancel":"Close")+"</button>"+(ed?'<button class="btn primary" type="button" id="pfl-go">Save</button>':""),"wide");
  const img=m.querySelector("#pfl-img"),em=m.querySelector("#pfl-em");
  const show=()=>{if(slot.url){img.src=slot.url;img.hidden=false;em.hidden=true;}else if(slot.meta){em.textContent="Loading…";photoUrl(slot.meta).then(u=>{if(u&&!slot.url){img.src=u;img.hidden=false;em.hidden=true;}}).catch(()=>{em.textContent="Photo couldn't load";});}};show();
  m.querySelectorAll(".pfl-in").forEach(inp=>inp.onchange=async ev=>{const fl=ev.target.files[0];ev.target.value="";if(!fl)return;const st=m.querySelector("#pfl-st");st.textContent="Processing…";
    try{const ph=await shrinkPhoto(fl);slot.blob=ph;slot.url=URL.createObjectURL(ph.blob);st.textContent="Ready ("+Math.round(ph.blob.size/1024)+" KB)";show();}catch(e){st.textContent="";toast(errText(e),7000);}});
  const obox=m.querySelector("#pfl-oth");
  const drawO=()=>{obox.innerHTML=others.map((o,i)=>'<div class="row-inline" style="gap:6px;margin:4px 0" data-i="'+i+'"><select data-ok'+dis+'><option value="">Select unit…</option>'+otherUnits.map(u=>'<option value="'+esc(u.key)+'"'+(u.key===o.key?" selected":"")+">"+esc(u.workType+" — "+u.item)+"</option>").join("")+(o.key&&!otherUnits.some(u=>u.key===o.key)?'<option value="'+esc(o.key)+'" selected>'+esc(pfUnitName(o.key))+"</option>":"")+'</select><input type="number" min="0" step="any" inputmode="decimal" style="width:90px" data-oq value="'+esc(o.qty)+'"'+dis+">"+(ed?'<button class="btn sm" type="button" data-orm aria-label="Remove">✕</button>':"")+"</div>").join("");
    obox.querySelectorAll("[data-i]").forEach(r=>{const o=others[+r.dataset.i];r.querySelector("[data-ok]").onchange=e=>{o.key=e.target.value;};r.querySelector("[data-oq]").oninput=e=>{o.qty=e.target.value;};const x=r.querySelector("[data-orm]");if(x)x.onclick=()=>{others.splice(+r.dataset.i,1);drawO();};});};drawO();
  const ao=m.querySelector("#pfl-addo");if(ao)ao.onclick=()=>{others.push({key:"",qty:""});drawO();};
  const go=m.querySelector("#pfl-go");if(!go)return;
  go.onclick=e=>busyRun(e.target,m,async()=>{const u={};
    m.querySelectorAll("[data-pq]").forEach(i=>{const v=i.value.trim();if(v==="")return;const q=Number(v);if(!isFinite(q)||q<0)throw new Error("Quantities must be numbers of 0 or more.");if(q>0)u[i.dataset.pq]=q;});
    for(const o of others){if(!o.key&&String(o.qty).trim()==="")continue;if(!o.key)throw new Error("Pick the unit for each other-unit line.");const q=Number(o.qty);if(!isFinite(q)||q<=0)throw new Error(pfUnitName(o.key)+": enter a quantity greater than 0.");if(u[o.key])throw new Error(pfUnitName(o.key)+" is entered twice.");u[o.key]=q;}
    const dt=m.querySelector("#pfl-dt").value.trim(),dc=m.querySelector("#pfl-dc").value,de=m.querySelector("#pfl-de").value;
    if(dc&&de&&de<dc)throw new Error("The Dig Safe expiration can't be before it clears.");
    if((dt||dc)&&!de)throw new Error("Enter the Dig Safe expiration date.");
    const rn=m.querySelector("#pfl-renew");const renew=!!(rn&&rn.checked);
    if(renew&&dt===(ds.ticket||"")&&dc===(ds.clear||"")&&de===(ds.expires||""))throw new Error("Enter the new ticket and dates for the renewal.");
    if(!canSave())return;
    let photo=slot.meta;if(slot.blob){e.target.textContent="Uploading photo…";photo=await storePhoto(slot.blob,"before");}
    const at=new Date().toISOString(),notes=m.querySelector("#pfl-n").value.trim();
    await commitIndex(ix=>{const pp=((ix.jobs.find(x=>x.id===jid)||{}).poles||[]).find(x=>x.id===pid);if(!pp)throw new Error("This location was removed.");
      pp.pf={photo:photo||null,units:u,notes,by:S.me.name,byKey:S.myKey,at};
      const old=pp.digsafe||{};const changed=dt!==(old.ticket||"")||dc!==(old.clear||"")||de!==(old.expires||"");
      if(changed){if(old.ticket||old.expires){(pp.digsafeLog=pp.digsafeLog||[]).push(Object.assign({replacedAt:at,replacedBy:S.me.name,renewal:renew},old));}
        if(dt||dc||de)pp.digsafe={ticket:dt,clear:dc,expires:de,by:S.me.name,at};else delete pp.digsafe;}},"Workflow: pre-flight · "+(p.street||p.esPole||""));
    closeOverlay();refresh();toast("Pre-flight saved");});}

/* ---------- Dig Safe tab: every location with a Dig Safe ticket, all jobs ---------- */
function renderDigSafe(){const f=S.dsf||(S.dsf={q:"",job:"",st:"open"});
  const all=[];jobs().filter(j=>!j.archived&&!j.test).forEach(j=>(j.poles||[]).forEach(p=>{const s=dsStatus(j,p);if(p.digsafe||s.k==="none")all.push({j,p,s});}));
  const withDs=all.filter(x=>x.p.digsafe);const c=k=>withDs.filter(x=>x.s.k===k).length;
  main.innerHTML='<section class="jobhead"><div><h1>Dig Safe</h1><div class="meta"><span>Dig Safe tickets on every job. Renewals show '+DS_WARN+" days before they expire; finished locations drop off.</span></div></div></section>"+
    '<section class="tiles">'+tile("Expired",c("expired"),"Renew before digging",c("expired")>0)+tile("Renew now",c("renew"),"Expires within "+DS_WARN+" days",c("renew")>0)+tile("Waiting to clear",c("wait"),"Not clear yet",false)+tile("Clear to dig",c("clear"),"Cleared, not expired",false)+tile("No Dig Safe",all.filter(x=>x.s.k==="none").length,"Open locations without one",false)+"</section>"+
    '<div class="filters"><input type="search" id="ds-q" placeholder="Search ticket #, pole #, street…" aria-label="Search Dig Safe" value="'+esc(f.q)+'"><select id="ds-job" aria-label="Job"><option value="">All jobs</option>'+[...new Map(all.map(x=>[x.j.id,x.j])).values()].map(j=>'<option value="'+esc(j.id)+'"'+(j.id===f.job?" selected":"")+">"+esc(j.name)+"</option>").join("")+"</select>"+
      '<select id="ds-st" aria-label="Status">'+[["open","Needs attention or active"],["expired","Expired"],["renew","Renew now"],["wait","Waiting to clear"],["clear","Clear to dig"],["none","No Dig Safe"],["done","Location complete"],["","Everything"]].map(o=>'<option value="'+o[0]+'"'+(f.st===o[0]?" selected":"")+">"+o[1]+"</option>").join("")+'</select><span class="sub" id="ds-c"></span></div>'+
    '<div class="tablebox"><table><thead><tr><th class="nosort">Status</th><th class="nosort">Expires</th><th class="nosort">Clears</th><th class="nosort">Dig Safe #</th><th class="nosort">Job</th><th class="nosort">#</th><th class="nosort">Pole # / location</th><th class="nosort">Town</th><th class="nosort">Entered by</th></tr></thead><tbody id="ds-b"></tbody></table></div>';
  const fill=()=>{const q=f.q.trim().toLowerCase();
    const L=all.filter(x=>(!f.job||x.j.id===f.job)&&(f.st===""?true:f.st==="open"?["expired","renew","wait","clear"].includes(x.s.k):x.s.k===f.st)&&(!q||[x.j.name,x.p.esPole,x.p.street,x.p.town,x.p.ticket,x.p.digsafe&&x.p.digsafe.ticket].join(" ").toLowerCase().indexOf(q)>=0))
      .sort((a,b)=>a.s.rank-b.s.rank||String(a.p.digsafe&&a.p.digsafe.expires||"9999").localeCompare(String(b.p.digsafe&&b.p.digsafe.expires||"9999"))||a.j.name.localeCompare(b.j.name)||(a.p.n||0)-(b.p.n||0));
    document.getElementById("ds-c").textContent=L.length+" location"+(L.length===1?"":"s");const tb=document.getElementById("ds-b");
    tb.innerHTML=L.map(({j,p,s})=>{const d=p.digsafe||{};return'<tr tabindex="0" data-id="'+esc(j.id+"|"+p.id)+'"><td>'+dsChip(j,p)+"</td><td"+(s.k==="expired"?' class="late"':"")+">"+esc(fmtD(d.expires)||"—")+"</td><td>"+esc(fmtD(d.clear)||"—")+'</td><td class="mono">'+esc(d.ticket||"")+"</td><td>"+esc(j.name)+'</td><td class="mono">'+esc(p.n)+"</td><td><b>"+esc(p.esPole||"")+"</b> "+esc(p.street||"")+"</td><td>"+esc(p.town||"")+'</td><td class="sub">'+esc(d.by||"")+"</td></tr>";}).join("")||
      '<tr><td colspan="9"><div class="empty"><b>Nothing here</b>'+(withDs.length?"Try another filter.":"Enter Dig Safe tickets on a job's Pre Flight page and they show up here.")+"</div></td></tr>";
    bindRows(tb,k=>{const [jid,pid]=k.split("|");openPfLocation(jid,pid);});};
  ["ds-q","ds-job","ds-st"].forEach(id=>{const el=document.getElementById(id);el[id==="ds-q"?"oninput":"onchange"]=()=>{f[id==="ds-q"?"q":id==="ds-job"?"job":"st"]=el.value;fill();};});
  fill();}
const dsAlertCount=()=>jobs().filter(j=>!j.archived&&!j.test).reduce((a,j)=>a+(j.poles||[]).filter(p=>p.digsafe&&["expired","renew"].includes(dsStatus(j,p).k)).length,0);
/* new unit sheet: when the location has a pre-flight, start from its planned units and photo */
function pfPrefillForm(m,p,slots,others,drawOthers){if(!p||!pfHas(p))return;const u=p.pf.units||{};
  const inputs=[...m.querySelectorAll("[data-q]")];const empty=inputs.every(i=>i.value.trim()==="")&&!others.some(o=>o.key);let n=0;
  if(empty&&Object.keys(u).length){inputs.forEach(i=>{if(u[i.dataset.q]!=null){i.value=u[i.dataset.q];n++;}});
    const keys=new Set(inputs.map(i=>i.dataset.q));Object.keys(u).filter(k=>!keys.has(k)&&!RETIRED.has(k)).forEach(k=>{others.push({key:k,qty:u[k],note:""});n++;});drawOthers();}
  let ph=false;if(p.pf.photo&&!slots.before.blob&&!slots.before.meta){slots.before.meta=p.pf.photo;ph=true;bindPhotoSlots(m,slots);}
  if(n||ph)toast("Started from the pre-flight: "+[n?n+" planned unit"+(n===1?"":"s"):"",ph?"Before photo":""].filter(Boolean).join(" and ")+". Change anything that's different.",6000);}
/* sheet page: planned (pre-flight) vs this location's unit sheets */
function pfSheetSection(d){const j=jobById(d.jobId);const p=j&&poleById(j,d.poleId);if(!p||!p.pf||!Object.keys(p.pf.units||{}).length)return"";
  const sh=sheets().filter(s=>s.jobId===j.id&&s.poleId===p.id);const df=pfDiff(p,sh)||[];
  return'<h2 class="sec">Pre-flight plan vs unit sheets</h2>'+(df.length?'<div class="banner"><b>'+df.length+" difference"+(df.length===1?"":"s")+" from the pre-flight plan</b> (all "+sh.length+" unit sheet"+(sh.length===1?"":"s")+" for this location)<ul style=\"margin:4px 0 0\">"+pfDiffHtml(df)+"</ul></div>":'<p class="sub">The unit sheets for this location match the pre-flight plan.</p>');}
