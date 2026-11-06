/* ---------- Daily rosters (General Foreman): crews, workers, equipment and hours per day → weekly pay sheet + T&E weekly timesheets ---------- */
const RO_DEF={st:8,ot:2,dt:0,eq:10};
const RO_ROLE_CODE=(()=>{const m={};Object.entries(TE_CODE_ROLE).forEach(([k,v])=>{if(!m[v])m[v]=k;});return m;})();
const rosters=()=>[...S.docs.entries()].filter(([,d])=>d.type==="roster").map(([id,d])=>Object.assign({id},d));
const weekMon=iso=>{const d=new Date(iso+"T12:00:00Z");const k=(d.getUTCDay()+6)%7;return addDays(iso,-k);};
const roWeekDays=ws=>[0,1,2,3,4,5].map(i=>addDays(ws,i));
const roOf=(gfKey,date)=>rosters().find(r=>r.gfKey===gfKey&&r.date===date);
const roWeek=(gfKey,ws)=>{const days=roWeekDays(ws);return rosters().filter(r=>r.gfKey===gfKey&&days.includes(r.date)).sort((a,b)=>a.date.localeCompare(b.date));};
const canRoEdit=gfKey=>W()&&(role()==="crew"?gfKey===S.myKey:["admin","approver"].includes(role()));
const roDay=iso=>TE_DAYS[(new Date(iso+"T12:00:00Z").getUTCDay()+6)%7]+" "+fmtD(iso);
const roNum=v=>{const n=Number(v);return isFinite(n)?n:0;};
function roCounts(r){const ppl=new Set(),eq=new Set();let hrs=0;(r.crews||[]).forEach(c=>{(c.workers||[]).forEach(w=>{ppl.add(w.name.toLowerCase());hrs+=roNum(w.st)+roNum(w.ot)+roNum(w.dt);});(c.equip||[]).forEach(e=>eq.add(e.desc+"#"+e.unitNo));});return{crews:(r.crews||[]).length,people:ppl.size,equip:eq.size,hrs};}
/* equipment units known to the company: saved units + every unit seen on a weekly timesheet */
function roUnits(){const out=[];const add=(u)=>{const k=teNorm(u.desc)+"#"+String(u.unitNo||"").trim();if(!u.desc||out.some(x=>x.k===k))return;out.push({k,desc:u.desc,unitNo:String(u.unitNo||"").trim(),items:(u.items||[]).filter(Boolean)});};
  ((S.index&&S.index.equipUnits)||[]).forEach(add);sheets().filter(isTe).forEach(s=>(s.equip||[]).forEach(add));
  rosters().forEach(r=>(r.crews||[]).forEach(c=>(c.equip||[]).forEach(add)));
  return out.sort((a,b)=>a.desc.localeCompare(b.desc)||a.unitNo.localeCompare(b.unitNo,undefined,{numeric:true}));}
function roGfName(gfKey){const p=S.index&&S.index.profiles&&S.index.profiles[gfKey];return p?p.name:(rosters().find(r=>r.gfKey===gfKey)||{}).gfName||"General Foreman";}

/* labor + equipment for a week, summed per person / unit per day (all crews, or only crews on one job) */
function roAggregate(list,days,jobId){
  const labor=[],equip=[];
  list.forEach(r=>{const k=days.indexOf(r.date);if(k<0)return;(r.crews||[]).forEach(c=>{if(jobId!=null&&c.jobId!==jobId)return;
    (c.workers||[]).forEach(w=>{let L=labor.find(x=>x.name.toLowerCase()===w.name.toLowerCase());
      if(!L){L={pid:w.pid||"",name:w.name,role:w.role,cls:RO_ROLE_CODE[w.role]||"",code:RO_ROLE_CODE[w.role]||"",h:days.map(()=>null),pdDays:0,lodgeNights:0};labor.push(L);}
      const h=L.h[k]||(L.h[k]={st:0,ot:0,dt:0});h.st+=roNum(w.st);h.ot+=roNum(w.ot);h.dt+=roNum(w.dt);});
    (c.equip||[]).forEach(e=>{let E=equip.find(x=>teNorm(x.desc)===teNorm(e.desc)&&x.unitNo===e.unitNo);
      if(!E){E={desc:e.desc,unitNo:e.unitNo,code:"",items:(e.items||[]).filter(Boolean),h:days.map(()=>0)};equip.push(E);}E.h[k]+=roNum(e.h);});});});
  labor.forEach(L=>{L.h=L.h.map(h=>h&&(h.st||h.ot||h.dt)?h:null);});
  return{labor:labor.filter(L=>L.h.some(Boolean)),equip:equip.filter(E=>E.h.some(Boolean))};}

