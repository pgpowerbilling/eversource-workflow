/* ---------- Daily rosters (General Foreman): crews, workers, equipment and hours per day → weekly pay sheet + T&E weekly timesheets ---------- */
const RO_DEF={st:8,ot:2,dt:0,eq:10};
const RO_WX={st:2,ot:0,dt:0,eq:0};  /* Inclement Weather Day: 2 ST hours pay, equipment not run */
const roDef=d=>d&&d.weather?RO_WX:RO_DEF;
const wxChip='<span class="chip c-bad">Inclement Weather Day</span>';
const RO_ROLE_CODE=(()=>{const m={};Object.entries(TE_CODE_ROLE).forEach(([k,v])=>{if(!m[v])m[v]=k;});return m;})();
const rosters=()=>[...S.docs.entries()].filter(([,d])=>d.type==="roster").map(([id,d])=>Object.assign({id},d));
const weekMon=iso=>{const d=new Date(iso+"T12:00:00Z");const k=(d.getUTCDay()+6)%7;return addDays(iso,-k);};
const roWeekDays=ws=>[0,1,2,3,4,5].map(i=>addDays(ws,i));
const roOf=(gfKey,date)=>rosters().find(r=>r.gfKey===gfKey&&r.date===date);
const roWeek=(gfKey,ws)=>{const days=roWeekDays(ws);return rosters().filter(r=>r.gfKey===gfKey&&days.includes(r.date)).sort((a,b)=>a.date.localeCompare(b.date));};
const canRoEdit=gfKey=>W()&&(role()==="crew"?gfKey===S.myKey:["admin","approver"].includes(role()));
const roDay=iso=>TE_DAYS[(new Date(iso+"T12:00:00Z").getUTCDay()+6)%7]+" "+fmtD(iso);
const roNum=v=>{const n=Number(v);return isFinite(n)?n:0;};
function roCounts(r){const ppl=new Set(),eq=new Set();let hrs=0;roPeople(r).forEach(w=>{ppl.add(w.name.toLowerCase());hrs+=roNum(w.st)+roNum(w.ot)+roNum(w.dt);});(r.crews||[]).forEach(c=>{(c.equip||[]).forEach(e=>eq.add(e.desc+"#"+e.unitNo));});return{crews:(r.crews||[]).length,people:ppl.size,equip:eq.size,hrs};}
/* equipment units known to the company: saved units + every unit seen on a weekly timesheet */
function roUnits(){const out=[];const add=(u)=>{const k=teNorm(u.desc)+"#"+String(u.unitNo||"").trim();if(!u.desc||out.some(x=>x.k===k))return;out.push({k,desc:u.desc,unitNo:String(u.unitNo||"").trim(),items:(u.items||[]).filter(Boolean)});};
  ((S.index&&S.index.equipUnits)||[]).forEach(add);sheets().filter(isTe).forEach(s=>(s.equip||[]).forEach(add));
  rosters().forEach(r=>(r.crews||[]).forEach(c=>(c.equip||[]).forEach(add)));
  return out.sort((a,b)=>a.desc.localeCompare(b.desc)||a.unitNo.localeCompare(b.unitNo,undefined,{numeric:true}));}
function roGfName(gfKey){const p=S.index&&S.index.profiles&&S.index.profiles[gfKey];return p?p.name:(rosters().find(r=>r.gfKey===gfKey)||{}).gfName||"General Foreman";}