/* ---------- week panel (GF home + Payroll tab) ---------- */
function renderRosterWeek(host,gfKey){
  if(!host)return;S.roWk=S.roWk||{};const ws=S.roWk[gfKey]||(S.roWk[gfKey]=weekMon(todayStr()));const days=roWeekDays(ws);const list=roWeek(gfKey,ws);const ed=canRoEdit(gfKey);
  const pkey=gfKey+"|"+ws;const pay=(S.index.rosterPay||{})[pkey];
  const teJobs=[...new Set(list.flatMap(r=>(r.crews||[]).map(c=>c.jobId).filter(Boolean)))].map(jobById).filter(j=>j&&isTeJob(j));
  const teFor=j=>sheets().find(s=>isTe(s)&&s.jobId===j.id&&s.weekStart===ws&&s.imported&&s.imported.rosterGf===gfKey);
  host.innerHTML='<section class="ro-wk"><div class="ro-wk-h"><h2 class="sec" style="margin:0">Daily rosters'+(role()==="crew"?"":" — "+esc(roGfName(gfKey)))+'</h2><div class="ro-nav"><button class="btn sm" type="button" data-wk="-7" aria-label="Previous week">‹</button><b>Week of '+esc(fmtD(ws))+" – "+esc(fmtD(days[5]))+'</b><button class="btn sm" type="button" data-wk="7" aria-label="Next week">›</button>'+(ws!==weekMon(todayStr())?'<button class="btn sm" type="button" data-wk="0">This week</button>':"")+"</div></div>"+
    '<div class="ro-days">'+days.map(d=>{const r=list.find(x=>x.date===d);const c=r?roCounts(r):null;const today=d===todayStr();
      return'<div class="ro-day'+(r?" has":"")+(today?" today":"")+'"><div class="ro-dn">'+esc(roDay(d))+(today?' <span class="chip c-sch">Today</span>':"")+"</div>"+
        (r?'<div class="sub">'+c.crews+" crew"+(c.crews===1?"":"s")+" · "+c.people+" people · "+c.equip+" equipment</div>"+'<div class="sub">'+fmtN(c.hrs)+' labor hrs</div><button class="btn sm" type="button" data-open="'+esc(r.id)+'">'+(ed?"Open / edit":"View")+"</button>"
          :(ed?'<button class="btn sm primary" type="button" data-new="'+esc(d)+'">+ Create roster</button>':'<div class="sub">No roster</div>'))+"</div>";}).join("")+"</div>"+
    '<div class="ro-acts">'+
      (!(role()==="crew"||canPayroll())?(list.length?"":'<span class="sub">No rosters this week.</span>'):list.length?'<button class="btn'+(pay?"":" primary")+'" type="button" id="ro-pay">'+(pay?"Republish pay sheet":"Create pay sheet for the week")+"</button>"+(pay?'<button class="btn" type="button" id="ro-paydl">Download pay sheet</button><span class="sub">Published by '+esc(pay.by)+" · "+esc(fmtT(pay.at))+(can.seePrice()||role()!=="crew"?" · total pay "+money(pay.totals.pay):"")+"</span>":""):'<span class="sub">Create a roster for each day worked. The pay sheet for the week is built from them.</span>')+
    "</div>"+
    (teJobs.length?'<div class="ro-acts">'+teJobs.map(j=>{const s=teFor(j);const locked=s&&![ST.SUB,ST.RET].includes(s.status);
      return'<span class="ro-te"><b>'+esc(j.name)+"</b> (T&amp;E) "+(s?'<a href="#sheet-'+esc(s.id)+'">'+esc(s.no)+"</a> "+stChip(s):"")+(ed&&!locked?' <button class="btn sm" type="button" data-te="'+esc(j.id)+'">'+(s?"Update timesheet from rosters":"Create weekly T&amp;E timesheet")+"</button>":"")+"</span>";}).join("")+"</div>":"")+
    "</section>";
  host.querySelectorAll("[data-wk]").forEach(b=>b.onclick=()=>{const n=+b.dataset.wk;S.roWk[gfKey]=n?addDays(ws,n):weekMon(todayStr());renderRosterWeek(host,gfKey);});
  host.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>{location.hash="roster-"+b.dataset.open;});
  host.querySelectorAll("[data-new]").forEach(b=>b.onclick=()=>{S.rEdit=null;location.hash="roster-new-"+b.dataset.new+(role()==="crew"?"":"~"+gfKey);});
  const pb=host.querySelector("#ro-pay");if(pb)pb.onclick=()=>roPaySheet(gfKey,ws);
  const pd=host.querySelector("#ro-paydl");if(pd)pd.onclick=()=>openPackage(pay.file,pd);
  host.querySelectorAll("[data-te]").forEach(b=>b.onclick=()=>roMakeTe(gfKey,ws,b.dataset.te,b));}

/* weekly pay sheet from the GF's daily rosters (reuses the T&E pay sheet builder) */
function roPaySheet(gfKey,ws){const days=roWeekDays(ws);const list=roWeek(gfKey,ws);const agg=roAggregate(list,days,null);
  if(!agg.labor.length){toast("No hours on this week's rosters.");return;}
  const pkey=gfKey+"|"+ws;const gfName=roGfName(gfKey);
  const d={no:"the daily rosters ("+list.length+" day"+(list.length===1?"":"s")+")",labor:agg.labor,days,weekStart:ws,weekEnd:days[5],jobId:null};
  openPaySheet(null,{d,prev:(S.index.rosterPay||{})[pkey],fname:gfName+" Paysheet "+((iso=>{const[y,mo,da]=iso.split("-");return(+mo)+"-"+(+da)+"-"+y.slice(2);})(ws))+".xlsx",
    save:async rec=>{rec.rosters=list.map(r=>r.id);rec.gfKey=gfKey;rec.gfName=gfName;rec.weekStart=ws;await commitIndex(ix=>{ix.rosterPay=ix.rosterPay||{};ix.rosterPay[pkey]=rec;},"Workflow: roster pay sheet");return true;}});}

/* weekly T&E timesheet for one job from the week's rosters → goes to CM sign-off like an uploaded one */
async function roMakeTe(gfKey,ws,jobId,btn){const j=jobById(jobId);const days=roWeekDays(ws);const list=roWeek(gfKey,ws);const agg=roAggregate(list,days,jobId);
  if(!agg.labor.length){toast("No hours for "+j.name+" on this week's rosters.");return;}
  const noRole=agg.labor.filter(L=>!L.role);if(noRole.length){toast("Pick a classification for "+noRole.map(L=>L.name).join(", ")+" on the rosters.",8000);return;}
  const noItem=agg.equip.filter(E=>!E.items.length);if(noItem.length){toast("Match a rate item for "+noItem.map(E=>E.desc+(E.unitNo?" #"+E.unitNo:"")).join(", ")+" on the rosters.",8000);return;}
  const crews=list.flatMap(r=>(r.crews||[]).filter(c=>c.jobId===jobId));const foremen=[...new Set(crews.map(c=>String(c.foreman||"").trim()).filter(Boolean))];
  const patch={kind:"te",weekly:true,jobId,poleId:"",poleText:"",weekStart:ws,weekEnd:days[5],days,workDate:ws,crew:foremen.join(", "),gf:roGfName(gfKey),wo:j.wo||"",fwo:"",notes:[...new Set(crews.map(c=>String(c.notes||"").trim()).filter(Boolean))].join(" | "),
    labor:agg.labor,equip:agg.equip,subs:[],imported:{fromRosters:true,rosterGf:gfKey,rosters:list.map(r=>r.id),town:j.town||""}};
  const sum=teWeekText(patch)+" · "+agg.labor.length+" people · "+fmtN(teHours(patch))+" labor hrs · "+agg.equip.length+" equipment";
  const ex=sheets().find(s=>isTe(s)&&s.jobId===jobId&&s.weekStart===ws&&s.imported&&s.imported.rosterGf===gfKey);
  if(btn)btn.disabled=true;
  if(ex){if(![ST.SUB,ST.RET].includes(ex.status)){toast(ex.no+" is already signed off and can't be replaced.",7000);return;}
    const ok=await commitDoc(ex.id,x=>{if(![ST.SUB,ST.RET].includes(x.status))throw new Error(x.no+" changed since you opened it.");const keep=new Map((x.labor||[]).map(L=>[L.name,[L.pdDays,L.lodgeNights]]));Object.assign(x,patch);x.labor.forEach(L=>{const k=keep.get(L.name);if(k){L.pdDays=k[0]||0;L.lodgeNights=k[1]||0;}});x.status=ST.SUB;x.submittedAt=new Date().toISOString();},"Updated from daily rosters and resubmitted: "+sum);
    if(ok){toast(ex.no+" updated from the rosters and sent to the CM",6000);refresh();}}
  else{patch.status=ST.SUB;patch.submittedAt=new Date().toISOString();const id=await createDoc("sheet",patch,"Created from daily rosters: "+sum);if(id){toast((S.docs.get(id)||{}).no+" created from the rosters and sent to the CM",6000);refresh();}}}