/* labor + equipment for a week, summed per person / unit per day (all crews, or only crews on one job) */
function roAggregate(list,days,jobId){
  const labor=[],equip=[];
  list.forEach(r=>{const k=days.indexOf(r.date);if(k<0)return;roPeople(r,jobId).forEach(w=>{let L=labor.find(x=>x.name.toLowerCase()===w.name.toLowerCase());
      if(!L){L={pid:w.pid||"",name:w.name,role:w.role,cls:RO_ROLE_CODE[w.role]||"",code:RO_ROLE_CODE[w.role]||"",h:days.map(()=>null),pdDays:0,lodgeNights:0};labor.push(L);}
      const h=L.h[k]||(L.h[k]={st:0,ot:0,dt:0});h.st+=roNum(w.st);h.ot+=roNum(w.ot);h.dt+=roNum(w.dt);});
    (r.crews||[]).forEach(c=>{if(jobId!=null&&c.jobId!==jobId)return;(c.equip||[]).forEach(e=>{let E=equip.find(x=>teNorm(x.desc)===teNorm(e.desc)&&x.unitNo===e.unitNo);
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
        (r?(r.weather?wxChip:"")+'<div class="sub">'+c.crews+" crew"+(c.crews===1?"":"s")+" · "+c.people+" people · "+c.equip+" equipment</div>"+'<div class="sub">'+fmtN(c.hrs)+' labor hrs</div><button class="btn sm" type="button" data-open="'+esc(r.id)+'">'+(ed?"Open / edit":"View")+"</button>"
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
    save:async rec=>{rec.rosters=list.map(r=>r.id);rec.gfKey=gfKey;rec.gfName=gfName;rec.weekStart=ws;await commitIndex(ix=>{ix.rosterPay=ix.rosterPay||{};const old=ix.rosterPay[pkey];if(old){rec.older=(old.older||[]).concat([{file:old.file,at:old.at,by:old.by,totals:old.totals}]);}ix.rosterPay[pkey]=rec;},"Workflow: roster pay sheet");return true;}});}

/* weekly T&E timesheet for one job from the week's rosters → goes to CM sign-off like an uploaded one */
async function roMakeTe(gfKey,ws,jobId,btn){const j=jobById(jobId);const days=roWeekDays(ws);const list=roWeek(gfKey,ws);const agg=roAggregate(list,days,jobId);
  if(!agg.labor.length){toast("No hours for "+j.name+" on this week's rosters.");return;}
  const noRole=agg.labor.filter(L=>!L.role);if(noRole.length){toast("Pick a classification for "+noRole.map(L=>L.name).join(", ")+" on the rosters.",8000);return;}
  const noItem=agg.equip.filter(E=>!E.items.length);if(noItem.length){toast("Match a rate item for "+noItem.map(E=>E.desc+(E.unitNo?" #"+E.unitNo:"")).join(", ")+" on the rosters.",8000);return;}
  const crews=list.flatMap(r=>(r.crews||[]).filter(c=>c.jobId===jobId));const foremen=[...new Set(list.filter(r=>(r.crews||[]).some(c=>c.jobId===jobId)).map(r=>String((roNorm(r).foreman||{}).name||"").trim()).filter(Boolean))];
  const patch={kind:"te",weekly:true,jobId,poleId:"",poleText:"",weekStart:ws,weekEnd:days[5],days,workDate:ws,crew:foremen.join(", "),gf:roGfName(gfKey),wo:j.wo||"",fwo:"",notes:[...new Set(crews.map(c=>String(c.notes||"").trim()).filter(Boolean))].concat(list.filter(r=>r.weather&&(r.crews||[]).some(c=>c.jobId===jobId)).length?["Inclement Weather Day: "+list.filter(r=>r.weather&&(r.crews||[]).some(c=>c.jobId===jobId)).map(r=>roDay(r.date)).join(", ")]:[]).join(" | "),
    labor:agg.labor,equip:agg.equip,subs:[],imported:{fromRosters:true,rosterGf:gfKey,rosters:list.map(r=>r.id),town:j.town||""}};
  const sum=teWeekText(patch)+" · "+agg.labor.length+" people · "+fmtN(teHours(patch))+" labor hrs · "+agg.equip.length+" equipment";
  const ex=sheets().find(s=>isTe(s)&&s.jobId===jobId&&s.weekStart===ws&&s.imported&&s.imported.rosterGf===gfKey);
  if(btn)btn.disabled=true;
  if(ex){if(![ST.SUB,ST.RET].includes(ex.status)){toast(ex.no+" is already signed off and can't be replaced.",7000);return;}
    const ok=await commitDoc(ex.id,x=>{if(![ST.SUB,ST.RET].includes(x.status))throw new Error(x.no+" changed since you opened it.");const keep=new Map((x.labor||[]).map(L=>[L.name,[L.pdDays,L.lodgeNights]]));Object.assign(x,patch);x.labor.forEach(L=>{const k=keep.get(L.name);if(k){L.pdDays=k[0]||0;L.lodgeNights=k[1]||0;}});x.status=ST.SUB;x.submittedAt=new Date().toISOString();},"Updated from daily rosters and resubmitted: "+sum);
    if(ok){toast(ex.no+" updated from the rosters and sent to the CM",6000);refresh();}}
  else{patch.status=ST.SUB;patch.submittedAt=new Date().toISOString();const id=await createDoc("sheet",patch,"Created from daily rosters: "+sum);if(id){toast((S.docs.get(id)||{}).no+" created from the rosters and sent to the CM",6000);refresh();}}}

/* ---------- roster editor (full page) ---------- */
/* roster structure: General Foreman (top) → Foreman (oversees all crews) → crews, each with a Lead Lineman + crew members.
   Older rosters kept everyone in crew.workers; roNorm moves them into the slots the first time they are opened or counted. */
const RO_SLOT_ROLE={gf:"General Foreman",foreman:"Foreman",lead:"Lead/Head Lineman"};
function roNorm(d){if(!d||d._norm)return d;const crews=d.crews||(d.crews=[]);
  if(d.gf===undefined&&d.foreman===undefined){
    const take=(c,pred)=>{const i=(c.workers||[]).findIndex(pred);return i<0?null:c.workers.splice(i,1)[0];};
    let gf=null;for(const c of crews){gf=take(c,w=>w.role==="General Foreman");if(gf)break;}
    let fm=null;for(const c of crews){if(c.foreman){fm=take(c,w=>w.name===c.foreman);if(fm)break;}}
    if(!fm)for(const c of crews){fm=take(c,w=>w.role==="Foreman");if(fm)break;}
    d.gf=gf;d.foreman=fm;}
  crews.forEach(c=>{c.workers=c.workers||[];c.equip=c.equip||[];if(c.lead===undefined){const i=c.workers.findIndex(w=>w.role==="Lead/Head Lineman");c.lead=i<0?null:c.workers.splice(i,1)[0];}delete c.foreman;});
  Object.defineProperty(d,"_norm",{value:true,enumerable:false,configurable:true});return d;}
function roPeople(r,jobId){roNorm(r);const out=[];const supJob=(r.crews||[]).map(c=>c.jobId).find(Boolean)||"";
  if(jobId==null||supJob===jobId){if(r.gf&&r.gf.name)out.push(r.gf);if(r.foreman&&r.foreman.name)out.push(r.foreman);}
  (r.crews||[]).forEach(c=>{if(jobId!=null&&c.jobId!==jobId)return;if(c.lead&&c.lead.name)out.push(c.lead);(c.workers||[]).forEach(w=>out.push(w));});return out;}
const roNewCrew=()=>({id:newId("c-"),lead:null,jobId:"",notes:"",workers:[],equip:[]});
function roPerson(name,role,D,src){const p=((S.index&&S.index.roster)||[]).find(x=>x.name.toLowerCase()===String(name).toLowerCase());return{pid:p?p.id:"",name:p?p.name:name,role,st:src?src.st:D.st,ot:src?src.ot:D.ot,dt:src?src.dt:D.dt};}
function renderRoster(){
  const key=S.docId;let st=S.rEdit&&S.rEdit.key===key?S.rEdit:null;
  if(!st){let doc,id=null;
    if(key.indexOf("new-")===0){const [date,gk]=key.slice(4).split("~");const gfKey=gk||S.myKey;const ex=roOf(gfKey,date);if(ex){location.replace("#roster-"+ex.id);return;}
      if(!canRoEdit(gfKey)){main.innerHTML='<div class="empty"><b>Not available</b></div>';return;}
      const gn=roGfName(gfKey);doc={type:"roster",date,gfKey,gfName:gn,gf:roPerson(gn,"General Foreman",RO_DEF),foreman:null,crews:[roNewCrew()],notes:""};}
    else{const d=S.docs.get(key);if(!d||d.type!=="roster"){main.innerHTML='<a class="back" href="#'+(role()==="crew"?"sheets":"rosters")+'">← Back</a><div class="empty"><b>Roster not found</b></div>';return;}
      if(role()==="crew"&&d.gfKey!==S.myKey){location.hash="sheets";return;}id=key;doc=roNorm(JSON.parse(JSON.stringify(d)));}
    st=S.rEdit={key,id,doc,dirty:false};}
  const d=roNorm(st.doc);const ed=canRoEdit(d.gfKey);const back=role()==="crew"?"#sheets":"#rosters";
  const prevs=rosters().filter(r=>r.gfKey===d.gfKey&&r.date<d.date).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,30);
  const empty=!d.foreman&&!d.crews.some(c=>c.lead||c.workers.length||c.equip.length);const showStart=ed&&!st.id&&!st.started&&empty;
  const tj=jobs().filter(j=>!j.archived&&isTeJob(j));
  const used=new Set(roPeople(d).map(w=>w.name.toLowerCase()));
  const names=[...new Set(((S.index&&S.index.roster)||[]).map(p=>p.name).concat(roPeople(d).map(w=>w.name)))].sort((a,b)=>a.localeCompare(b));
  const pick=(slot,cur,lab)=>'<select data-pick="'+slot+'" aria-label="'+lab+'"'+(ed?"":" disabled")+'><option value="">— pick —</option>'+names.filter(n=>n===cur||!used.has(n.toLowerCase())).map(n=>"<option"+(n===cur?" selected":"")+">"+esc(n)+"</option>").join("")+"</select>";
  const hIn=(slot,k,v,lab)=>'<input type="number" min="0" max="24" step="0.5" inputmode="decimal" data-slot="'+slot+'" data-h="'+k+'" value="'+esc(v)+'" aria-label="'+lab+'"'+(ed?"":" disabled")+">";
  const tot=w=>fmtN(roNum(w.st)+roNum(w.ot)+roNum(w.dt));
  const leadRow=(slot,title,w,note)=>"<tr><td class=\"ro-slot\"><b>"+title+"</b>"+(note?'<div class="sub">'+note+"</div>":"")+"</td><td>"+pick(slot,w&&w.name,title)+(w&&w.isNew?' <span class="chip c-sch">New</span>':"")+"</td>"+(w?"<td>"+hIn(slot,"st",w.st,"ST hours "+title)+"</td><td>"+hIn(slot,"ot",w.ot,"OT hours "+title)+"</td><td>"+hIn(slot,"dt",w.dt,"DT hours "+title)+'</td><td class="mono num" data-tot="'+slot+'">'+tot(w)+"</td>":'<td colspan="4" class="sub">Pick a name to add hours</td>')+"</tr>";
  const leadHead='<thead><tr><th>Role</th><th>Name</th><th class="num">ST</th><th class="num">OT</th><th class="num">DT</th><th class="num">Total</th></tr></thead>';
  main.innerHTML='<a class="back" href="'+back+'">← '+(role()==="crew"?"Overview":"Rosters")+"</a>"+
    '<section class="jobhead"><div><h1>Roster — '+esc(roDay(d.date))+(d.weather?" "+wxChip:"")+'</h1><div class="meta"><span>Created by General Foreman '+esc(d.gfName)+"</span>"+(st.id?"<span>Saved "+esc(fmtT((S.docs.get(st.id)||{}).updatedAt||""))+"</span>":'<span class="chip c-sch">Not saved yet</span>')+"</div></div>"+
      '<div class="acts">'+(ed&&st.id?'<button class="btn" type="button" id="ro-del">Delete roster</button>':"")+"</div></section>"+
    '<div class="ro-wx'+(d.weather?" on":"")+'"><label class="chk" style="margin:0"><input type="checkbox" id="ro-wx"'+(d.weather?" checked":"")+(ed?"":" disabled")+'> <b>Inclement Weather Day</b></label><span class="sub">'+(d.weather?"Everyone is paid 2 ST hours and equipment is at 0 hours. Logged as an Inclement Weather Day.":"Tick if the crew was sent home for weather: pay changes to 2 ST hours.")+"</span></div>"+
    (showStart?'<section class="ro-crew ro-start"><h2 class="sec" style="margin:0 0 8px">Start this roster</h2>'+
      (prevs.length?'<div class="row-inline" style="gap:8px;flex-wrap:wrap;align-items:flex-end"><label class="f" style="flex:1 1 300px;margin:0">Copy a previous roster<select id="ro-from">'+prevs.map(r=>{const c=roCounts(r);return'<option value="'+esc(r.id)+'">'+esc(roDay(r.date))+" — "+c.crews+" crew"+(c.crews===1?"":"s")+", "+c.people+" people, "+c.equip+" equipment"+(r.weather?" (weather day)":"")+"</option>";}).join("")+'</select></label><button class="btn primary" type="button" id="ro-use">Use this roster</button></div>':'<p class="sub" style="margin:0 0 6px">No earlier rosters to copy yet.</p>')+
      '<div class="ro-acts"><button class="btn" type="button" id="ro-fresh">Start fresh</button><span class="sub">Copied rosters keep the General Foreman, Foreman, crews, Lead Linemen, crew members and equipment; hours reset to '+(d.weather?"2 ST":"8 ST + 2 OT")+".</span></div></section>":"")+
    (showStart?"":
      '<section class="ro-crew ro-top"><h2 class="sec" style="margin:0 0 8px">Supervision</h2><div class="tablebox"><table class="static ro-t">'+leadHead+"<tbody>"+
        leadRow("gf","General Foreman",d.gf,"Creating this roster")+leadRow("foreman","Foreman",d.foreman,"Oversees all crews")+"</tbody></table></div></section>"+
      d.crews.map((c,ci)=>'<section class="ro-crew" data-ci="'+ci+'"><div class="ro-ch"><h2 class="sec" style="margin:0">Crew '+(ci+1)+(c.lead?" — "+esc(c.lead.name):"")+"</h2>"+(ed&&d.crews.length>1?'<button class="btn sm" type="button" data-rmcrew="'+ci+'">Remove crew</button>':"")+"</div>"+
        '<div class="tablebox"><table class="static ro-t">'+leadHead+"<tbody>"+leadRow("lead-"+ci,"Lead Lineman",c.lead,"Runs this crew")+"</tbody></table></div>"+
        '<div class="ro-fields" style="margin-top:8px"><label class="f">T&amp;E job (for billing)<select data-ci="'+ci+'" data-k="jobId"'+(ed?"":" disabled")+'><option value="">None — payroll only</option>'+tj.map(j=>'<option value="'+esc(j.id)+'"'+(j.id===c.jobId?" selected":"")+">"+esc(j.name)+"</option>").join("")+(c.jobId&&!tj.some(j=>j.id===c.jobId)?'<option value="'+esc(c.jobId)+'" selected>'+esc((jobById(c.jobId)||{name:"(removed job)"}).name)+"</option>":"")+"</select></label>"+
          '<label class="f wide">Notes<input data-ci="'+ci+'" data-k="notes" value="'+esc(c.notes||"")+'"'+(ed?"":" disabled")+"></label></div>"+
        '<h3 class="pv-h3">Crew members ('+c.workers.length+")</h3>"+
        (c.workers.length?'<div class="tablebox"><table class="static ro-t"><thead><tr><th>Name</th><th>Classification</th><th class="num">ST</th><th class="num">OT</th><th class="num">DT</th><th class="num">Total</th><th></th></tr></thead><tbody>'+
          c.workers.map((w,i)=>"<tr><td><b>"+esc(w.name)+"</b>"+(w.isNew?' <span class="chip c-sch">New</span>':"")+"</td><td>"+roleSelect(w.role,undefined,' data-ci="'+ci+'" data-wi="'+i+'" data-k="role" aria-label="Classification for '+esc(w.name)+'"'+(ed?"":" disabled"))+"</td><td>"+hIn("w-"+ci+"-"+i,"st",w.st,"ST hours "+esc(w.name))+"</td><td>"+hIn("w-"+ci+"-"+i,"ot",w.ot,"OT hours "+esc(w.name))+"</td><td>"+hIn("w-"+ci+"-"+i,"dt",w.dt,"DT hours "+esc(w.name))+'</td><td class="mono num" data-tot="w-'+ci+"-"+i+'">'+tot(w)+"</td><td>"+(ed?'<button class="btn sm" type="button" data-rmw="'+ci+"-"+i+'" aria-label="Remove '+esc(w.name)+'">✕</button>':"")+"</td></tr>").join("")+"</tbody></table></div>":'<p class="sub" style="margin:0">No crew members yet.</p>')+
        (ed?'<div class="ro-acts"><button class="btn" type="button" data-addw="'+ci+'">+ Add crew members</button>'+(c.workers.length||c.lead?'<button class="btn sm" type="button" data-def="'+ci+'">'+(d.weather?"Set crew to 2 ST":"Set crew to 8 ST + 2 OT")+"</button>":"")+"</div>":"")+
        '<h3 class="pv-h3">Equipment ('+c.equip.length+")</h3>"+
        (c.equip.length?'<div class="tablebox"><table class="static ro-t"><thead><tr><th>Equipment</th><th>Unit #</th><th>Rate item'+(c.jobId?"":' <span class="sub">(for T&amp;E billing)</span>')+'</th><th class="num">Hours</th><th></th></tr></thead><tbody>'+
          c.equip.map((e,i)=>"<tr><td><b>"+esc(e.desc)+"</b>"+(e.isNew?' <span class="chip c-sch">New</span>':"")+'</td><td class="mono">'+esc(e.unitNo||"")+'</td><td class="sub">'+(e.items&&e.items.length?esc(e.items.join(" + ")):'<span class="late">Not matched</span>')+'</td><td><input type="number" min="0" max="24" step="0.5" inputmode="decimal" data-ci="'+ci+'" data-ei="'+i+'" data-k="eh" value="'+esc(e.h)+'" aria-label="Hours for '+esc(e.desc)+'"'+(ed?"":" disabled")+"></td><td>"+(ed?'<button class="btn sm" type="button" data-rme="'+ci+"-"+i+'" aria-label="Remove '+esc(e.desc)+'">✕</button>':"")+"</td></tr>").join("")+"</tbody></table></div>":'<p class="sub" style="margin:0">No equipment yet.</p>')+
        (ed?'<div class="ro-acts"><button class="btn" type="button" data-adde="'+ci+'">+ Add equipment</button>'+(c.equip.length?'<button class="btn sm" type="button" data-defe="'+ci+'">Match equipment to crew hours</button>':"")+"</div>":"")+
      "</section>").join(""))+
    (ed&&!showStart?'<div class="ro-acts"><button class="btn" type="button" id="ro-addcrew">+ Add another crew</button></div>':"")+
    '<div class="row-inline ro-save"><span class="err" id="ro-err" role="alert" style="margin:0 auto 0 0"></span><a class="btn" href="'+back+'">'+(ed?"Cancel":"Close")+"</a>"+(ed?'<button class="btn primary" type="button" id="ro-save">Save roster</button>':"")+"</div>";
  if(!ed)return;
  const redraw=()=>{st.dirty=true;renderRoster();};
  const slotGet=s=>s==="gf"?d.gf:s==="foreman"?d.foreman:s.indexOf("lead-")===0?d.crews[+s.slice(5)].lead:(()=>{const [,ci,i]=s.split("-");return d.crews[+ci].workers[+i];})();
  const slotSet=(s,v)=>{if(s==="gf")d.gf=v;else if(s==="foreman")d.foreman=v;else if(s.indexOf("lead-")===0)d.crews[+s.slice(5)].lead=v;};
  main.querySelectorAll("[data-pick]").forEach(el=>el.onchange=()=>{const s=el.dataset.pick;const old=slotGet(s);const D=roDef(d);slotSet(s,el.value?roPerson(el.value,RO_SLOT_ROLE[s.split("-")[0]],D,old):null);redraw();});
  main.querySelectorAll("[data-k]").forEach(el=>{const ci=+el.dataset.ci,c=d.crews[ci];const ev=el.tagName==="SELECT"?"onchange":"oninput";
    el[ev]=()=>{st.dirty=true;const k=el.dataset.k;
      if(k==="role")c.workers[+el.dataset.wi].role=el.value;else if(k==="eh")c.equip[+el.dataset.ei].h=el.value;else c[k]=el.value;};});
  main.querySelectorAll("[data-h]").forEach(el=>{el.oninput=()=>{st.dirty=true;const w=slotGet(el.dataset.slot);if(!w)return;w[el.dataset.h]=el.value;const t=main.querySelector('[data-tot="'+el.dataset.slot+'"]');if(t)t.textContent=tot(w);};});
  main.querySelectorAll("[data-rmw]").forEach(b=>b.onclick=()=>{const [ci,i]=b.dataset.rmw.split("-").map(Number);d.crews[ci].workers.splice(i,1);redraw();});
  main.querySelectorAll("[data-rme]").forEach(b=>b.onclick=()=>{const [ci,i]=b.dataset.rme.split("-").map(Number);d.crews[ci].equip.splice(i,1);redraw();});
  main.querySelectorAll("[data-rmcrew]").forEach(b=>b.onclick=()=>{const c=d.crews[+b.dataset.rmcrew];if((c.lead||c.workers.length||c.equip.length)&&!confirm("Remove crew "+(+b.dataset.rmcrew+1)+" and everyone on it?"))return;d.crews.splice(+b.dataset.rmcrew,1);redraw();});
  main.querySelectorAll("[data-def]").forEach(b=>b.onclick=()=>{const D=roDef(d);const c=d.crews[+b.dataset.def];[c.lead].concat(c.workers).filter(Boolean).forEach(w=>{w.st=D.st;w.ot=D.ot;w.dt=D.dt;});redraw();});
  main.querySelectorAll("[data-defe]").forEach(b=>b.onclick=()=>{const c=d.crews[+b.dataset.defe];const hs=[c.lead].concat(c.workers).filter(Boolean).map(w=>roNum(w.st)+roNum(w.ot)+roNum(w.dt));const mx=hs.length?Math.max(...hs):RO_DEF.eq;c.equip.forEach(e=>{e.h=mx;});redraw();});
  main.querySelectorAll("[data-addw]").forEach(b=>b.onclick=()=>roPickWorkers(st,+b.dataset.addw,redraw));
  main.querySelectorAll("[data-adde]").forEach(b=>b.onclick=()=>roPickEquip(st,+b.dataset.adde,redraw));
  const ac=document.getElementById("ro-addcrew");if(ac)ac.onclick=()=>{d.crews.push(roNewCrew());redraw();};
  const applyHrs=()=>{const D=roDef(d);roPeople(d).forEach(w=>{w.st=D.st;w.ot=D.ot;w.dt=D.dt;});d.crews.forEach(c=>c.equip.forEach(e=>{e.h=D.eq;}));};
  const wx=document.getElementById("ro-wx");if(wx)wx.onchange=()=>{d.weather=wx.checked;applyHrs();redraw();toast(d.weather?"Inclement Weather Day: everyone set to 2 ST, equipment to 0 hours.":"Weather day removed: hours back to 8 ST + 2 OT, equipment 10.",5000);};
  const fr=document.getElementById("ro-fresh");if(fr)fr.onclick=()=>{st.started=true;redraw();};
  const us=document.getElementById("ro-use");if(us)us.onclick=()=>{const src=rosters().find(r=>r.id===document.getElementById("ro-from").value);if(!src)return;
    const cp=roNorm(JSON.parse(JSON.stringify(src)));const clean=w=>w?Object.assign(w,{isNew:false}):null;
    d.gf=clean(cp.gf)||d.gf;d.foreman=clean(cp.foreman);
    d.crews=(cp.crews||[]).map(c=>Object.assign(c,{id:newId("c-"),lead:clean(c.lead),workers:(c.workers||[]).map(clean),equip:(c.equip||[]).map(e=>Object.assign(e,{isNew:false}))}));
    if(!d.crews.length)d.crews=[roNewCrew()];applyHrs();st.started=true;redraw();
    toast("Copied from "+roDay(src.date)+": "+d.crews.length+" crew"+(d.crews.length===1?"":"s")+". Hours set to "+(d.weather?"2 ST":"8 ST + 2 OT")+".",5000);};
  const del=document.getElementById("ro-del");if(del)del.onclick=()=>{const pay=(S.index.rosterPay||{})[d.gfKey+"|"+weekMon(d.date)];
    confirmBox("Delete the roster for "+roDay(d.date)+"?",(pay?"The pay sheet already published for this week won't change until you republish it. ":"")+"This can't be undone.","Delete",async()=>{if(!canSave())return;
      await commitIndex(ix=>{delete ix.docs[st.id];},"Workflow: roster deleted");S.docs.delete(st.id);S.rEdit=null;toast("Roster deleted");location.hash=back.slice(1);},{danger:true});};
  document.getElementById("ro-save").onclick=async e=>{const err=document.getElementById("ro-err");err.textContent="";const b=e.target;
    try{const out=roValidate(d);if(!canSave())return;b.disabled=true;b.textContent="Saving…";
      const newPeople=[],newUnits=[];roPeople(d).forEach(w=>{if(w.isNew)newPeople.push({name:w.name,role:w.role});delete w.isNew;});d.crews.forEach(c=>c.equip.forEach(x=>{if(x.isNew)newUnits.push({desc:x.desc,unitNo:x.unitNo,items:x.items});delete x.isNew;}));
      if(newPeople.length||newUnits.length)await commitIndex(ix=>{ix.roster=ix.roster||[];newPeople.forEach(p=>{if(!ix.roster.some(x=>x.name.toLowerCase()===p.name.toLowerCase()))ix.roster.push({id:newId("w-"),name:p.name,role:p.role,addedBy:S.me.name,addedAt:new Date().toISOString()});});
        ix.equipUnits=ix.equipUnits||[];newUnits.forEach(u=>{if(!ix.equipUnits.some(x=>teNorm(x.desc)===teNorm(u.desc)&&String(x.unitNo)===String(u.unitNo)))ix.equipUnits.push({id:newId("u-"),desc:u.desc,unitNo:u.unitNo,items:u.items,addedBy:S.me.name,addedAt:new Date().toISOString()});});},"Workflow: roster people and equipment");
      const hist=(d.weather?"Inclement Weather Day · ":"")+"Roster saved: "+out;
      if(st.id){const ok=await commitDoc(st.id,x=>{x.gf=d.gf;x.foreman=d.foreman;x.crews=d.crews;x.notes=d.notes||"";x.weather=!!d.weather;},hist);if(!ok){b.disabled=false;b.textContent="Save roster";return;}}
      else{if(roOf(d.gfKey,d.date))throw new Error("A roster for "+roDay(d.date)+" was just saved by someone else. Reload and open it.");
        const doc={date:d.date,gfKey:d.gfKey,gfName:d.gfName,gf:d.gf,foreman:d.foreman,crews:d.crews,notes:d.notes||"",weather:!!d.weather};const id=await createDoc("roster",doc,hist);if(!id){b.disabled=false;b.textContent="Save roster";return;}}
      S.rEdit=null;toast("Roster saved for "+roDay(d.date),4000);location.hash=back.slice(1);}
    catch(x){err.textContent=x.message||String(x);b.disabled=false;b.textContent="Save roster";}};}
function roValidate(d){roNorm(d);
  if(!d.crews.length)throw new Error("Add a crew.");const seen=new Map();let ppl=0,hrs=0;
  if(!d.gf||!d.gf.name)throw new Error("Pick the General Foreman at the top.");
  if(!d.foreman||!d.foreman.name)throw new Error("Pick the Foreman who oversees the crews.");
  const check=(w,where)=>{const k=w.name.toLowerCase();if(seen.has(k))throw new Error(w.name+" is listed as "+seen.get(k)+" and "+where+". Put each person on the roster once per day.");seen.set(k,where);
    if(!w.role)throw new Error(where+": pick a classification for "+w.name+".");
    ["st","ot","dt"].forEach(h=>{const v=w[h];if(v!==""&&v!=null&&(!isFinite(Number(v))||Number(v)<0))throw new Error(where+": "+w.name+" "+h.toUpperCase()+" hours aren't a number.");});
    const t=roNum(w.st)+roNum(w.ot)+roNum(w.dt);if(t>24)throw new Error(where+": "+w.name+" has "+fmtN(t)+" hours. A day can't be more than 24.");ppl++;hrs+=t;
    w.st=roNum(w.st);w.ot=roNum(w.ot);w.dt=roNum(w.dt);};
  check(d.gf,"General Foreman");check(d.foreman,"Foreman");
  d.crews.forEach((c,ci)=>{const n="Crew "+(ci+1);if(!c.lead||!c.lead.name)throw new Error(n+": pick the Lead Lineman.");check(c.lead,n+" Lead Lineman");
    c.workers.forEach(w=>check(w,n));
    c.equip.forEach(e=>{const v=Number(e.h);if(!isFinite(v)||v<0||v>24)throw new Error(n+": "+e.desc+" hours must be 0–24.");e.h=v;
      if(c.jobId&&!(e.items||[]).length)throw new Error(n+": "+e.desc+(e.unitNo?" #"+e.unitNo:"")+" needs a rate item for T&E billing. Remove it and add it again with a rate item.");});});
  return d.crews.length+" crew(s) · "+ppl+" people · "+fmtN(hrs)+" labor hrs";}

function roPickWorkers(st,ci,done){const d=st.doc;const on=new Set(roPeople(d).map(w=>w.name.toLowerCase()));
  const list=roster().filter(p=>!on.has(p.name.toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name));
  const m=modal("Add crew members — crew "+(ci+1),'<input type="search" id="rw-q" placeholder="Search names…" aria-label="Search workers" style="width:100%;padding:8px 10px;border:1px solid var(--field);border-radius:6px">'+
    '<div class="ulist" id="rw-list" style="max-height:42vh;overflow:auto;margin-top:8px">'+(list.length?list.map(p=>'<label class="u" style="grid-template-columns:auto 1fr;cursor:pointer" data-hay="'+esc(p.name.toLowerCase())+'"><input type="checkbox" data-pid="'+esc(p.id)+'"><span><b>'+esc(p.name)+'</b> <span class="sub">'+esc(p.role||"No classification")+"</span></span></label>").join(""):'<p class="sub">Everyone on the company roster is already on this roster.</p>')+"</div>"+
    '<details style="margin-top:10px"><summary>Someone new (not on the list)</summary><div class="row-inline" style="gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:6px"><label class="f" style="flex:1 1 180px">Name<input id="rw-nn"></label><label class="f" style="flex:1 1 200px">Classification'+roleSelect("",undefined,' id="rw-nr"')+'</label></div><p class="sub" style="margin:4px 0 0">They are added to the company roster when you save.</p></details>'+
    '<p class="sub" style="margin:8px 0 0">Hours start at 8 ST + 2 OT. Change them on the roster.</p>',
    '<button class="btn" type="button" data-x>Cancel</button><button class="btn primary" type="button" id="rw-go">Add</button>');
  const q=m.querySelector("#rw-q");q.oninput=()=>{const v=q.value.trim().toLowerCase();m.querySelectorAll("#rw-list label").forEach(l=>{l.hidden=!!v&&l.dataset.hay.indexOf(v)<0;});};setTimeout(()=>q.focus(),50);
  m.querySelector("#rw-go").onclick=()=>{const msg=m.querySelector("[data-msg]");const c=d.crews[ci];const add=[];
    m.querySelectorAll("[data-pid]:checked").forEach(cb=>{const p=list.find(x=>x.id===cb.dataset.pid);const D=roDef(d);if(p)add.push({pid:p.id,name:p.name,role:p.role||"",st:D.st,ot:D.ot,dt:D.dt});});
    const nn=m.querySelector("#rw-nn").value.trim(),nr=m.querySelector("#rw-nr").value;
    if(nn){if(!nr){msg.textContent="Pick a classification for "+nn+".";return;}if(on.has(nn.toLowerCase())||add.some(a=>a.name.toLowerCase()===nn.toLowerCase())){msg.textContent=nn+" is already on this roster.";return;}
      const ex=((S.index&&S.index.roster)||[]).find(p=>p.name.toLowerCase()===nn.toLowerCase());const D2=roDef(d);add.push(ex?{pid:ex.id,name:ex.name,role:nr,st:D2.st,ot:D2.ot,dt:D2.dt}:{pid:"",name:nn,role:nr,st:D2.st,ot:D2.ot,dt:D2.dt,isNew:true});}
    if(!add.length){msg.textContent="Tick at least one person, or enter someone new.";return;}
    c.workers.push(...add);
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
    m.querySelectorAll("[data-ui]:checked").forEach(cb=>{const u=list[+cb.dataset.ui];add.push({desc:u.desc,unitNo:u.unitNo,items:u.items.slice(),h:roDef(d).eq});});
    const nd=m.querySelector("#re-nd").value.trim(),nu=m.querySelector("#re-nu").value.trim();const i1=m.querySelector("#re-i1 select").value,i2=m.querySelector("#re-i2 select").value;
    if(nd){const k=teNorm(nd)+"#"+nu;if(on.has(k)||add.some(a=>teNorm(a.desc)+"#"+a.unitNo===k)){msg.textContent=nd+(nu?" #"+nu:"")+" is already on this roster.";return;}
      const al=((S.index&&S.index.teAlias&&S.index.teAlias.equip)||{})[teNorm(nd)]||[];const items=[i1,i2].filter(Boolean);
      add.push({desc:nd,unitNo:nu,items:items.length?items:al.slice(),h:roDef(d).eq,isNew:true});}
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
    (list.length?list.map(r=>'<section class="ro-crew"><div class="ro-ch"><h2 class="sec" style="margin:0">'+esc(r.gfName)+(r.weather?" "+wxChip:"")+'</h2><button class="btn sm" type="button" data-open="'+esc(r.id)+'">'+(canRoEdit(r.gfKey)?"Open / edit":"Open")+"</button></div>"+
      (roNorm(r),"")+'<p style="margin:0 0 6px"><b>General Foreman:</b> '+esc((r.gf||{}).name||"—")+(r.gf?' <span class="sub">('+fmtN(r.gf.st)+" ST / "+fmtN(r.gf.ot)+" OT / "+fmtN(r.gf.dt)+" DT)</span>":"")+' &nbsp; <b>Foreman:</b> '+esc((r.foreman||{}).name||"—")+(r.foreman?' <span class="sub">('+fmtN(r.foreman.st)+" ST / "+fmtN(r.foreman.ot)+" OT / "+fmtN(r.foreman.dt)+" DT)</span>":"")+"</p>"+
      (r.crews||[]).map((c,ci)=>{const j=c.jobId?jobById(c.jobId):null;
        return'<h3 class="pv-h3">Crew '+(ci+1)+(c.lead?" — Lead Lineman "+esc(c.lead.name):"")+(j?' · <span class="chip c-sch">'+esc(j.name)+" (T&amp;E)</span>":"")+"</h3>"+(c.notes?'<p class="sub" style="margin:0 0 6px">'+esc(c.notes)+"</p>":"")+
          '<div class="ro-two"><div class="tablebox"><table class="static"><thead><tr><th>Worker</th><th>Classification</th><th class="num">ST</th><th class="num">OT</th><th class="num">DT</th></tr></thead><tbody>'+(c.lead?[Object.assign({lead:1},c.lead)]:[]).concat(c.workers||[]).map(w=>"<tr><td><b>"+esc(w.name)+"</b></td><td>"+esc(w.role)+'</td><td class="mono num">'+fmtN(w.st)+'</td><td class="mono num">'+fmtN(w.ot)+'</td><td class="mono num">'+fmtN(w.dt)+"</td></tr>").join("")+"</tbody></table></div>"+
          '<div class="tablebox"><table class="static"><thead><tr><th>Equipment</th><th>Unit #</th><th class="num">Hours</th></tr></thead><tbody>'+((c.equip||[]).map(e=>"<tr><td>"+esc(e.desc)+'</td><td class="mono">'+esc(e.unitNo||"")+'</td><td class="mono num">'+fmtN(e.h)+"</td></tr>").join("")||'<tr><td colspan="3" class="sub">No equipment</td></tr>')+"</tbody></table></div></div>";}).join("")+"</section>").join("")
      :'<div class="empty"><b>No rosters for '+esc(roDay(day))+"</b>General Foremen create them from their home screen.</div>")+
    '<h2 class="sec">Week by General Foreman</h2><div id="rs-wk"></div>';
  main.querySelectorAll("[data-d]").forEach(b=>b.onclick=()=>{const n=+b.dataset.d;S.roDay=n?addDays(day,n):todayStr();renderRosters();});
  document.getElementById("rs-day").onchange=e=>{if(e.target.value){S.roDay=e.target.value;renderRosters();}};
  main.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>{location.hash="roster-"+b.dataset.open;});
  roAdminSection(document.getElementById("rs-wk"));}

/* Saved pay sheets built from daily rosters: GF home (own) and Payroll tab (all) */
function roPayList(host,gfKey){if(!host)return;
  const all=Object.values((S.index&&S.index.rosterPay)||{}).filter(r=>!gfKey||r.gfKey===gfKey).sort((a,b)=>String(b.weekStart).localeCompare(String(a.weekStart))||String(a.gfName).localeCompare(String(b.gfName)));
  const f=S.payF||(S.payF={q:""});
  const rows=()=>{const q=f.q.trim().toLowerCase();return all.filter(r=>!q||[r.gfName,fmtD(r.weekStart),r.file&&r.file.name].join(" ").toLowerCase().indexOf(q)>=0);};
  host.innerHTML='<h2 class="sec">Pay sheets</h2>'+(all.length>6?'<div class="filters"><input type="search" id="pl-q" placeholder="Search week or name…" aria-label="Search pay sheets" value="'+esc(f.q)+'"></div>':"")+
    '<div class="tablebox"><table><thead><tr><th class="nosort">Week</th>'+(gfKey?"":'<th class="nosort">General Foreman</th>')+'<th class="nosort">People</th><th class="nosort num">Hours</th><th class="nosort num">Total pay</th><th class="nosort num">Per diem</th><th class="nosort">Published</th><th class="nosort">File</th></tr></thead><tbody id="pl-b"></tbody></table></div>';
  const fill=()=>{const L=rows();const tb=host.querySelector("#pl-b");
    tb.innerHTML=L.map((r,i)=>{const t=r.totals||{};const k=all.indexOf(r);
      return"<tr><td><b>"+esc(fmtD(r.weekStart))+" – "+esc(fmtD(addDays(r.weekStart,5)))+"</b></td>"+(gfKey?"":"<td>"+esc(r.gfName||"")+"</td>")+'<td class="mono">'+((r.rows||[]).length)+'</td><td class="mono num">'+fmtN(t.hours||0)+'</td><td class="mono num">'+money(t.pay||0)+'</td><td class="mono num">'+money(t.perDiem||0)+'</td><td class="sub">'+esc(r.by)+"<br>"+esc(fmtT(r.at))+(r.older&&r.older.length?"<br>"+r.older.length+" earlier version"+(r.older.length===1?"":"s"):"")+'</td><td><button class="btn sm" type="button" data-pf="'+k+'">Download</button>'+
        (r.older&&r.older.length?'<details style="margin-top:4px"><summary class="sub">Earlier versions</summary>'+r.older.slice().reverse().map((o,j)=>'<div style="margin-top:4px"><button class="btn sm" type="button" data-po="'+k+"-"+(r.older.length-1-j)+'">'+esc(fmtT(o.at))+"</button> "+'<span class="sub">'+money((o.totals||{}).pay||0)+"</span></div>").join("")+"</details>":"")+"</td></tr>";}).join("")||
      '<tr><td colspan="'+(gfKey?7:8)+'"><div class="empty"><b>No pay sheets yet</b>Use "Create pay sheet for the week" on the daily rosters. Each one is saved here.</div></td></tr>';
    tb.querySelectorAll("[data-pf]").forEach(b=>b.onclick=()=>openPackage(all[+b.dataset.pf].file,b));
    tb.querySelectorAll("[data-po]").forEach(b=>b.onclick=()=>{const [k,j]=b.dataset.po.split("-").map(Number);openPackage(all[k].older[j].file,b);});};
  fill();const q=host.querySelector("#pl-q");if(q)q.oninput=()=>{f.q=q.value;fill();};}

/* ---------- Jobs / Paysheets / Shutdowns tabs (everyone) ---------- */
function renderJobsList(){const f=S.jlf||(S.jlf={q:"",st:"active",bill:""});const ss=sheets();
  main.innerHTML='<section class="jobhead"><div><h1>Jobs</h1><div class="meta"><span>Search every job and open it</span></div></div></section>'+
    '<div class="filters"><input type="search" id="jl-q" placeholder="Search job, WO, PO, town, CM, pole #, street…" aria-label="Search jobs" value="'+esc(f.q)+'">'+
    '<select id="jl-st" aria-label="Status"><option value="active"'+(f.st==="active"?" selected":"")+'>Active</option><option value="archived"'+(f.st==="archived"?" selected":"")+'>Archived</option><option value=""'+(f.st===""?" selected":"")+">All</option></select>"+
    '<select id="jl-bill" aria-label="Billing"><option value="">Units and T&amp;E</option><option value="units"'+(f.bill==="units"?" selected":"")+'>Units</option><option value="te"'+(f.bill==="te"?" selected":"")+">T&amp;E</option></select><span class=\"count\" id=\"jl-c\"></span></div>"+
    '<div class="tablebox"><table><thead><tr><th class="nosort">Job</th><th class="nosort">Billing</th><th class="nosort">WO / PO</th><th class="nosort">CM</th>'+(role()==="crew"?"":'<th class="nosort">GF</th>')+'<th class="nosort num">Locations</th><th class="nosort">Remaining</th><th class="nosort">Shutdown</th></tr></thead><tbody id="jl-b"></tbody></table></div>';
  const fill=()=>{const q=f.q.trim().toLowerCase();
    const L=jobs().filter(j=>!j.test&&(f.st===""||(f.st==="archived")===!!j.archived)&&(!f.bill||(f.bill==="te")===isTeJob(j))&&
      (!q||[j.name,j.wo,j.po,j.town,j.gf,j.customer,j.desc].concat((j.poles||[]).map(p=>p.esPole+" "+p.street+" "+(p.ticket||"")+" "+(p.woJob||""))).join(" ").toLowerCase().indexOf(q)>=0)).sort((a,b)=>a.name.localeCompare(b.name));
    document.getElementById("jl-c").textContent=L.length+" job"+(L.length===1?"":"s");
    const tb=document.getElementById("jl-b");
    tb.innerHTML=L.map(j=>{const st=jobStats(j,ss);return'<tr tabindex="0" data-id="'+esc(j.id)+'"><td><div class="job-name">'+esc(j.name)+'</div><div class="sub">'+esc([j.customer,j.town].filter(Boolean).join(" · "))+(j.archived?' <span class="chip">Archived</span>':"")+"</div></td><td>"+(isTeJob(j)?'<span class="chip c-sch">T&amp;E</span>':"Units")+'</td><td class="mono sub">'+esc([j.wo?"WO "+j.wo:"",j.po?"PO "+j.po:""].filter(Boolean).join(" · "))+"</td><td>"+esc(j.gf||"")+"</td>"+(role()==="crew"?"":"<td>"+(gfAssignedNames(j).length?esc(gfAssignedNames(j).join(", ")):'<span class="sub">None</span>')+"</td>")+'<td class="mono num">'+st.locs+"</td><td><b>"+remN(st)+" remaining</b><div class=\"sub\">"+esc(remSub(st))+"</div></td><td>"+(st.shut?'<span class="chip c-bad">'+st.shut+" shutdown</span>"+(st.shutNext?'<div class="sub">next '+esc(fmtD(st.shutNext))+"</div>":""):'<span class="sub">—</span>')+"</td></tr>";}).join("")||
      '<tr><td colspan="8"><div class="empty"><b>'+(role()==="crew"&&!jobs().length?"No jobs assigned to you yet":"No jobs match")+"</b>"+(role()==="crew"&&!jobs().length?"Your Construction Manager or the office assigns jobs to you.":"")+"</div></td></tr>";
    bindRows(tb,id=>location.hash="job-"+id);};
  fill();document.getElementById("jl-q").oninput=e=>{f.q=e.target.value;fill();};document.getElementById("jl-st").onchange=e=>{f.st=e.target.value;fill();};document.getElementById("jl-bill").onchange=e=>{f.bill=e.target.value;fill();};}

/* every saved pay sheet: built from daily rosters, or published from a T&E weekly timesheet */
function paysheetRecs(){const crew=role()==="crew";const out=[];
  Object.values((S.index&&S.index.rosterPay)||{}).forEach(r=>{if(crew&&r.gfKey!==S.myKey)return;out.push({kind:"Daily rosters",week:r.weekStart,who:r.gfName||"",rec:r,older:r.older||[]});});
  sheets().filter(s=>isTe(s)&&s.paySheet).forEach(s=>{if(crew&&s.createdByKey!==S.myKey)return;out.push({kind:"T&E timesheet "+s.no,week:s.weekStart,who:s.gf||s.createdBy||"",job:(jobById(s.jobId)||{}).name||"",rec:s.paySheet,older:[],sheet:s.id});});
  return out.sort((a,b)=>String(b.week).localeCompare(String(a.week))||a.who.localeCompare(b.who));}
function renderPaysheets(){const f=S.psf||(S.psf={q:""});const all=paysheetRecs();
  main.innerHTML='<section class="jobhead"><div><h1>Paysheets</h1><div class="meta"><span>'+(role()==="crew"?"Your saved pay sheets":"Every saved pay sheet")+" — newest week first</span></div></div></section>"+
    '<div class="filters"><input type="search" id="pf-q" placeholder="Search week, name, file, timesheet #…" aria-label="Search pay sheets" value="'+esc(f.q)+'"><span class="count" id="pf-c"></span></div>'+
    '<div class="tablebox"><table><thead><tr><th class="nosort">Week</th><th class="nosort">General Foreman</th><th class="nosort">Built from</th><th class="nosort num">People</th><th class="nosort num">Hours</th><th class="nosort num">Total pay (USD)</th><th class="nosort num">Per diem (USD)</th><th class="nosort">Published</th><th class="nosort">File</th></tr></thead><tbody id="pf-b"></tbody></table></div>';
  const fill=()=>{const q=f.q.trim().toLowerCase();const L=all.filter(x=>!q||[fmtD(x.week),x.week,x.who,x.kind,x.job,x.rec.file&&x.rec.file.name,x.rec.by].join(" ").toLowerCase().indexOf(q)>=0);
    document.getElementById("pf-c").textContent=L.length+" of "+all.length;const tb=document.getElementById("pf-b");
    tb.innerHTML=L.map(x=>{const t=x.rec.totals||{};const k=all.indexOf(x);
      return"<tr><td><b>"+esc(fmtD(x.week))+" – "+esc(fmtD(addDays(x.week,5)))+"</b></td><td>"+esc(x.who)+"</td><td>"+(x.sheet?'<a href="#sheet-'+esc(x.sheet)+'">'+esc(x.kind)+"</a>"+(x.job?'<div class="sub">'+esc(x.job)+"</div>":""):esc(x.kind))+'</td><td class="mono num">'+((x.rec.rows||[]).length)+'</td><td class="mono num">'+fmtN(t.hours||0)+'</td><td class="mono num">'+money(t.pay||0)+'</td><td class="mono num">'+money(t.perDiem||0)+'</td><td class="sub">'+esc(x.rec.by||"")+"<br>"+esc(fmtT(x.rec.at||""))+'</td><td><button class="btn sm" type="button" data-pf="'+k+'">Download</button>'+
        (x.older.length?'<details style="margin-top:4px"><summary class="sub">'+x.older.length+" earlier version"+(x.older.length===1?"":"s")+"</summary>"+x.older.map((o,j)=>({o,j})).reverse().map(({o,j})=>'<div style="margin-top:4px"><button class="btn sm" type="button" data-po="'+k+"-"+j+'">'+esc(fmtT(o.at))+'</button> <span class="sub">'+money((o.totals||{}).pay||0)+"</span></div>").join("")+"</details>":"")+"</td></tr>";}).join("")||
      '<tr><td colspan="9"><div class="empty"><b>'+(all.length?"No pay sheets match":"No pay sheets yet")+"</b>"+(all.length?"":"Pay sheets are saved here when they're created from the daily rosters or a T&amp;E timesheet.")+"</div></td></tr>";
    tb.querySelectorAll("[data-pf]").forEach(b=>b.onclick=()=>openPackage(all[+b.dataset.pf].rec.file,b));
    tb.querySelectorAll("[data-po]").forEach(b=>b.onclick=()=>{const [k,j]=b.dataset.po.split("-").map(Number);openPackage(all[k].older[j].file,b);});};
  fill();document.getElementById("pf-q").oninput=e=>{f.q=e.target.value;fill();};}

/* every location on shutdown, all jobs */
function renderShutdowns(){const f=S.sdf||(S.sdf={q:"",job:"",when:""});
  const all=[];jobs().filter(j=>!j.archived&&!j.test).forEach(j=>(j.poles||[]).forEach(p=>{if(sdOn(p))all.push({j,p});}));
  const today=todayStr();
  main.innerHTML='<section class="jobhead"><div><h1>Shutdowns</h1><div class="meta"><span>Every location on hold for a shutdown or a scheduled day, all jobs</span></div></div></section>'+
    '<section class="tiles">'+tile("On shutdown",all.length,all.length?[...new Set(all.map(x=>x.j.id))].length+" job(s)":"None",false)+tile("Scheduled",all.filter(x=>x.p.shutdown.date).length,"Have a date",false)+tile("No date yet",all.filter(x=>!x.p.shutdown.date).length,"Need a date",all.some(x=>!x.p.shutdown.date))+tile("Past due",all.filter(x=>x.p.shutdown.date&&x.p.shutdown.date<today).length,"Date has passed",all.some(x=>x.p.shutdown.date&&x.p.shutdown.date<today))+"</section>"+
    '<div class="filters"><input type="search" id="sd-q" placeholder="Search pole #, street, town, ticket…" aria-label="Search shutdowns" value="'+esc(f.q)+'"><select id="sd-job" aria-label="Job"><option value="">All jobs</option>'+[...new Map(all.map(x=>[x.j.id,x.j])).values()].map(j=>'<option value="'+esc(j.id)+'"'+(j.id===f.job?" selected":"")+">"+esc(j.name)+"</option>").join("")+'</select><select id="sd-when" aria-label="Date"><option value="">Any date</option><option value="none"'+(f.when==="none"?" selected":"")+'>No date yet</option><option value="past"'+(f.when==="past"?" selected":"")+'>Past due</option><option value="next7"'+(f.when==="next7"?" selected":"")+'>Next 7 days</option></select><span class="count" id="sd-c"></span><button class="btn" type="button" id="sd-csv">Export CSV</button></div>'+
    '<div class="tablebox"><table><thead><tr><th class="nosort">Scheduled date</th><th class="nosort">Job</th><th class="nosort">#</th><th class="nosort">Pole # / location</th><th class="nosort">Town</th><th class="nosort">Ticket / WO</th><th class="nosort">Shutdown</th><th class="nosort">Set by</th></tr></thead><tbody id="sd-b"></tbody></table></div>';
  const rows=()=>{const q=f.q.trim().toLowerCase();const n7=addDays(today,7);return all.filter(({j,p})=>(!f.job||j.id===f.job)&&(!f.when||(f.when==="none"?!p.shutdown.date:f.when==="past"?p.shutdown.date&&p.shutdown.date<today:p.shutdown.date&&p.shutdown.date>=today&&p.shutdown.date<=n7))&&
      (!q||[j.name,p.esPole,p.street,p.town,p.ticket,p.woJob,p.notes].join(" ").toLowerCase().indexOf(q)>=0)).sort((a,b)=>(a.p.shutdown.date||"9999").localeCompare(b.p.shutdown.date||"9999")||a.j.name.localeCompare(b.j.name)||(a.p.n||0)-(b.p.n||0));};
  const fill=()=>{const L=rows();document.getElementById("sd-c").textContent=L.length+" of "+all.length;const tb=document.getElementById("sd-b");
    tb.innerHTML=L.map(({j,p})=>{const d=p.shutdown.date;return'<tr tabindex="0" data-id="'+esc(j.id)+'" data-job="'+esc(j.id)+'"><td>'+(d?"<b"+(d<today?' class="late"':"")+">"+esc(fmtD(d))+"</b>":'<span class="chip c-req">No date</span>')+"</td><td>"+esc(j.name)+'</td><td class="mono">'+esc(p.n)+"</td><td><b>"+esc(p.esPole||"")+"</b> "+esc(p.street||"")+"</td><td>"+esc(p.town||"")+'</td><td class="mono sub">'+esc([p.ticket,p.woJob?"WO "+p.woJob:""].filter(Boolean).join(" · "))+"</td><td>"+shutCell(j,p)+'</td><td class="sub">'+esc(p.shutdown.by||"")+"<br>"+esc(fmtT(p.shutdown.at||""))+"</td></tr>";}).join("")||
      '<tr><td colspan="8"><div class="empty"><b>'+(all.length?"No shutdowns match":"No locations on shutdown")+"</b>"+(all.length?"":"Tick Shutdown on a location in any job and it shows up here.")+"</div></td></tr>";
    tb.querySelectorAll("tr[data-job]").forEach(tr=>{tr.querySelectorAll(".sd-cell").forEach(c=>{c.onclick=e=>e.stopPropagation();c.onkeydown=e=>e.stopPropagation();});
      const jid=tr.dataset.job;tr.querySelectorAll("[data-sd]").forEach(cb=>cb.onchange=()=>saveShut(jid,cb.dataset.sd,cb.checked?{on:true}:null,cb));
      tr.querySelectorAll("[data-sdd]").forEach(inp=>inp.onchange=()=>saveShut(jid,inp.dataset.sdd,{on:true,date:inp.value},inp));});
    bindRows(tb,id=>location.hash="job-"+id);};
  fill();document.getElementById("sd-q").oninput=e=>{f.q=e.target.value;fill();};document.getElementById("sd-job").onchange=e=>{f.job=e.target.value;fill();};document.getElementById("sd-when").onchange=e=>{f.when=e.target.value;fill();};
  document.getElementById("sd-csv").onclick=()=>{const L=[["Scheduled date","Job","#","Pole #","Street","Town","Ticket","WO","Set by","Set at"]].concat(rows().map(({j,p})=>[p.shutdown.date||"",j.name,p.n,p.esPole,p.street,p.town,p.ticket||"",p.woJob||"",p.shutdown.by||"",(p.shutdown.at||"").slice(0,10)]));
    download(new Blob(["﻿"+L.map(r=>r.map(v=>'"'+String(v==null?"":v).replace(/"/g,'""')+'"').join(",")).join("\r\n")],{type:"text/csv"}),"Shutdowns.csv");};}

/* ---------- Excel unit sheets: one row per location (template download + upload reader) ---------- */
const UX_FIELDS=[["ticket","Ticket ID"],["locno","Loc #"],["pole","Pole #"],["street","Location"],["date","Work date (MM/DD/YYYY)"],["crew","Crew / lead"],["wo","Work order #"],["fwo","Field work order #"],["awc","AWC"],["poleset","Pole set (Y/N)"],["notes","Notes / other work"]];
const uxNorm=s=>String(s==null?"":s).toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9.]+/g," ").replace(/\s+/g," ").trim();
const uxUnits=()=>CREW_SECTIONS.flatMap(([sec,items])=>items.map(([k,l])=>({key:k,sec,label:l,head:sec+" — "+l})));
function uxColName(i){let s="";i++;while(i>0){const m=(i-1)%26;s=String.fromCharCode(65+m)+s;i=Math.floor((i-1)/26);}return s;}
const uxEsc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
/* minimal .xlsx writer: rows = [[{v,s}|value]], styles: 0 normal, 1 header, 2 input, 3 key row, 4 title */
async function uxWriteXlsx(name,rows,o){const Z=window.JSZip;if(!Z)throw new Error("The spreadsheet tool didn't load. Refresh and try again.");const z=new Z();
  z.file("[Content_Types].xml",'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
  z.file("_rels/.rels",'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  z.file("xl/workbook.xml",'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="'+uxEsc(name)+'" sheetId="1" r:id="rId1"/></sheets></workbook>');
  z.file("xl/_rels/workbook.xml.rels",'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  z.file("xl/styles.xml",'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="4"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><sz val="8"/><color rgb="FF999999"/><name val="Arial"/></font><font><b/><sz val="13"/><color rgb="FF1F3864"/><name val="Arial"/></font></fonts>'+
    '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F3864"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF9DB"/></patternFill></fill></fills>'+
    '<borders count="2"><border/><border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>'+
    '<cellXfs count="5"><xf fontId="0" fillId="0" borderId="1" applyBorder="1"/><xf fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf><xf fontId="0" fillId="3" borderId="1" applyFill="1" applyBorder="1"/><xf fontId="2" fillId="0" borderId="0" applyFont="1"/><xf fontId="3" fillId="0" borderId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
  const xml=rows.map((r,ri)=>'<row r="'+(ri+1)+'"'+((o.hidden||[]).includes(ri+1)?' hidden="1"':"")+((o.heights||{})[ri+1]?' ht="'+o.heights[ri+1]+'" customHeight="1"':"")+">"+r.map((c,ci)=>{if(c==null)return"";const cell=typeof c==="object"?c:{v:c};const ref=uxColName(ci)+(ri+1);const s=cell.s!=null?' s="'+cell.s+'"':"";
    if(cell.v===""||cell.v==null)return'<c r="'+ref+'"'+s+"/>";return typeof cell.v==="number"?'<c r="'+ref+'"'+s+"><v>"+cell.v+"</v></c>":'<c r="'+ref+'"'+s+' t="inlineStr"><is><t xml:space="preserve">'+uxEsc(cell.v)+"</t></is></c>";}).join("")+"</row>").join("");
  const fz=o.freeze?'<sheetViews><sheetView workbookViewId="0"><pane xSplit="'+o.freeze.c+'" ySplit="'+o.freeze.r+'" topLeftCell="'+uxColName(o.freeze.c)+(o.freeze.r+1)+'" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>':"";
  const cols=o.widths?"<cols>"+o.widths.map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join("")+"</cols>":"";
  z.file("xl/worksheets/sheet1.xml",'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+fz+cols+"<sheetData>"+xml+"</sheetData></worksheet>");
  return z.generateAsync({type:"blob",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});}
async function downloadUnitXlsx(j,btn){try{if(btn)btn.disabled=true;const U=uxUnits();
  const locs=(j.poles||[]).slice().sort((a,b)=>(a.n||0)-(b.n||0));
  const rows=[[{v:"Unit sheets — "+j.name+" (one row per location). Fill in the yellow cells: work date, crew, quantities. Leave a row's quantities blank to skip it. Upload on the job page with Upload Unit Sheets.",s:4}],
    UX_FIELDS.map(f=>({v:f[0],s:3})).concat(U.map(u=>({v:u.key,s:3}))),
    UX_FIELDS.map(f=>({v:f[1],s:1})).concat(U.map(u=>({v:u.head,s:1})))];
  locs.forEach(p=>rows.push([p.ticket||"",p.n||"",p.esPole||"",[p.street,p.town].filter(Boolean).join(", "),{v:"",s:2},{v:"",s:2},p.woJob||j.wo||"",{v:"",s:2},{v:"",s:2},{v:"",s:2},{v:"",s:2}].map(v=>typeof v==="object"?v:{v,s:0}).concat(U.map(()=>({v:"",s:2})))));
  const blob=await uxWriteXlsx("Unit Sheets",rows,{hidden:[2],freeze:{r:3,c:4},heights:{3:54},widths:[10,6,12,28,13,16,12,12,10,9,28].concat(U.map(()=>13))});
  download(blob,j.name.replace(/[\\/:*?"<>|]+/g," ")+" Unit Sheets.xlsx");toast("Downloaded the Excel unit sheet: "+locs.length+" locations",4000);}
  catch(x){toast(errText(x),8000);}finally{if(btn)btn.disabled=false;}}
/* read a one-row-per-location workbook into the same entries the PDF reader gives */
async function readUnitXlsx(file){const T=await TMPL.tables(await file.arrayBuffer());const name=T.names.find(n=>/unit/i.test(n))||T.names[0];const g=await T.get(name);const U=uxUnits();
  const byLabel=new Map();U.forEach(u=>{[u.key,u.head,u.sec+" "+u.label,u.label,(unitInfo(u.key).workType||"")+" "+unitInfo(u.key).item,unitInfo(u.key).item].forEach(x=>{const k=uxNorm(x);if(k&&!byLabel.has(k))byLabel.set(k,u.key);});});
  const fieldOf=h=>{const s=uxNorm(h);if(!s)return null;const fk=UX_FIELDS.find(f=>f[0]===s);if(fk)return fk[0];
    if(/^ticket/.test(s))return"ticket";if(/^(loc|location) ?(#|no|number)?$/.test(s)&&!/street/.test(s)&&s!=="location")return"locno";if(/^(es )?pole ?(#|no|number)?$/.test(s))return"pole";if(/^(work )?date/.test(s))return"date";if(/crew|lead|foreman/.test(s))return"crew";
    if(/^(fwo|field work order)/.test(s))return"fwo";if(/^(wo|work order|job)/.test(s))return"wo";if(/^awc/.test(s))return"awc";if(/^pole set( y n)?$/.test(s))return"poleset";if(/^note/.test(s))return"notes";if(/street|address|^location$/.test(s))return"street";return null;};
  let keyRow=-1,headRow=-1;for(let i=0;i<Math.min(g.length,15);i++){const r=g[i].map(uxNorm);if(r.includes("ticket")&&r.includes("pole"))keyRow=i;else if(headRow<0&&r.some(c=>/^(es )?pole ?(#|no)?$/.test(c)||/^ticket/.test(c)))headRow=i;}
  if(keyRow<0&&headRow<0)throw new Error("Couldn't find the header row. The sheet needs a Pole # or Ticket ID column.");
  const hr=keyRow>=0?keyRow:headRow;const cols=[];const unknown=[];
  g[hr].forEach((h,ci)=>{const lab=keyRow>=0?(g[keyRow+1]||[])[ci]||h:h;const f=fieldOf(h);if(f){cols[ci]={f};return;}const k=byLabel.get(uxNorm(h));if(k){cols[ci]={k};return;}if(String(h||"").trim())unknown.push({ci,h:String(lab||h)});});
  const start=keyRow>=0?keyRow+2:hr+1;const sheets=[];const colWarn=[];
  for(let i=start;i<g.length;i++){const r=g[i];const v=f=>{const ci=cols.findIndex(c=>c&&c.f===f);return ci<0?"":r[ci];};
    const qty={},warn=[];let any=false;
    cols.forEach((c,ci)=>{if(!c||!c.k)return;const raw=r[ci];if(raw===""||raw==null)return;const n=Number(String(raw).replace(/[, ]/g,""));if(!isFinite(n)||n<0){warn.push(unitInfo(c.k).item+': "'+raw+'" isn’t a number.');return;}if(n>0){qty[c.k]=n;any=true;}});
    unknown.forEach(u=>{const raw=r[u.ci];if(raw!==""&&raw!=null&&Number(raw)>0){warn.push('Column "'+u.h+'" ('+raw+") isn’t a unit on the rate list — add the right unit by hand.");any=true;}});
    let d=v("date");if(typeof d==="number"&&d>20000&&d<80000){const dt=new Date(Math.round((d-25569)*86400000));d=String(dt.getUTCMonth()+1).padStart(2,"0")+"/"+String(dt.getUTCDate()).padStart(2,"0")+"/"+dt.getUTCFullYear();}
    else if(typeof d==="string"&&/^\d{4}-\d{2}-\d{2}/.test(d)){const [y,m,dd]=d.slice(0,10).split("-");d=m+"/"+dd+"/"+y;}
    const ps=uxNorm(v("poleset"));
    if(!any&&!String(v("crew")||"").trim()&&!d)continue;
    if(!any)continue;
    sheets.push({page:i+1,ticket:String(v("ticket")||"").trim().toUpperCase(),locNo:String(v("locno")||"").trim(),pole:String(v("pole")||"").trim()+" "+String(v("street")||""),date:String(d||"").trim(),crew:String(v("crew")||"").trim(),wo:String(v("wo")||"").trim(),fwo:String(v("fwo")||"").trim(),awc:String(v("awc")||"").trim(),
      poleSet:/^(y|yes|x|1|true)$/.test(ps)?"yes":/^(n|no|0|false)$/.test(ps)?"no":"",notes:String(v("notes")||"").trim(),qty,others:[],warn});}
  return{sheets,excel:true,tab:name};}