/* ---------- roster editor (full page) ---------- */
function renderRoster(){
  const key=S.docId;let st=S.rEdit&&S.rEdit.key===key?S.rEdit:null;
  if(!st){let doc,id=null;
    if(key.indexOf("new-")===0){const [date,gk]=key.slice(4).split("~");const gfKey=gk||S.myKey;const ex=roOf(gfKey,date);if(ex){location.replace("#roster-"+ex.id);return;}
      if(!canRoEdit(gfKey)){main.innerHTML='<div class="empty"><b>Not available</b></div>';return;}
      doc={type:"roster",date,gfKey,gfName:roGfName(gfKey),crews:[{id:newId("c-"),foreman:"",jobId:"",notes:"",workers:[],equip:[]}],notes:""};}
    else{const d=S.docs.get(key);if(!d||d.type!=="roster"){main.innerHTML='<a class="back" href="#'+(role()==="crew"?"sheets":"rosters")+'">← Back</a><div class="empty"><b>Roster not found</b></div>';return;}
      if(role()==="crew"&&d.gfKey!==S.myKey){location.hash="sheets";return;}id=key;doc=JSON.parse(JSON.stringify(d));}
    st=S.rEdit={key,id,doc,dirty:false};}
  const d=st.doc;const ed=canRoEdit(d.gfKey);const back=role()==="crew"?"#sheets":"#rosters";
  const prev=rosters().filter(r=>r.gfKey===d.gfKey&&r.date<d.date).sort((a,b)=>b.date.localeCompare(a.date))[0];
  const tj=jobs().filter(j=>!j.archived&&isTeJob(j));
  const hrsIn=(k,v,lab,i,ci)=>'<input type="number" min="0" max="24" step="0.5" inputmode="decimal" data-ci="'+ci+'" data-wi="'+i+'" data-h="'+k+'" value="'+esc(v)+'" aria-label="'+lab+'"'+(ed?"":" disabled")+">";
  main.innerHTML='<a class="back" href="'+back+'">← '+(role()==="crew"?"My unit sheets":"Rosters")+"</a>"+
    '<section class="jobhead"><div><h1>Roster — '+esc(roDay(d.date))+'</h1><div class="meta"><span>General Foreman '+esc(d.gfName)+"</span>"+(st.id?"<span>Saved "+esc(fmtT((S.docs.get(st.id)||{}).updatedAt||""))+"</span>":'<span class="chip c-sch">Not saved yet</span>')+"</div></div>"+
      '<div class="acts">'+(ed&&!st.id&&prev&&!d.crews.some(c=>c.workers.length||c.equip.length)?'<button class="btn" type="button" id="ro-copy">Copy crews from '+esc(roDay(prev.date))+"</button>":"")+(ed&&st.id?'<button class="btn" type="button" id="ro-del">Delete roster</button>':"")+"</div></section>"+
    d.crews.map((c,ci)=>{const opts=c.workers.map(w=>w.name);
      return'<section class="ro-crew" data-ci="'+ci+'"><div class="ro-ch"><h2 class="sec" style="margin:0">Crew '+(ci+1)+"</h2>"+(ed&&d.crews.length>1?'<button class="btn sm" type="button" data-rmcrew="'+ci+'">Remove crew</button>':"")+"</div>"+
        '<div class="ro-fields"><label class="f">Foreman<select data-ci="'+ci+'" data-k="foreman"'+(ed?"":" disabled")+'><option value="">Pick from the crew…</option>'+opts.map(n=>"<option"+(n===c.foreman?" selected":"")+">"+esc(n)+"</option>").join("")+"</select></label>"+
          '<label class="f">T&amp;E job (for billing)<select data-ci="'+ci+'" data-k="jobId"'+(ed?"":" disabled")+'><option value="">None — payroll only</option>'+tj.map(j=>'<option value="'+esc(j.id)+'"'+(j.id===c.jobId?" selected":"")+">"+esc(j.name)+"</option>").join("")+(c.jobId&&!tj.some(j=>j.id===c.jobId)?'<option value="'+esc(c.jobId)+'" selected>'+esc((jobById(c.jobId)||{name:"(removed job)"}).name)+"</option>":"")+"</select></label>"+
          '<label class="f wide">Notes<input data-ci="'+ci+'" data-k="notes" value="'+esc(c.notes||"")+'"'+(ed?"":" disabled")+"></label></div>"+
        '<h3 class="pv-h3">Workers ('+c.workers.length+")</h3>"+
        (c.workers.length?'<div class="tablebox"><table class="static ro-t"><thead><tr><th>Name</th><th>Classification</th><th class="num">ST</th><th class="num">OT</th><th class="num">DT</th><th class="num">Total</th><th></th></tr></thead><tbody>'+
          c.workers.map((w,i)=>"<tr><td><b>"+esc(w.name)+"</b>"+(w.isNew?' <span class="chip c-sch">New</span>':"")+"</td><td>"+roleSelect(w.role,undefined,' data-ci="'+ci+'" data-wi="'+i+'" data-k="role" aria-label="Classification for '+esc(w.name)+'"'+(ed?"":" disabled"))+"</td><td>"+hrsIn("st",w.st,"ST hours "+esc(w.name),i,ci)+"</td><td>"+hrsIn("ot",w.ot,"OT hours "+esc(w.name),i,ci)+"</td><td>"+hrsIn("dt",w.dt,"DT hours "+esc(w.name),i,ci)+'</td><td class="mono num" data-tot="'+ci+"-"+i+'">'+fmtN(roNum(w.st)+roNum(w.ot)+roNum(w.dt))+"</td><td>"+(ed?'<button class="btn sm" type="button" data-rmw="'+ci+"-"+i+'" aria-label="Remove '+esc(w.name)+'">✕</button>':"")+"</td></tr>").join("")+"</tbody></table></div>":'<p class="sub" style="margin:0">No workers yet.</p>')+
        (ed?'<div class="ro-acts"><button class="btn" type="button" data-addw="'+ci+'">+ Add workers</button>'+(c.workers.length?'<button class="btn sm" type="button" data-def="'+ci+'">Set everyone to 8 ST + 2 OT</button>':"")+"</div>":"")+
        '<h3 class="pv-h3">Equipment ('+c.equip.length+")</h3>"+
        (c.equip.length?'<div class="tablebox"><table class="static ro-t"><thead><tr><th>Equipment</th><th>Unit #</th><th>Rate item'+(c.jobId?"":' <span class="sub">(for T&amp;E billing)</span>')+'</th><th class="num">Hours</th><th></th></tr></thead><tbody>'+
          c.equip.map((e,i)=>"<tr><td><b>"+esc(e.desc)+"</b>"+(e.isNew?' <span class="chip c-sch">New</span>':"")+'</td><td class="mono">'+esc(e.unitNo||"")+'</td><td class="sub">'+(e.items&&e.items.length?esc(e.items.join(" + ")):'<span class="late">Not matched</span>')+'</td><td><input type="number" min="0" max="24" step="0.5" inputmode="decimal" data-ci="'+ci+'" data-ei="'+i+'" data-k="eh" value="'+esc(e.h)+'" aria-label="Hours for '+esc(e.desc)+'"'+(ed?"":" disabled")+"></td><td>"+(ed?'<button class="btn sm" type="button" data-rme="'+ci+"-"+i+'" aria-label="Remove '+esc(e.desc)+'">✕</button>':"")+"</td></tr>").join("")+"</tbody></table></div>":'<p class="sub" style="margin:0">No equipment yet.</p>')+
        (ed?'<div class="ro-acts"><button class="btn" type="button" data-adde="'+ci+'">+ Add equipment</button>'+(c.equip.length?'<button class="btn sm" type="button" data-defe="'+ci+'">Match equipment to crew hours</button>':"")+"</div>":"")+
      "</section>";}).join("")+
    (ed?'<div class="ro-acts"><button class="btn" type="button" id="ro-addcrew">+ Add another crew</button></div>':"")+
    '<div class="row-inline ro-save"><span class="err" id="ro-err" role="alert" style="margin:0 auto 0 0"></span><a class="btn" href="'+back+'">'+(ed?"Cancel":"Close")+"</a>"+(ed?'<button class="btn primary" type="button" id="ro-save">Save roster</button>':"")+"</div>";
  if(!ed)return;
  const redraw=()=>{st.dirty=true;renderRoster();};
  main.querySelectorAll("[data-k]").forEach(el=>{const ci=+el.dataset.ci,c=d.crews[ci];const ev=el.tagName==="SELECT"?"onchange":"oninput";
    el[ev]=()=>{st.dirty=true;const k=el.dataset.k;
      if(k==="role")c.workers[+el.dataset.wi].role=el.value;else if(k==="eh")c.equip[+el.dataset.ei].h=el.value;else c[k]=el.value;};});
  main.querySelectorAll("[data-h]").forEach(el=>{el.oninput=()=>{st.dirty=true;const ci=+el.dataset.ci,i=+el.dataset.wi;const w=d.crews[ci].workers[i];w[el.dataset.h]=el.value;const t=main.querySelector('[data-tot="'+ci+"-"+i+'"]');if(t)t.textContent=fmtN(roNum(w.st)+roNum(w.ot)+roNum(w.dt));};});
  main.querySelectorAll("[data-rmw]").forEach(b=>b.onclick=()=>{const [ci,i]=b.dataset.rmw.split("-").map(Number);const c=d.crews[ci];const [w]=c.workers.splice(i,1);if(c.foreman===w.name)c.foreman="";redraw();});
  main.querySelectorAll("[data-rme]").forEach(b=>b.onclick=()=>{const [ci,i]=b.dataset.rme.split("-").map(Number);d.crews[ci].equip.splice(i,1);redraw();});
  main.querySelectorAll("[data-rmcrew]").forEach(b=>b.onclick=()=>{const c=d.crews[+b.dataset.rmcrew];if((c.workers.length||c.equip.length)&&!confirm("Remove crew "+(+b.dataset.rmcrew+1)+" and everyone on it?"))return;d.crews.splice(+b.dataset.rmcrew,1);redraw();});
  main.querySelectorAll("[data-def]").forEach(b=>b.onclick=()=>{d.crews[+b.dataset.def].workers.forEach(w=>{w.st=RO_DEF.st;w.ot=RO_DEF.ot;w.dt=RO_DEF.dt;});redraw();});
  main.querySelectorAll("[data-defe]").forEach(b=>b.onclick=()=>{const c=d.crews[+b.dataset.defe];const hs=c.workers.map(w=>roNum(w.st)+roNum(w.ot)+roNum(w.dt));const mx=hs.length?Math.max(...hs):RO_DEF.eq;c.equip.forEach(e=>{e.h=mx;});redraw();});
  main.querySelectorAll("[data-addw]").forEach(b=>b.onclick=()=>roPickWorkers(st,+b.dataset.addw,redraw));
  main.querySelectorAll("[data-adde]").forEach(b=>b.onclick=()=>roPickEquip(st,+b.dataset.adde,redraw));
  const ac=document.getElementById("ro-addcrew");if(ac)ac.onclick=()=>{d.crews.push({id:newId("c-"),foreman:"",jobId:"",notes:"",workers:[],equip:[]});redraw();};
  const cp=document.getElementById("ro-copy");if(cp)cp.onclick=()=>{d.crews=JSON.parse(JSON.stringify(prev.crews||[])).map(c=>Object.assign(c,{id:newId("c-"),workers:(c.workers||[]).map(w=>Object.assign(w,{st:RO_DEF.st,ot:RO_DEF.ot,dt:RO_DEF.dt,isNew:false})),equip:(c.equip||[]).map(e=>Object.assign(e,{h:RO_DEF.eq,isNew:false}))}));if(!d.crews.length)d.crews=[{id:newId("c-"),foreman:"",jobId:"",notes:"",workers:[],equip:[]}];redraw();toast("Copied "+d.crews.length+" crew"+(d.crews.length===1?"":"s")+" from "+roDay(prev.date)+". Hours reset to 8 ST + 2 OT.",5000);};
  const del=document.getElementById("ro-del");if(del)del.onclick=()=>{const pay=(S.index.rosterPay||{})[d.gfKey+"|"+weekMon(d.date)];
    confirmBox("Delete the roster for "+roDay(d.date)+"?",(pay?"The pay sheet already published for this week won't change until you republish it. ":"")+"This can't be undone.","Delete",async()=>{if(!canSave())return;
      await commitIndex(ix=>{delete ix.docs[st.id];},"Workflow: roster deleted");S.docs.delete(st.id);S.rEdit=null;toast("Roster deleted");location.hash=back.slice(1);},{danger:true});};
  document.getElementById("ro-save").onclick=async e=>{const err=document.getElementById("ro-err");err.textContent="";const b=e.target;
    try{const out=roValidate(d);if(!canSave())return;b.disabled=true;b.textContent="Saving…";
      const newPeople=[],newUnits=[];d.crews.forEach(c=>{c.workers.forEach(w=>{if(w.isNew)newPeople.push({name:w.name,role:w.role});delete w.isNew;});c.equip.forEach(x=>{if(x.isNew)newUnits.push({desc:x.desc,unitNo:x.unitNo,items:x.items});delete x.isNew;});});
      if(newPeople.length||newUnits.length)await commitIndex(ix=>{ix.roster=ix.roster||[];newPeople.forEach(p=>{if(!ix.roster.some(x=>x.name.toLowerCase()===p.name.toLowerCase()))ix.roster.push({id:newId("w-"),name:p.name,role:p.role,addedBy:S.me.name,addedAt:new Date().toISOString()});});
        ix.equipUnits=ix.equipUnits||[];newUnits.forEach(u=>{if(!ix.equipUnits.some(x=>teNorm(x.desc)===teNorm(u.desc)&&String(x.unitNo)===String(u.unitNo)))ix.equipUnits.push({id:newId("u-"),desc:u.desc,unitNo:u.unitNo,items:u.items,addedBy:S.me.name,addedAt:new Date().toISOString()});});},"Workflow: roster people and equipment");
      const hist="Roster saved: "+out;
      if(st.id){const ok=await commitDoc(st.id,x=>{x.crews=d.crews;x.notes=d.notes||"";},hist);if(!ok){b.disabled=false;b.textContent="Save roster";return;}}
      else{if(roOf(d.gfKey,d.date))throw new Error("A roster for "+roDay(d.date)+" was just saved by someone else. Reload and open it.");
        const doc={date:d.date,gfKey:d.gfKey,gfName:d.gfName,crews:d.crews,notes:d.notes||""};const id=await createDoc("roster",doc,hist);if(!id){b.disabled=false;b.textContent="Save roster";return;}}
      S.rEdit=null;toast("Roster saved for "+roDay(d.date),4000);location.hash=back.slice(1);}
    catch(x){err.textContent=x.message||String(x);b.disabled=false;b.textContent="Save roster";}};}
function roValidate(d){
  if(!d.crews.length)throw new Error("Add a crew.");const seen=new Map();let ppl=0,hrs=0;
  d.crews.forEach((c,ci)=>{const n="Crew "+(ci+1);if(!c.workers.length)throw new Error(n+": add the workers (or remove the crew).");
    c.workers.forEach(w=>{const k=w.name.toLowerCase();if(seen.has(k))throw new Error(w.name+" is on "+seen.get(k)+" and "+n+". Put each person on one crew per day.");seen.set(k,n);
      if(!w.role)throw new Error(n+": pick a classification for "+w.name+".");
      ["st","ot","dt"].forEach(h=>{const v=w[h];if(v!==""&&v!=null&&(!isFinite(Number(v))||Number(v)<0))throw new Error(n+": "+w.name+" "+h.toUpperCase()+" hours aren't a number.");});
      const t=roNum(w.st)+roNum(w.ot)+roNum(w.dt);if(t>24)throw new Error(n+": "+w.name+" has "+fmtN(t)+" hours. A day can't be more than 24.");ppl++;hrs+=t;
      w.st=roNum(w.st);w.ot=roNum(w.ot);w.dt=roNum(w.dt);});
    if(c.foreman&&!c.workers.some(w=>w.name===c.foreman))c.foreman="";
    c.equip.forEach(e=>{const v=Number(e.h);if(!isFinite(v)||v<0||v>24)throw new Error(n+": "+e.desc+" hours must be 0–24.");e.h=v;
      if(c.jobId&&!(e.items||[]).length)throw new Error(n+": "+e.desc+(e.unitNo?" #"+e.unitNo:"")+" needs a rate item for T&E billing. Remove it and add it again with a rate item.");});});
  return d.crews.length+" crew(s) · "+ppl+" people · "+fmtN(hrs)+" labor hrs";}

function roPickWorkers(st,ci,done){const d=st.doc;const on=new Set(d.crews.flatMap(c=>c.workers.map(w=>w.name.toLowerCase())));
  const list=roster().filter(p=>!on.has(p.name.toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name));
  const m=modal("Add workers — crew "+(ci+1),'<input type="search" id="rw-q" placeholder="Search names…" aria-label="Search workers" style="width:100%;padding:8px 10px;border:1px solid var(--field);border-radius:6px">'+
    '<div class="ulist" id="rw-list" style="max-height:42vh;overflow:auto;margin-top:8px">'+(list.length?list.map(p=>'<label class="u" style="grid-template-columns:auto 1fr;cursor:pointer" data-hay="'+esc(p.name.toLowerCase())+'"><input type="checkbox" data-pid="'+esc(p.id)+'"><span><b>'+esc(p.name)+'</b> <span class="sub">'+esc(p.role||"No classification")+"</span></span></label>").join(""):'<p class="sub">Everyone on the company roster is already on this roster.</p>')+"</div>"+
    '<details style="margin-top:10px"><summary>Someone new (not on the list)</summary><div class="row-inline" style="gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:6px"><label class="f" style="flex:1 1 180px">Name<input id="rw-nn"></label><label class="f" style="flex:1 1 200px">Classification'+roleSelect("",undefined,' id="rw-nr"')+'</label></div><p class="sub" style="margin:4px 0 0">They are added to the company roster when you save.</p></details>'+
    '<p class="sub" style="margin:8px 0 0">Hours start at 8 ST + 2 OT. Change them on the roster.</p>',
    '<button class="btn" type="button" data-x>Cancel</button><button class="btn primary" type="button" id="rw-go">Add</button>');
  const q=m.querySelector("#rw-q");q.oninput=()=>{const v=q.value.trim().toLowerCase();m.querySelectorAll("#rw-list label").forEach(l=>{l.hidden=!!v&&l.dataset.hay.indexOf(v)<0;});};setTimeout(()=>q.focus(),50);
  m.querySelector("#rw-go").onclick=()=>{const msg=m.querySelector("[data-msg]");const c=d.crews[ci];const add=[];
    m.querySelectorAll("[data-pid]:checked").forEach(cb=>{const p=list.find(x=>x.id===cb.dataset.pid);if(p)add.push({pid:p.id,name:p.name,role:p.role||"",st:RO_DEF.st,ot:RO_DEF.ot,dt:RO_DEF.dt});});
    const nn=m.querySelector("#rw-nn").value.trim(),nr=m.querySelector("#rw-nr").value;
    if(nn){if(!nr){msg.textContent="Pick a classification for "+nn+".";return;}if(on.has(nn.toLowerCase())||add.some(a=>a.name.toLowerCase()===nn.toLowerCase())){msg.textContent=nn+" is already on this roster.";return;}
      const ex=((S.index&&S.index.roster)||[]).find(p=>p.name.toLowerCase()===nn.toLowerCase());add.push(ex?{pid:ex.id,name:ex.name,role:nr,st:RO_DEF.st,ot:RO_DEF.ot,dt:RO_DEF.dt}:{pid:"",name:nn,role:nr,st:RO_DEF.st,ot:RO_DEF.ot,dt:RO_DEF.dt,isNew:true});}
    if(!add.length){msg.textContent="Tick at least one person, or enter someone new.";return;}
    c.workers.push(...add);if(!c.foreman){const f=c.workers.find(w=>/^Foreman$/i.test(w.role))||c.workers.find(w=>/Foreman/i.test(w.role));if(f)c.foreman=f.name;}
    closeOverlay();done();};}

function roPickEquip(st,ci,done){const d=st.doc;const on=new Set(d.crews.flatMap(c=>c.equip.map(e=>teNorm(e.desc)+"#"+String(e.unitNo||"").trim())));
  const list=roUnits().filter(u=>!on.has(u.k));
  const m=modal("Add equipment — crew "+(ci+1),'<input type="search" id="re-q" placeholder="Search equipment or unit #…" aria-label="Search equipment" style="width:100%;padding:8px 10px;border:1px solid var(--field);border-radius:6px">'+
    '<div class="ulist" id="re-list" style="max-height:40vh;overflow:auto;margin-top:8px">'+(list.length?list.map((u,i)=>'<label class="u" style="grid-template-columns:auto 1fr;cursor:pointer" data-hay="'+esc((u.desc+" "+u.unitNo+" "+u.items.join(" ")).toLowerCase())+'"><input type="checkbox" data-ui="'+i+'"><span><b>'+esc(u.desc)+"</b>"+(u.unitNo?' <span class="mono">#'+esc(u.unitNo)+"</span>":"")+'<br><span class="sub">'+(u.items.length?esc(u.items.join(" + ")):"No rate item")+"</span></span></label>").join(""):'<p class="sub">No saved equipment yet. Add a unit below.</p>')+"</div>"+
    '<details style="margin-top:10px"'+(list.length?"":" open")+'><summary>Equipment not on the list</summary><div class="row-inline" style="gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:6px"><label class="f" style="flex:2 1 200px">Description<input id="re-nd" placeholder="e.g. Bucket Truck"></label><label class="f" style="flex:1 1 100px">Unit #<input id="re-nu"></label></div>'+
      '<div class="row-inline" style="gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:6px"><label class="f" style="flex:1 1 240px">Rate item (T&amp;E pricing)<span id="re-i1">'+equipSelect("")+'</span></label><label class="f" style="flex:1 1 240px">Second rate item (optional — e.g. pole trailer)<span id="re-i2">'+equipSelect("")+"</span></label></div>"+
      '<p class="sub" style="margin:4px 0 0">Saved to the company equipment list when you save the roster.</p></details>'+
    '<p class="sub" style="margin:8px 0 0">Hours start at 10 (8 ST + 2 OT).</p>',
    '<button class="btn" type="button" data-x>Cancel</button><button class="btn primary" type="button" id="re-go">Add</button>',"wide");
  const q=m.querySelector("#re-q");q.oninput=()=>{const v=q.value.trim().toLowerCase();m.querySelectorAll("#re-list label").forEach(l=>{l.hidden=!!v&&l.dataset.hay.indexOf(v)<0;});};setTimeout(()=>q.focus(),50);
  m.querySelector("#re-go").onclick=()=>{const msg=m.querySelector("[data-msg]");const c=d.crews[ci];const add=[];
    m.querySelectorAll("[data-ui]:checked").forEach(cb=>{const u=list[+cb.dataset.ui];add.push({desc:u.desc,unitNo:u.unitNo,items:u.items.slice(),h:RO_DEF.eq});});
    const nd=m.querySelector("#re-nd").value.trim(),nu=m.querySelector("#re-nu").value.trim();const i1=m.querySelector("#re-i1 select").value,i2=m.querySelector("#re-i2 select").value;
    if(nd){const k=teNorm(nd)+"#"+nu;if(on.has(k)||add.some(a=>teNorm(a.desc)+"#"+a.unitNo===k)){msg.textContent=nd+(nu?" #"+nu:"")+" is already on this roster.";return;}
      const al=((S.index&&S.index.teAlias&&S.index.teAlias.equip)||{})[teNorm(nd)]||[];const items=[i1,i2].filter(Boolean);
      add.push({desc:nd,unitNo:nu,items:items.length?items:al.slice(),h:RO_DEF.eq,isNew:true});}
    if(!add.length){msg.textContent="Tick at least one unit, or enter new equipment.";return;}
    c.equip.push(...add);closeOverlay();done();};}

/* Payroll tab: any General Foreman's rosters for the week (admins / billing) */
function roAdminSection(host){if(!host)return;const prof=(S.index&&S.index.profiles)||{};
  const keys=[...new Set(Object.keys(prof).filter(k=>prof[k].role==="crew").concat(rosters().map(r=>r.gfKey)))];if(!keys.length){host.innerHTML="";return;}
  if(!S.roGf||!keys.includes(S.roGf))S.roGf=keys.slice().sort((a,b)=>rosters().filter(r=>r.gfKey===b).length-rosters().filter(r=>r.gfKey===a).length)[0];
  host.innerHTML='<div class="filters" style="margin-top:6px"><label class="sub" for="ro-gf">General Foreman</label><select id="ro-gf">'+keys.map(k=>'<option value="'+esc(k)+'"'+(k===S.roGf?" selected":"")+">"+esc(roGfName(k))+" ("+rosters().filter(r=>r.gfKey===k).length+" rosters)</option>").join("")+'</select></div><div id="ro-adm-wk"></div>';
  host.querySelector("#ro-gf").onchange=e=>{S.roGf=e.target.value;roAdminSection(host);};
  renderRosterWeek(host.querySelector("#ro-adm-wk"),S.roGf);}

/* Rosters tab (Construction Managers, admins, billing): every GF's roster for a day, plus each GF's week */
function renderRosters(){
  const day=S.roDay||(S.roDay=todayStr());const list=rosters().filter(r=>r.date===day).sort((a,b)=>a.gfName.localeCompare(b.gfName));
  const tot=list.reduce((a,r)=>{const c=roCounts(r);a.crews+=c.crews;a.people+=c.people;a.equip+=c.equip;a.hrs+=c.hrs;return a;},{crews:0,people:0,equip:0,hrs:0});
  main.innerHTML='<section class="jobhead"><div><h1>Daily rosters</h1><div class="meta"><span>Crews, workers, equipment and hours entered by each General Foreman</span></div></div></section>'+
    '<div class="filters"><button class="btn sm" type="button" data-d="-1" aria-label="Previous day">‹</button><input type="date" id="rs-day" value="'+esc(day)+'" aria-label="Day"><button class="btn sm" type="button" data-d="1" aria-label="Next day">›</button>'+(day!==todayStr()?'<button class="btn sm" type="button" data-d="0">Today</button>':"")+'<span class="count"><b>'+esc(roDay(day))+"</b> · "+list.length+" roster"+(list.length===1?"":"s")+" · "+tot.crews+" crews · "+tot.people+" people · "+tot.equip+" equipment · "+fmtN(tot.hrs)+" labor hrs</span></div>"+
    (list.length?list.map(r=>'<section class="ro-crew"><div class="ro-ch"><h2 class="sec" style="margin:0">'+esc(r.gfName)+'</h2><button class="btn sm" type="button" data-open="'+esc(r.id)+'">'+(canRoEdit(r.gfKey)?"Open / edit":"Open")+"</button></div>"+
      (r.crews||[]).map((c,ci)=>{const j=c.jobId?jobById(c.jobId):null;
        return'<h3 class="pv-h3">Crew '+(ci+1)+(c.foreman?" — Foreman "+esc(c.foreman):"")+(j?' · <span class="chip c-sch">'+esc(j.name)+" (T&amp;E)</span>":"")+"</h3>"+(c.notes?'<p class="sub" style="margin:0 0 6px">'+esc(c.notes)+"</p>":"")+
          '<div class="ro-two"><div class="tablebox"><table class="static"><thead><tr><th>Worker</th><th>Classification</th><th class="num">ST</th><th class="num">OT</th><th class="num">DT</th></tr></thead><tbody>'+(c.workers||[]).map(w=>"<tr><td><b>"+esc(w.name)+"</b></td><td>"+esc(w.role)+'</td><td class="mono num">'+fmtN(w.st)+'</td><td class="mono num">'+fmtN(w.ot)+'</td><td class="mono num">'+fmtN(w.dt)+"</td></tr>").join("")+"</tbody></table></div>"+
          '<div class="tablebox"><table class="static"><thead><tr><th>Equipment</th><th>Unit #</th><th class="num">Hours</th></tr></thead><tbody>'+((c.equip||[]).map(e=>"<tr><td>"+esc(e.desc)+'</td><td class="mono">'+esc(e.unitNo||"")+'</td><td class="mono num">'+fmtN(e.h)+"</td></tr>").join("")||'<tr><td colspan="3" class="sub">No equipment</td></tr>')+"</tbody></table></div></div>";}).join("")+"</section>").join("")
      :'<div class="empty"><b>No rosters for '+esc(roDay(day))+"</b>General Foremen create them from their home screen.</div>")+
    '<h2 class="sec">Week by General Foreman</h2><div id="rs-wk"></div>';
  main.querySelectorAll("[data-d]").forEach(b=>b.onclick=()=>{const n=+b.dataset.d;S.roDay=n?addDays(day,n):todayStr();renderRosters();});
  document.getElementById("rs-day").onchange=e=>{if(e.target.value){S.roDay=e.target.value;renderRosters();}};
  main.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>{location.hash="roster-"+b.dataset.open;});
  roAdminSection(document.getElementById("rs-wk"));}
