/* ---------- T&E (time & equipment) billing ----------
   A T&E job bills the crew and equipment used each day instead of units. Each day is one T&E timesheet
   (a "sheet" record with kind "te") that follows the same path as a unit sheet: General Foreman submits,
   the Construction Manager signs, it goes to Ready to bill, onto an invoice, and counts in the UBL.
   Rates come from the Eversource MSA Exhibit B rate sheet (Labor Pricing + Equipment Pricing tabs):
   labor by service area and year (straight / over / double time), equipment by year (hourly / daily / monthly).
   Per diem, lodging and the subcontractor markup are not on that sheet; billing enters them on the Rates tab.
   Amounts are unrounded until the final total, the same as unit billing. */
const isTe=d=>!!d&&d.kind==="te";
const isTeJob=j=>!!j&&j.billing==="te";
/* T&E pricing sets: one per contract (e.g. "2026–2028 T&E pricing"); each job picks one. A single sheet loaded before sets existed is shown as a set. */
function teSets(){const ix=S.index||{};const out=(ix.teRateSets||[]).slice();if(ix.teRates)out.push(Object.assign({id:"legacy",name:teSetName(ix.teRates.years)},ix.teRates));return out;}
const teSetById=id=>teSets().find(x=>x.id===id)||null;
const teJobSet=j=>j?teSetById(j.teSet):null;
/* labor rates the same in every service area for every classification and year → jobs on this pricing don't need an area */
function teAreaFree(set){if(!set)return true;const m=new Map();for(const x of set.labor){const k=x.year+"|"+x.role,v=[x.st,x.ot,x.dt].join(",");if(m.has(k)&&m.get(k)!==v)return false;m.set(k,v);}return true;}
const teJobArea=(j,set)=>set?((j&&j.teArea&&set.areas.includes(j.teArea))?j.teArea:(teAreaFree(set)?set.areas[0]:"")):"";
const roster=()=>((S.index&&S.index.roster)||[]).filter(p=>!p.inactive);
const TE_HRS=[["st","ST","Straight time"],["ot","OT","Overtime"],["dt","DT","Double time"]];
const TE_BASIS=[["hour","Hours","hourly"],["day","Days","daily"],["month","Months","monthly"]];
const yearOf=d=>{const m=/^(\d{4})-/.exec(d||"");return m?+m[1]:null;};
const teHours=d=>(d.labor||[]).reduce((a,L)=>a+TE_HRS.reduce((x,[k])=>x+(Number(L[k])||0),0),0);
function teSummary(d){const n=(d.labor||[]).length,e=(d.equip||[]).length;return n+" people · "+fmtN(teHours(d))+" hrs"+(e?" · "+e+" equipment":"");}
function teRoleNames(set){const out=[];(set?[set]:teSets()).forEach(r=>r.labor.forEach(x=>{if(!out.some(o=>o.role===x.role))out.push({role:x.role,group:x.group});}));return out;}
function teEquipNames(set){const out=[];(set?[set]:teSets()).forEach(r=>r.equipment.forEach(x=>{if(!out.some(o=>o.item===x.item))out.push({item:x.item,category:x.category});}));return out;}
/* a T&E location is Complete once a CM-signed timesheet for it is marked "Location complete" */
function teLocStatus(sh){if(!sh.length)return["Not started","c-stage"];const signed=x=>isReady(x)||x.status===ST.INV;
  if(sh.some(x=>x.locComplete&&signed(x)))return["Complete","c-done"];if(sh.some(x=>x.status===ST.RET))return["Returned to field","c-bad"];
  if(sh.some(x=>x.locComplete&&x.status===ST.SUB))return["Complete — awaiting CM","c-sch"];return["In progress","c-sch"];}
const teLocSheets=(jobId,poleId,exceptId)=>sheets().filter(x=>isTe(x)&&x.jobId===jobId&&x.poleId===poleId&&x.id!==exceptId);
function lastTe(jobId,beforeId){return sheets().filter(s=>isTe(s)&&s.jobId===jobId&&s.id!==beforeId).sort((a,b)=>String(b.workDate||"").localeCompare(String(a.workDate||""))||String(b.createdAt||"").localeCompare(String(a.createdAt||"")))[0]||null;}

/* ---------- pricing ---------- */
function priceTe(d){
  const j=jobById(d.jobId),r=teJobSet(j),area=teJobArea(j,r),yr=yearOf(d.workDate);const errs=[],lines=[];
  if(!r)errs.push(j&&j.teSet?"The job's T&E pricing was removed (Edit job)":"No T&E pricing picked on the job (Edit job)");
  else if(!area)errs.push(r.name+" differs by service area; pick the job's service area (Edit job)");
  if(!yr)errs.push("No work date, so no rate year");else if(r&&!r.years.includes(yr))errs.push(r.name+" has no "+yr+" rates");
  const ok=!!(r&&area&&yr&&r.years.includes(yr));
  (d.labor||[]).forEach(L=>{const rr=ok?r.labor.find(x=>x.area===area&&x.year===yr&&x.role===L.role):null;
    if(ok&&!rr)errs.push(L.role+" has no "+yr+" rate in "+r.name+(teAreaFree(r)?"":" for "+area));
    TE_HRS.forEach(([k,ab])=>{const q=Number(L[k])||0;if(!q)return;const rate=rr&&rr[k]!=null?rr[k]:null;if(rr&&rate==null)errs.push(L.role+" has no "+ab+" rate");
      lines.push({cat:"Labor",item:L.role,who:L.name,type:ab,qty:q,unit:"hr",rate,ext:rate==null?null:q*rate});});});
  (d.equip||[]).forEach(E=>{const b=TE_BASIS.find(x=>x[0]===E.basis)||TE_BASIS[0];const er=ok?r.equipment.find(x=>x.year===yr&&x.item===E.item):null;const rate=er&&er[b[2]]!=null?er[b[2]]:null;
    if(ok&&rate==null)errs.push(E.item+" has no "+yr+" "+b[2]+" rate");const q=Number(E.qty)||0;
    lines.push({cat:"Equipment",item:E.item,who:"",type:b[1],qty:q,unit:b[0],rate,ext:rate==null?null:q*rate});});
  const pd=(d.labor||[]).filter(L=>L.pd).length,lo=(d.labor||[]).filter(L=>L.lodge).length;
  if(pd){const rate=r&&r.perDiem!=null?r.perDiem:null;if(rate==null)errs.push("Per diem rate isn't set (Rates tab)");lines.push({cat:"Per diem",item:"Per diem",who:"",type:"Person-days",qty:pd,unit:"day",rate,ext:rate==null?null:pd*rate});}
  if(lo){const rate=r&&r.lodging!=null?r.lodging:null;if(rate==null)errs.push("Lodging rate isn't set (Rates tab)");lines.push({cat:"Lodging",item:"Lodging",who:"",type:"Person-nights",qty:lo,unit:"night",rate,ext:rate==null?null:lo*rate});}
  (d.subs||[]).forEach(s=>{const amt=Number(s.amount)||0;const mk=r&&r.subMarkup!=null?r.subMarkup:null;
    lines.push({cat:"Subcontractor",item:s.vendor+(s.desc?" — "+s.desc:""),who:"",type:"Cost",qty:1,unit:"ls",rate:amt,ext:amt});
    if(mk==null)errs.push("Subcontractor markup isn't set (Rates tab)");else lines.push({cat:"Subcontractor",item:"Markup "+fmtN(mk)+"% — "+s.vendor,who:"",type:"Markup",qty:1,unit:"ls",rate:amt*mk/100,ext:amt*mk/100});});
  const total=errs.length?null:lines.reduce((a,l)=>a+l.ext,0);
  const label=r?r.name+(yr?" · "+yr+" rates":"")+(r&&area&&!teAreaFree(r)?" · "+area:""):"";
  return{lines,total,area,year:yr,label,set:r,errs:[...new Set(errs)],job:j,pole:null,te:true};}

/* ---------- rate sheet reader (Eversource MSA Exhibit B: Labor Pricing + Equipment Pricing) ---------- */
async function parseTeRateBook(book){
  const ln=book.names.find(n=>/labor\s*pricing/i.test(n)),en=book.names.find(n=>/equipment\s*pricing/i.test(n));
  if(!ln||!en)throw new Error('This file needs "Labor Pricing" and "Equipment Pricing" tabs (the Eversource MSA Exhibit B rate sheet).');
  const L=await book.get(ln),E=await book.get(en);
  const s=v=>String(v==null?"":v).replace(/\s+/g," ").trim();
  const num=v=>{if(typeof v==="number")return isFinite(v)&&v>0?v:null;const t=s(v).replace(/[$,\s]/g,"");return /^\d+(\.\d+)?$/.test(t)&&+t>0?+t:null;};
  const yearNear=(row,c)=>{for(let k=c;k<Math.min(row.length,c+6);k++){const m=/\b(20\d\d)\b/.exec(s(row[k]));if(m)return+m[1];}return null;};
  const hdr=(row,from,to,re)=>{for(let k=from;k<to;k++)if(re.test(s(row[k])))return k;return-1;};
  const labor=[],areas=[],unpriced=[];
  const starts=[];L.forEach((row,r)=>{if(row.some(v=>/^Eversource Service Area$/i.test(s(v))))starts.push(r);});
  if(!starts.length)throw new Error("No service area blocks were found on the Labor Pricing tab.");
  starts.forEach((r0,bi)=>{const r1=bi+1<starts.length?starts[bi+1]:L.length;const row=L[r0];
    const c0=row.findIndex(v=>/^Eversource Service Area$/i.test(s(v)));const area=s(row.slice(c0+1).find(v=>s(v)));if(!area)return;areas.push(area);
    const term=L[r0+1]||[];const blocks=[];term.forEach((v,c)=>{if(/^Term:?$/i.test(s(v)))blocks.push({c,year:yearNear(term,c+1)});});
    blocks.forEach((b,i)=>{b.end=i+1<blocks.length?blocks[i+1].c:term.length+8;});
    let group="Salaried";const cols=blocks.map(()=>null);
    for(let r=r0+2;r<r1;r++){const rw=L[r]||[];
      blocks.forEach((b,i)=>{const name=s(rw[b.c]);
        if(/^(Salary|Trade|Other)$/i.test(name)){if(i===0)group=/salary/i.test(name)?"Salaried":"Craft";
          cols[i]={st:hdr(rw,b.c+1,b.end,/^straight time$/i),ot:hdr(rw,b.c+1,b.end,/^over ?time$/i),dt:hdr(rw,b.c+1,b.end,/^double ?time$/i),un:hdr(rw,b.c+1,b.end,/^union/i)};return;}
        if(!name||/^contractor/i.test(name)||!cols[i]||!b.year)return;
        const cc=cols[i];const st=cc.st>=0?num(rw[cc.st]):null;if(st==null){if(i===0)unpriced.push(name);return;}
        const un=cc.un>=0?s(rw[cc.un]):((blocks[0]&&cols[0]&&cols[0].un>=0)?s(rw[cols[0].un]):"");
        labor.push({area,year:b.year,group,role:name,union:un,st,ot:cc.ot>=0?num(rw[cc.ot]):null,dt:cc.dt>=0?num(rw[cc.dt]):null});});}});
  const equipment=[];const eunp=[];let blocks=[],cols=null,cat="";
  E.forEach(rw=>{const term=[];rw.forEach((v,c)=>{if(/^Term:?$/i.test(s(v)))term.push({c,year:yearNear(rw,c+1)});});
    if(term.length){blocks=term;blocks.forEach((b,i)=>{b.end=i+1<blocks.length?blocks[i+1].c:rw.length+8;});cols=null;return;}
    if(!blocks.length)return;
    if(blocks.some(b=>/^equipment$/i.test(s(rw[b.c])))){cols=blocks.map(b=>({h:hdr(rw,b.c+1,b.end,/^hourly$/i),d:hdr(rw,b.c+1,b.end,/^daily$/i),m:hdr(rw,b.c+1,b.end,/^monthly$/i)}));return;}
    if(!cols)return;
    const name0=s(rw[blocks[0].c]);if(!name0)return;
    const vals=blocks.map((b,i)=>({year:b.year,h:num(rw[cols[i].h]),d:num(rw[cols[i].d]),m:num(rw[cols[i].m])}));
    const anyText=blocks.some((b,i)=>[cols[i].h,cols[i].d,cols[i].m].some(c=>c>=0&&s(rw[c])));
    if(!anyText){cat=name0;return;}
    blocks.forEach((b,i)=>{const name=s(rw[b.c])||name0;const v=vals[i];if(!b.year)return;if(v.h==null&&v.d==null&&v.m==null){if(i===0)eunp.push(name);return;}
      equipment.push({year:b.year,category:cat,item:name,hourly:v.h,daily:v.d,monthly:v.m});});});
  if(!labor.length)throw new Error("No labor rates were found on the Labor Pricing tab.");
  if(!equipment.length)throw new Error("No equipment rates were found on the Equipment Pricing tab.");
  const years=[...new Set(labor.map(x=>x.year).concat(equipment.map(x=>x.year)))].sort();
  return{areas,years,labor,equipment,unpriced:[...new Set(unpriced)],equipUnpriced:[...new Set(eunp)]};}

/* ---------- Rates tab: T&E pricing sets (one per contract) ---------- */
function teRatesSection(host){
  const sets=teSets();const ed=canRates()&&S.canWrite;
  const st=S.teView||(S.teView={});if(!sets.some(x=>x.id===st.set))st.set=sets.length?sets[sets.length-1].id:"";
  const r=teSetById(st.set);
  if(r){if(!r.areas.includes(st.area))st.area=r.areas[0];if(!r.years.includes(+st.year))st.year=r.years.includes(new Date().getFullYear())?new Date().getFullYear():r.years[0];}
  const free=r&&teAreaFree(r);const used=r?jobs().filter(j=>j.teSet===r.id).length:0;
  host.innerHTML='<section class="jobhead" style="margin-top:22px"><div><h1 style="font-size:20px">T&amp;E pricing</h1><div class="meta">'+(sets.length?sets.length+" pricing set"+(sets.length===1?"":"s")+" loaded. Each T&amp;E job picks one.":"No T&amp;E pricing loaded yet")+'</div></div><div class="acts">'+(ed?'<button class="btn primary" type="button" id="te-new">Load new T&amp;E pricing</button>':"")+"</div></section>"+
    (r?'<div class="filters"><select id="te-set" aria-label="T&amp;E pricing set">'+sets.map(x=>'<option value="'+esc(x.id)+'"'+(x.id===r.id?" selected":"")+">"+esc(x.name)+"</option>").join("")+'</select>'+(ed?'<button class="btn" type="button" id="te-upd">Update this pricing from a new file</button><button class="btn" type="button" id="te-ren">Rename</button>':"")+"</div>"+
      '<div class="note">'+esc(r.name)+": "+esc(r.source.name)+" · loaded "+esc(fmtT(r.source.at))+" by "+esc(r.source.by)+" · years "+esc(r.years.join(", "))+" · "+r.areas.length+" service areas"+(free?" (labor rates are the same in every area, so jobs don't need a service area)":" (labor rates differ by area, so each job picks a service area)")+" · used by "+used+" job"+(used===1?"":"s")+". Labor and equipment bill at the rates for the year of each work date.</div>"+
      '<section class="details" style="display:block"><fieldset style="grid-template-columns:repeat(auto-fill,minmax(210px,1fr))"><legend>Set by billing for '+esc(r.name)+"</legend>"+
      '<label class="f" for="te-pd">Per diem (USD per person per day)<input id="te-pd" type="number" step="0.01" min="0" inputmode="decimal" value="'+esc(r.perDiem!=null?r.perDiem:"")+'"'+(ed?"":" disabled")+"></label>"+
      '<label class="f" for="te-lo">Lodging (USD per person per night)<input id="te-lo" type="number" step="0.01" min="0" inputmode="decimal" value="'+esc(r.lodging!=null?r.lodging:"")+'"'+(ed?"":" disabled")+"></label>"+
      '<label class="f" for="te-mk">Subcontractor markup (%)<input id="te-mk" type="number" step="0.01" min="0" inputmode="decimal" value="'+esc(r.subMarkup!=null?r.subMarkup:"")+'"'+(ed?"":" disabled")+"></label>"+
      (ed?'<div class="f" style="justify-content:flex-end"><button class="btn primary" type="button" id="te-save">Save</button></div>':"")+
      '</fieldset><p class="sub" style="margin:6px 0 0">These aren\'t on the Eversource rate sheet. Blank = not set; a timesheet that needs one can\'t be invoiced until it\'s entered. The rate sheet says combined subcontractor markup can\'t exceed 12%.</p></section>'+
      '<div class="filters" style="margin-top:12px">'+(free?"":'<select id="te-area" aria-label="Service area">'+r.areas.map(a=>"<option"+(a===st.area?" selected":"")+">"+esc(a)+"</option>").join("")+"</select>")+'<select id="te-year" aria-label="Rate year">'+r.years.map(y=>"<option"+(+y===+st.year?" selected":"")+">"+y+"</option>").join("")+'</select></div><div id="te-tbls"></div>'
     :'<div class="empty"><b>No T&amp;E pricing yet</b>Use Load new T&amp;E pricing and pick the Eversource MSA Exhibit B rate sheet (.xlsx).</div>');
  const on=(i,fn)=>{const b=document.getElementById(i);if(b)b.onclick=fn;};
  on("te-new",()=>openTeRateUpload(null));on("te-upd",()=>openTeRateUpload(r.id));
  on("te-ren",()=>{const n=prompt("Name for this T&E pricing",r.name);if(n==null||!n.trim()||n.trim()===r.name)return;if(sets.some(x=>x.id!==r.id&&x.name.toLowerCase()===n.trim().toLowerCase())){toast("Another pricing set already has that name.");return;}if(!canSave())return;
    commitIndex(ix=>{migrateTe(ix);const t=ix.teRateSets.find(x=>x.id===r.id);if(t)t.name=n.trim();},"Workflow: rename T&E pricing").then(()=>{refresh();toast("Renamed");}).catch(x=>toast(errText(x),8000));});
  if(!r)return;
  document.getElementById("te-set").onchange=e=>{st.set=e.target.value;refresh();};
  const sv=document.getElementById("te-save");if(sv)sv.onclick=e=>{const g=id=>{const v=document.getElementById(id).value.trim();if(v==="")return null;const n=Number(v);if(!isFinite(n)||n<0)throw new Error("Rates must be numbers of 0 or more.");return n;};
    let pd,lo,mk;try{pd=g("te-pd");lo=g("te-lo");mk=g("te-mk");}catch(x){toast(x.message);return;}
    if(mk!=null&&mk>12&&!confirm("A "+mk+"% markup is above the 12% cap stated on the rate sheet. Save anyway?"))return;
    if(!canSave())return;const b=e.target;b.disabled=true;b.textContent="Saving…";
    commitIndex(ix=>{migrateTe(ix);const o=ix.teRateSets.find(x=>x.id===r.id);if(!o)throw new Error("This pricing set was removed by someone else.");const ch=[];
      [["perDiem",pd,"per diem"],["lodging",lo,"lodging"],["subMarkup",mk,"sub markup"]].forEach(([k,v,l])=>{if((o[k]==null?null:o[k])!==v)ch.push(l+" "+(o[k]==null?"blank":o[k])+" → "+(v==null?"blank":v));o[k]=v;});
      (ix.rateLog=ix.rateLog||[]).push({t:new Date().toISOString(),by:S.me.name,name:o.name+": "+(ch.join("; ")||"no change")});},"Workflow: T&E per diem, lodging, markup")
      .then(()=>{refresh();toast("Saved for "+r.name);}).catch(x=>{toast(errText(x),8000);b.disabled=false;b.textContent="Save";});};
  const a=document.getElementById("te-area"),y=document.getElementById("te-year");if(a)a.onchange=()=>{st.area=a.value;draw();};y.onchange=()=>{st.year=+y.value;draw();};
  function draw(){const area=free?r.areas[0]:st.area;const lab=r.labor.filter(x=>x.area===area&&x.year===+st.year);const eq=r.equipment.filter(x=>x.year===+st.year);
    document.getElementById("te-tbls").innerHTML='<h2 class="sec">Labor — '+(free?"all service areas":esc(area))+" · "+esc(st.year)+' <span class="sub">(USD per hour)</span></h2><div class="tablebox"><table class="static"><thead><tr><th>Group</th><th>Classification</th>'+(free?"":"<th>Union</th>")+'<th class="num">Straight time</th><th class="num">Overtime</th><th class="num">Double time</th></tr></thead><tbody>'+
      lab.map(x=>"<tr><td>"+esc(x.group)+'</td><td class="wrapc"><b>'+esc(x.role)+"</b></td>"+(free?"":"<td>"+esc(x.union)+"</td>")+'<td class="mono num">'+money(x.st)+'</td><td class="mono num">'+(x.ot==null?'<span class="sub">—</span>':money(x.ot))+'</td><td class="mono num">'+(x.dt==null?'<span class="sub">—</span>':money(x.dt))+"</td></tr>").join("")+"</tbody></table></div>"+
      (r.unpriced&&r.unpriced.length?'<p class="sub">Not priced on the rate sheet (can\'t be billed): '+esc(r.unpriced.join(", "))+"</p>":"")+
      '<h2 class="sec">Equipment — '+esc(st.year)+' <span class="sub">(USD, all service areas)</span></h2><div class="tablebox"><table class="static"><thead><tr><th>Category</th><th>Equipment</th><th class="num">Hourly</th><th class="num">Daily</th><th class="num">Monthly</th></tr></thead><tbody>'+
      eq.map(x=>"<tr><td>"+esc(x.category)+'</td><td class="wrapc"><b>'+esc(x.item)+'</b></td><td class="mono num">'+money(x.hourly)+'</td><td class="mono num">'+money(x.daily)+'</td><td class="mono num">'+money(x.monthly)+"</td></tr>").join("")+"</tbody></table></div>"+
      (r.equipUnpriced&&r.equipUnpriced.length?'<p class="sub">'+r.equipUnpriced.length+" equipment lines on the rate sheet have no price and can't be billed.</p>":"");}
  draw();}
/* one-time move of a single loaded rate sheet (ix.teRates) into the list of pricing sets */
function migrateTe(ix){if(!ix.teRateSets)ix.teRateSets=[];if(ix.teRates){const o=ix.teRates;ix.teRateSets.push(Object.assign({id:newId("tp-"),name:teSetName(o.years)},o));delete ix.teRates;}}
const teSetName=years=>(years&&years.length?(years[0]===years[years.length-1]?years[0]:years[0]+"–"+years[years.length-1])+" ":"")+"T&E pricing";
function openTeRateUpload(replaceId){
  if(!canRates()||!canSave())return;const target=replaceId?teSetById(replaceId):null;
  const m=modal(target?"Update "+target.name:"Load new T&E pricing",'<p class="sub" style="margin:0">Choose the Eversource MSA Exhibit B rate sheet (.xlsx) with the Labor Pricing and Equipment Pricing tabs. '+(target?"The new rates replace this set's rates; jobs on it pick up the new rates for timesheets not yet invoiced. Per diem, lodging and markup stay as they are.":"It's added as a new pricing set that jobs can pick. Existing jobs keep the pricing they're on.")+'</p><label class="f" for="tr-file">Rate sheet<input type="file" id="tr-file" accept=".xlsx"></label>'+(target?"":'<label class="f" for="tr-name">Name<input id="tr-name" placeholder="e.g. 2026–2028 T&amp;E pricing"></label>')+'<div id="tr-prev"></div>',
    '<button class="btn" type="button" data-x>Cancel</button><button class="btn primary" type="button" id="tr-save" disabled>'+(target?"Update pricing":"Save T&amp;E pricing")+"</button>","wide");
  let parsed=null,name="";
  m.querySelector("#tr-file").onchange=async ev=>{const f=ev.target.files[0];if(!f)return;name=f.name;const pv=m.querySelector("#tr-prev");pv.innerHTML='<p class="sub">Reading…</p>';m.querySelector("#tr-save").disabled=true;
    try{parsed=await parseTeRateBook(await TMPL.tables(await f.arrayBuffer()));}catch(e){parsed=null;pv.innerHTML='<div class="err">'+esc(errText(e))+"</div>";return;}
    const nm=m.querySelector("#tr-name");if(nm&&!nm.value.trim())nm.value=teSetName(parsed.years);
    const old=target;const chg=[];
    if(old){const k=x=>x.area+"|"+x.year+"|"+x.role;const om=new Map(old.labor.map(x=>[k(x),x]));parsed.labor.forEach(x=>{const o=om.get(k(x));if(!o)chg.push([x.role+" · "+x.area+" · "+x.year,"new"]);else TE_HRS.forEach(([h,ab])=>{if(o[h]!==x[h])chg.push([x.role+" · "+x.area+" · "+x.year+" · "+ab,money(o[h])+" → "+money(x[h])]);});});
      const ke=x=>x.year+"|"+x.item;const oe=new Map(old.equipment.map(x=>[ke(x),x]));parsed.equipment.forEach(x=>{const o=oe.get(ke(x));if(!o)chg.push([x.item+" · "+x.year,"new"]);else TE_BASIS.forEach(([,,f])=>{if(o[f]!==x[f])chg.push([x.item+" · "+x.year+" · "+f,money(o[f])+" → "+money(x[f])]);});});}
    const odd=parsed.labor.filter(x=>x.ot!=null&&Math.abs(x.ot-x.st*1.5)>x.st*0.05);
    pv.innerHTML='<div class="okbox">'+parsed.areas.length+" service areas ("+esc(parsed.areas.join(", "))+") · years "+esc(parsed.years.join(", "))+" · "+parsed.labor.length+" labor rates · "+parsed.equipment.length+" equipment rates"+(teAreaFree(parsed)?" · labor rates are the same in every area":"")+"</div>"+
      (odd.length?'<div class="banner"><b>Check:</b> overtime isn\'t about 1.5× straight time for '+esc([...new Set(odd.map(x=>x.role+" "+x.year+" (ST "+x.st+", OT "+x.ot+")"))].join("; "))+". They load as written.</div>":"")+
      (parsed.unpriced.length?'<p class="sub" style="margin:6px 0">Labor with no price (can\'t be billed): '+esc(parsed.unpriced.join(", "))+"</p>":"")+
      (old?'<div class="sec-h" style="margin:10px 0 4px">Changes vs. current rates ('+chg.length+")</div>"+(chg.length?'<div class="tablebox" style="max-height:240px;overflow:auto"><table class="static"><tbody>'+chg.slice(0,400).map(c=>"<tr><td>"+esc(c[0])+'</td><td class="mono">'+esc(c[1])+"</td></tr>").join("")+"</tbody></table></div>":'<p class="sub" style="margin:0">No rate changes.</p>'):"");
    m.querySelector("#tr-save").disabled=false;};
  m.querySelector("#tr-save").onclick=e=>busyRun(e.target,m,async()=>{if(!parsed)return;
    const nm=m.querySelector("#tr-name");const nn=nm?nm.value.trim():"";if(!target&&!nn)throw new Error("Give this pricing a name.");
    if(!target&&teSets().some(x=>x.name.toLowerCase()===nn.toLowerCase()))throw new Error("A pricing set named "+nn+" already exists. Use Update on it, or pick another name.");
    const rates={areas:parsed.areas,years:parsed.years,labor:parsed.labor,equipment:parsed.equipment,unpriced:parsed.unpriced,equipUnpriced:parsed.equipUnpriced,source:{name,at:new Date().toISOString(),by:S.me.name}};
    let newId_="";
    await commitIndex(ix=>{migrateTe(ix);
      if(target){const t=ix.teRateSets.find(x=>x.id===target.id);if(!t)throw new Error("This pricing set was removed by someone else.");Object.assign(t,rates);newId_=t.id;}
      else{const t=Object.assign({id:newId("tp-"),name:nn,perDiem:null,lodging:null,subMarkup:null},rates);ix.teRateSets.push(t);newId_=t.id;}
      (ix.rateLog=ix.rateLog||[]).push({t:new Date().toISOString(),by:S.me.name,name:(target?"Updated ":"Loaded ")+(target?target.name:nn)+" from "+name});},"Workflow: T&E pricing");
    (S.teView=S.teView||{}).set=newId_;closeOverlay();refresh();toast(target?"Pricing updated":"T&E pricing saved: "+nn);});}

/* ---------- company crew roster ---------- */
function openRoster(){
  if(!can.setup()){canSave();return;}
  const rows=((S.index&&S.index.roster)||[]).map(p=>Object.assign({},p));const roles=teRoleNames();
  const m=modal("Crew roster",'<p class="sub" style="margin:0">Everyone who can be picked on a T&amp;E timesheet, company-wide. The default classification fills in when the person is added to a timesheet; it can be changed on the day.</p><div id="ro-rows" class="te-rows"></div><button class="btn" type="button" id="ro-add">+ Add person</button>',
    '<button class="btn" type="button" data-x>Cancel</button><button class="btn primary" type="button" id="ro-save">Save roster</button>',"wide");
  const box=m.querySelector("#ro-rows");
  function draw(){box.innerHTML=rows.length?rows.map((p,i)=>'<div class="te-row te-ro" data-i="'+i+'"><label class="f nm">Name<input data-k="name" value="'+esc(p.name)+'"></label><label class="f cl">Default classification'+roleSelect(p.role,roles)+'</label><label class="te-chk"><input type="checkbox" data-k="inactive"'+(p.inactive?" checked":"")+'>Inactive</label></div>').join(""):'<p class="sub" style="margin:0">No one on the roster yet.</p>';
    box.querySelectorAll(".te-row").forEach(row=>{const p=rows[+row.dataset.i];row.querySelectorAll("[data-k]").forEach(inp=>{inp[inp.type==="checkbox"||inp.tagName==="SELECT"?"onchange":"oninput"]=()=>{p[inp.dataset.k]=inp.type==="checkbox"?inp.checked:inp.value;};});const sel=row.querySelector("select");sel.dataset.k="role";sel.onchange=()=>{p.role=sel.value;};});}
  draw();m.querySelector("#ro-add").onclick=()=>{rows.push({id:newId("w-"),name:"",role:""});draw();const ins=box.querySelectorAll("input[data-k=name]");ins[ins.length-1].focus();};
  m.querySelector("#ro-save").onclick=e=>busyRun(e.target,m,async()=>{const keep=rows.filter(p=>String(p.name||"").trim());const seen=new Set();
    keep.forEach(p=>{p.name=p.name.trim();const k=p.name.toLowerCase();if(seen.has(k))throw new Error(p.name+" is on the roster twice.");seen.add(k);});if(!canSave())return;
    await commitIndex(ix=>{const cur=ix.roster||[];const byId=new Map(keep.map(p=>[p.id,p]));ix.roster=keep.concat(cur.filter(p=>!byId.has(p.id)&&!rows.some(r=>r.id===p.id)));},"Workflow: crew roster");
    closeOverlay();refresh();toast("Roster saved: "+keep.length+" people");});}
function roleSelect(val,roles,attrs){const rs=roles||teRoleNames();const groups=[...new Set(rs.map(r=>r.group))];
  return'<select'+(attrs||"")+'><option value="">Select…</option>'+groups.map(g=>'<optgroup label="'+esc(g)+'">'+rs.filter(r=>r.group===g).map(r=>"<option"+(r.role===val?" selected":"")+">"+esc(r.role)+"</option>").join("")+"</optgroup>").join("")+(val&&!rs.some(r=>r.role===val)?'<option selected>'+esc(val)+"</option>":"")+"</select>";}
function equipSelect(val,set){const es=teEquipNames(set||undefined);const cats=[...new Set(es.map(e=>e.category))];
  return'<select data-k="item"><option value="">Select equipment…</option>'+cats.map(c=>'<optgroup label="'+esc(c||"Other")+'">'+es.filter(e=>e.category===c).map(e=>"<option"+(e.item===val?" selected":"")+">"+esc(e.item)+"</option>").join("")+"</optgroup>").join("")+(val&&!es.some(e=>e.item===val)?'<option selected>'+esc(val)+"</option>":"")+"</select>";}

/* ---------- T&E daily timesheet form ---------- */
function teBlank(jid,pid){const j=jobById(jid);const prev=jid?lastTe(jid):null;const cp=x=>JSON.parse(JSON.stringify(x||[]));
  return{kind:"te",jobId:jid||"",poleId:pid||"",locComplete:false,photos:{},workDate:todayStr(),crew:prev?prev.crew:(role()==="crew"?S.me.name:""),wo:prev?prev.wo:(j?j.wo:""),notes:"",
    labor:prev?cp(prev.labor).map(L=>({pid:L.pid,name:L.name,role:L.role,st:L.st,ot:L.ot,dt:L.dt,pd:L.pd,lodge:L.lodge})):[],equip:prev?cp(prev.equip):[],subs:[],prefill:prev?{no:prev.no,date:prev.workDate}:null};}
function openTeForm(id,presetJob,presetPole){
  if(id==null&&!can.newSheet()){canSave();return;}
  const src=id?S.docs.get(id):null;
  const act=jobs().filter(j=>isTeJob(j)&&(!j.archived||(src&&j.id===src.jobId)));
  if(!act.length){toast(can.setup()?"Set up a T&E job first: Add Job → Billing type: T&E.":"No T&E jobs are set up yet. Ask billing to add the job.",7000);return;}
  if(!teSets().length){toast(can.setup()?"Load the T&E pricing first (Rates tab).":"T&E pricing hasn't been loaded yet. Ask billing.",7000);return;}
  let d=src?JSON.parse(JSON.stringify(src)):teBlank(presetJob&&act.some(j=>j.id===presetJob)?presetJob:(act.length===1?act[0].id:""),presetPole);
  d.labor=d.labor||[];d.equip=d.equip||[];d.subs=d.subs||[];
  const showSubs=can.seePrice();let scanFile=null;
  const body='<fieldset><legend>Timesheet</legend>'+
    '<label class="f" for="tf-date">Date<input type="date" id="tf-date" value="'+esc(d.workDate)+'"></label>'+
    '<label class="f" for="tf-crew">Crew lead<input id="tf-crew" value="'+esc(d.crew)+'"></label>'+
    '<label class="f" for="tf-wo">Work order #<input id="tf-wo" value="'+esc(d.wo)+'"></label>'+
    '<label class="f wide" for="tf-job">Job<select id="tf-job"><option value="">Select a T&amp;E job…</option>'+act.map(j=>'<option value="'+esc(j.id)+'"'+(j.id===d.jobId?" selected":"")+">"+esc(j.name)+"</option>").join("")+"</select></label>"+
    '<label class="f wide" for="tf-pq">Location — search street, pole # or ticket<input id="tf-pq" type="search" autocomplete="off" placeholder="e.g. Bent St, P43, PT4382921"></label>'+
    '<div class="wide polepick" id="tf-poles" role="listbox" aria-label="Locations on the job"></div>'+
    '<label class="f chk wide" for="tf-done"><input type="checkbox" id="tf-done"'+(d.locComplete?" checked":"")+'> <b>Location complete</b> — all work at this location is finished</label></fieldset>'+
    '<div id="tf-pre"></div>'+
    '<div><div class="sec-h">Crew <span class="sub" id="tf-hrs"></span></div><p class="sub" style="margin:-4px 0 8px">One row per person: classification and hours by type. Tick per diem and lodging where they apply.</p><div id="tf-lab" class="te-rows"></div><div class="row-inline" style="margin-top:8px"><button class="btn" type="button" id="tf-add-l">+ Add person</button><button class="btn" type="button" id="tf-fill8">Set everyone to 8 ST</button><button class="btn" type="button" id="tf-fill10">Set everyone to 10-hr day (8 ST + 2 OT)</button></div><p class="sub" style="margin:6px 0 0">Both buttons also set equipment billed by the hour to the same day length (8 or 10 hrs) and equipment billed by the day to 1. Monthly equipment stays as entered.</p><div></div></div>'+
    '<div><div class="sec-h">Equipment</div><p class="sub" style="margin:-4px 0 8px">Bill each piece by hours, days or months.</p><div id="tf-eq" class="te-rows"></div><button class="btn" type="button" id="tf-add-e" style="margin-top:8px">+ Add equipment</button></div>'+
    (showSubs?'<div><div class="sec-h">Subcontractors</div><p class="sub" style="margin:-4px 0 8px">Cost before markup, in USD. The markup from the Rates tab is added on the invoice.</p><div id="tf-sub" class="te-rows"></div><button class="btn" type="button" id="tf-add-s" style="margin-top:8px">+ Add subcontractor</button></div>':"")+
    '<div><div class="sec-h">Photos of the location</div><p class="sub" id="tf-phreq" style="margin:-4px 0 8px"></p>'+photoSlotsHtml("tf",false)+"</div>"+
    '<div><div class="sec-h">Paper timesheet (optional)</div><label class="f" for="tf-scan">Attach a photo or PDF of the signed paper sheet<input type="file" id="tf-scan" accept="application/pdf,image/*"></label>'+(d.scan?'<p class="sub" style="margin:4px 0 0">Attached: '+esc(d.scan.name)+" (choose a file to replace it)</p>":"")+"</div>"+
    '<label class="f wide" for="tf-notes">Notes<textarea id="tf-notes">'+esc(d.notes)+"</textarea></label>"+
    (can.seePrice()?'<div class="okbox" id="tf-tot"></div>':"");
  const m=modal(id?"Edit "+d.no:"T&E daily timesheet",body,'<button class="btn" type="button" data-x>Cancel</button><button class="btn primary" type="button" id="tf-save">'+(id?(d.status===ST.RET?"Save &amp; resubmit":"Save changes"):"Submit to CM")+"</button>","wide");
  const jsel=m.querySelector("#tf-job"),dsel=m.querySelector("#tf-date"),done=m.querySelector("#tf-done"),pq=m.querySelector("#tf-pq"),pbox=m.querySelector("#tf-poles");
  const slots={before:{meta:d.photos&&d.photos.before||null},after:{meta:d.photos&&d.photos.after||null}};bindPhotoSlots(m,slots);
  let selPole=d.poleId||"";
  const needs=()=>{const first=!selPole||!teLocSheets(jsel.value,selPole,id).length;return{before:first,after:done.checked};};
  function phreq(){const n=needs(),f=needPhotos();m.querySelector("#tf-phreq").textContent="Before photo: "+(n.before?(f?"required":"needed")+" (first timesheet at this location)":"optional")+" · After photo: "+(n.after?(f?"required":"needed")+" (location marked complete)":"optional until Location complete is ticked")+(f?"":" · required when a General Foreman submits");}
  function drawPoles(){const j=jobById(jsel.value);const ps=(j&&j.poles)||[];const q=pq.value.trim().toLowerCase();
    let list=ps.filter(p=>!q||[p.street,p.esPole,p.vzPole,p.ticket,p.town].join(" ").toLowerCase().indexOf(q)>=0);const sp=ps.find(p=>p.id===selPole);if(sp&&list.indexOf(sp)<0)list=[sp].concat(list);const lim=q?60:8;
    pbox.innerHTML=j?(ps.length?list.slice(0,lim).map(p=>{const stt=teLocStatus(teLocSheets(j.id,p.id,id));return'<button type="button" class="pp'+(p.id===selPole?" on":"")+'" data-p="'+esc(p.id)+'" role="option" aria-selected="'+(p.id===selPole)+'"><b>'+esc(p.street)+"</b> · "+esc(p.esPole)+'<span class="sub"> '+esc(p.ticket)+"</span>"+(stt[0]!=="Not started"?' <span class="chip '+stt[1]+'">'+esc(stt[0])+"</span>":"")+"</button>";}).join("")+(list.length>lim?'<span class="sub">Showing '+lim+" of "+list.length+" — type to narrow</span>":""):'<span class="sub">This job has no locations yet. Billing adds them with + Add locations.</span>'):'<span class="sub">Pick the job first.</span>';
    pbox.querySelectorAll("[data-p]").forEach(b=>b.onclick=()=>{selPole=b.dataset.p;drawPoles();phreq();});}
  pq.oninput=drawPoles;done.onchange=phreq;drawPoles();phreq();
  const rosterList=roster();const dl='<datalist id="tf-people">'+rosterList.map(p=>"<option>"+esc(p.name)+"</option>").join("")+"</datalist>";
  function pre(){const p=m.querySelector("#tf-pre");p.innerHTML=!id&&d.prefill?'<div class="note" style="margin:0">Pre-filled from '+esc(d.prefill.no)+" ("+esc(fmtD(d.prefill.date))+"). Check names, hours and equipment for today.</div>":"";}
  function tot(){const h=m.querySelector("#tf-hrs");h.textContent=d.labor.length?"· "+d.labor.length+" people · "+fmtN(teHours(d))+" hrs":"";
    const t=m.querySelector("#tf-tot");if(!t)return;const pr=priceTe(Object.assign({},d,{jobId:jsel.value,workDate:dsel.value,labor:d.labor.filter(L=>L.role),equip:d.equip.filter(E=>E.item)}));
    t.innerHTML=pr.total!=null?"Day total: <b>"+money(pr.total)+"</b> <span class=\"sub\">(Calculated from "+esc(pr.label)+")</span>":'<span class="sub">Day total shows once every line can be priced'+(pr.errs.length?": "+esc(pr.errs.slice(0,3).join("; ")):"")+"</span>";}
  function drawLab(){const box=m.querySelector("#tf-lab");
    box.innerHTML=(d.labor.length?d.labor.map((L,i)=>'<div class="te-row te-lab" data-i="'+i+'"><label class="f nm">Name<input data-k="name" list="tf-people" autocomplete="off" value="'+esc(L.name)+'"></label><label class="f cl">Classification'+roleSelect(L.role,teRoleNames(teJobSet(jobById(jsel.value))||undefined),' data-k="role"')+"</label>"+
      TE_HRS.map(([k,ab,lab])=>'<label class="f hr" title="'+lab+'">'+ab+'<input data-k="'+k+'" type="number" inputmode="decimal" step="0.25" min="0" max="24" value="'+esc(L[k]==null?"":L[k])+'"></label>').join("")+
      '<label class="te-chk"><input type="checkbox" data-k="pd"'+(L.pd?" checked":"")+'>Per diem</label><label class="te-chk"><input type="checkbox" data-k="lodge"'+(L.lodge?" checked":"")+'>Lodging</label><button class="btn sm danger" type="button" data-rm aria-label="Remove '+esc(L.name||"person")+'">✕</button></div>').join(""):'<p class="sub" style="margin:0">No one added yet.</p>')+dl;
    box.querySelectorAll(".te-row").forEach(row=>{const L=d.labor[+row.dataset.i];
      row.querySelectorAll("[data-k]").forEach(inp=>{const k=inp.dataset.k;inp[inp.type==="checkbox"||inp.tagName==="SELECT"?"onchange":"oninput"]=()=>{L[k]=inp.type==="checkbox"?inp.checked:inp.value;
        if(k==="name"){const p=rosterList.find(x=>x.name.toLowerCase()===inp.value.trim().toLowerCase());L.pid=p?p.id:"";if(p&&p.role&&!L.role){L.role=p.role;row.querySelector("select[data-k=role]").value=p.role;}}tot();};});
      row.querySelector("[data-rm]").onclick=()=>{d.labor.splice(+row.dataset.i,1);drawLab();};});tot();}
  function drawEq(){const box=m.querySelector("#tf-eq");
    box.innerHTML=d.equip.length?d.equip.map((E,i)=>'<div class="te-row te-eq" data-i="'+i+'"><label class="f it">Equipment'+equipSelect(E.item,teJobSet(jobById(jsel.value)))+'</label><label class="f">Bill by<select data-k="basis">'+TE_BASIS.map(([k,l])=>'<option value="'+k+'"'+((E.basis||"hour")===k?" selected":"")+">"+l+"</option>").join("")+'</select></label><label class="f hr">Qty<input data-k="qty" type="number" inputmode="decimal" step="0.25" min="0" value="'+esc(E.qty==null?"":E.qty)+'"></label><button class="btn sm danger" type="button" data-rm aria-label="Remove equipment">✕</button></div>').join(""):'<p class="sub" style="margin:0">No equipment added.</p>';
    box.querySelectorAll(".te-row").forEach(row=>{const E=d.equip[+row.dataset.i];row.querySelectorAll("[data-k]").forEach(inp=>{inp[inp.tagName==="SELECT"?"onchange":"oninput"]=()=>{E[inp.dataset.k]=inp.value;tot();};});row.querySelector("[data-rm]").onclick=()=>{d.equip.splice(+row.dataset.i,1);drawEq();};});tot();}
  function drawSub(){const box=m.querySelector("#tf-sub");if(!box)return;
    box.innerHTML=d.subs.length?d.subs.map((s,i)=>'<div class="te-row te-sub" data-i="'+i+'"><label class="f">Subcontractor<input data-k="vendor" value="'+esc(s.vendor)+'"></label><label class="f ds">Description<input data-k="desc" value="'+esc(s.desc)+'"></label><label class="f">Cost (USD)<input data-k="amount" type="number" inputmode="decimal" step="0.01" min="0" value="'+esc(s.amount==null?"":s.amount)+'"></label><button class="btn sm danger" type="button" data-rm aria-label="Remove subcontractor">✕</button></div>').join(""):'<p class="sub" style="margin:0">None.</p>';
    box.querySelectorAll(".te-row").forEach(row=>{const s=d.subs[+row.dataset.i];row.querySelectorAll("[data-k]").forEach(inp=>{inp.oninput=()=>{s[inp.dataset.k]=inp.value;tot();};});row.querySelector("[data-rm]").onclick=()=>{d.subs.splice(+row.dataset.i,1);drawSub();};});tot();}
  pre();drawLab();drawEq();drawSub();
  jsel.onchange=()=>{selPole="";drawPoles();phreq();if(!id){const keep={workDate:dsel.value};d=Object.assign(teBlank(jsel.value),keep);m.querySelector("#tf-crew").value=d.crew;m.querySelector("#tf-wo").value=d.wo;pre();drawLab();drawEq();drawSub();}else{d.jobId=jsel.value;tot();}};
  dsel.onchange=tot;
  m.querySelector("#tf-add-l").onclick=()=>{d.labor.push({pid:"",name:"",role:"",st:"",ot:"",dt:"",pd:false,lodge:false});drawLab();const ins=m.querySelectorAll("#tf-lab input[data-k=name]");ins[ins.length-1].focus();};
  const fillDay=(st,ot)=>{d.labor.forEach(L=>{L.st=st;L.ot=ot||"";L.dt="";});let eh=0,ed=0;d.equip.forEach(E=>{const b=E.basis||"hour";if(b==="hour"){E.qty=st+(ot||0);eh++;}else if(b==="day"){E.qty=1;ed++;}});drawLab();drawEq();
    toast(d.labor.length+" "+(d.labor.length===1?"person":"people")+" set to "+(st+(ot||0))+" hrs ("+st+" ST"+(ot?" + "+ot+" OT":"")+")"+(eh?" · "+eh+" hourly equipment set to "+(st+(ot||0))+" hrs":"")+(ed?" · "+ed+" daily equipment set to 1 day":""),5000);};
  m.querySelector("#tf-fill8").onclick=()=>fillDay(8,0);m.querySelector("#tf-fill10").onclick=()=>fillDay(8,2);
  m.querySelector("#tf-add-e").onclick=()=>{d.equip.push({item:"",basis:"hour",qty:""});drawEq();};
  const as=m.querySelector("#tf-add-s");if(as)as.onclick=()=>{d.subs.push({vendor:"",desc:"",amount:""});drawSub();};
  m.querySelector("#tf-scan").onchange=ev=>{scanFile=ev.target.files[0]||null;};
  m.querySelector("#tf-save").onclick=e=>busyRun(e.target,m,async()=>{
    const g=s=>m.querySelector(s).value.trim();
    const patch={kind:"te",jobId:jsel.value,workDate:g("#tf-date"),crew:g("#tf-crew"),wo:g("#tf-wo"),notes:m.querySelector("#tf-notes").value.trim(),poleId:selPole,poleText:"",locComplete:done.checked};
    if(!patch.jobId)throw new Error("Pick the job.");if(!patch.poleId)throw new Error("Pick the location this time was spent on.");if(!patch.workDate)throw new Error("Enter the date.");if(!patch.crew)throw new Error("Enter the crew lead.");
    const hn=v=>{if(v===""||v==null)return 0;const n=Number(v);if(!isFinite(n)||n<0)throw new Error("Hours and quantities must be numbers of 0 or more.");return n;};
    const seen=new Set();const labor=[];
    for(const L of d.labor){const name=String(L.name||"").trim();const h={st:hn(L.st),ot:hn(L.ot),dt:hn(L.dt)};
      if(!name&&!L.role&&!h.st&&!h.ot&&!h.dt)continue;
      if(!name)throw new Error("Enter the name for each crew row.");if(!L.role)throw new Error("Pick the classification for "+name+".");
      if(seen.has(name.toLowerCase()))throw new Error(name+" is on the timesheet twice.");seen.add(name.toLowerCase());
      const sum=h.st+h.ot+h.dt;if(!sum)throw new Error("Enter hours for "+name+", or remove the row.");if(sum>24)throw new Error(name+" has "+sum+" hours. A day can't be more than 24.");
      const p=roster().find(x=>x.name.toLowerCase()===name.toLowerCase());labor.push({pid:p?p.id:"",name,role:L.role,st:h.st,ot:h.ot,dt:h.dt,pd:!!L.pd,lodge:!!L.lodge});}
    if(!labor.length)throw new Error("Add at least one person with hours.");
    const equip=[];for(const E of d.equip){if(!E.item&&(E.qty===""||E.qty==null))continue;if(!E.item)throw new Error("Pick the equipment for each equipment row.");const q=hn(E.qty);if(!q)throw new Error(E.item+": enter a quantity greater than 0.");equip.push({item:E.item,basis:E.basis||"hour",qty:q});}
    const subs=[];if(showSubs)for(const s of d.subs){const v=String(s.vendor||"").trim();if(!v&&(s.amount===""||s.amount==null))continue;if(!v)throw new Error("Enter the subcontractor's name.");const a=hn(s.amount);if(!a)throw new Error(v+": enter the cost.");subs.push({vendor:v,desc:String(s.desc||"").trim(),amount:a});}
    Object.assign(patch,{labor,equip,subs:showSubs?subs:(src&&src.subs)||[]});
    const n=needs();const miss=[n.before&&!(slots.before.blob||slots.before.meta)?"before":"",n.after&&!(slots.after.blob||slots.after.meta)?"after":""].filter(Boolean);
    if(needPhotos()&&miss.length)throw new Error("Add the "+miss.join(" and ")+" photo"+(miss.length>1?"s":"")+" before submitting ("+(n.before&&!slots.before.blob&&!slots.before.meta?"first timesheet at this location":"")+(miss.length>1?"; ":"")+(miss.includes("after")?"location marked complete":"")+").");
    if(!canSave())return;
    if(slots.before.blob||slots.after.blob)e.target.textContent="Uploading photos…";patch.photos=await savePhotos(slots);
    if(scanFile){e.target.textContent="Uploading scan…";patch.scan=await storePackage(scanFile);}
    e.target.textContent="Saving…";
    const newPeople=labor.filter(L=>!L.pid);
    if(newPeople.length){await commitIndex(ix=>{ix.roster=ix.roster||[];newPeople.forEach(L=>{const ex=ix.roster.find(p=>p.name.toLowerCase()===L.name.toLowerCase());if(ex){L.pid=ex.id;return;}const p={id:newId("w-"),name:L.name,role:L.role,addedBy:S.me.name,addedAt:new Date().toISOString()};ix.roster.push(p);L.pid=p.id;});},"Workflow: add to crew roster");}
    const sum=sheetPoleText(Object.assign({},patch,{kind:"te"}))+(patch.locComplete?" · LOCATION COMPLETE":"")+" · crew "+labor.length+" · "+fmtN(teHours(patch))+" hrs · equipment "+equip.length+(subs.length?" · subs "+subs.length:"");
    if(!id){patch.status=ST.SUB;patch.submittedAt=new Date().toISOString();
      const nid=await createDoc("sheet",patch,"Submitted T&E timesheet: "+sum);if(nid){closeOverlay();toast("Timesheet submitted to the CM");location.hash="sheet-"+nid;}}
    else{const resub=src.status===ST.RET;
      const ok=await commitDoc(id,x=>{if(x.status===ST.INV)throw new Error("This timesheet is already invoiced.");Object.assign(x,patch);if(x.status===ST.RET){x.status=ST.SUB;x.submittedAt=new Date().toISOString();}},(resub?"Fixed and resubmitted. ":"Edited. ")+sum+(newPeople.length?" · added to roster: "+newPeople.map(L=>L.name).join(", "):""));
      if(ok){closeOverlay();toast(resub?"Resubmitted to the CM":"Saved");}}
  });
}

/* ---------- T&E timesheet view ---------- */
function teDetailsHtml(d){const j=jobById(d.jobId);
  const p=poleById(j,d.poleId);
  return dl("Location",p?esc(p.esPole+" — "+p.street+(p.town?", "+p.town:"")):'<span class="late">No location</span>',true)+(p?dl("Ticket ID",esc(p.ticket)):"")+dl("Location complete",d.locComplete?'<span class="chip c-done">Yes — marked complete</span>':"No")+dl("Date",d.workDate?esc(fmtD(d.workDate)):'<span class="chip c-req">Not filled in yet</span>')+dl("Crew lead",String(d.crew||"").trim()?esc(d.crew):'<span class="chip c-req">Not filled in yet</span>')+dl("Work order #",esc(d.wo))+
    dl("T&E pricing",teJobSet(j)?esc(teJobSet(j).name+(j.teArea&&!teAreaFree(teJobSet(j))?" · "+j.teArea:"")):'<span class="late">Not set on the job</span>')+dl("Rate year",esc(yearOf(d.workDate)||""))+dl("Crew",esc(teSummary(d)))+
    dl("Submitted",esc(d.createdBy+" · "+fmtT(d.submittedAt||d.createdAt)))+dl("CM signature",d.gfAt?'<span class="sig">✔ Approved by '+esc(d.gfBy)+"</span> · "+esc(fmtT(d.gfAt)):"")+(can.seeInvoices()?dl("Invoice",esc(d.invoiceNo||"")):"")+
    (d.scan?dl("Paper timesheet",'<button class="btn sm" type="button" id="a-scan">'+esc(d.scan.name)+"</button>"):"")+(d.notes?dl("Notes",esc(d.notes),true):"")+(d.gfNote?dl("CM note",esc(d.gfNote),true):"");}
function teBodyHtml(d){
  const priced=can.seePrice();const pr=priceTe(d);const by=c=>pr.lines.filter(l=>l.cat===c);
  const lab='<h2 class="sec">Crew</h2><div class="tablebox"><table class="static"><thead><tr><th>Name</th><th>Classification</th><th class="num">ST hrs</th><th class="num">OT hrs</th><th class="num">DT hrs</th><th>Per diem</th><th>Lodging</th>'+(priced?'<th class="num">Amount</th>':"")+"</tr></thead><tbody>"+
    (d.labor||[]).map(L=>{const amt=by("Labor").filter(l=>l.who===L.name);const a=amt.some(l=>l.ext==null)?null:amt.reduce((x,l)=>x+l.ext,0);
      return"<tr><td><b>"+esc(L.name)+"</b></td><td>"+esc(L.role)+"</td>"+TE_HRS.map(([k])=>'<td class="mono num">'+(Number(L[k])?fmtN(L[k]):'<span class="sub">—</span>')+"</td>").join("")+"<td>"+(L.pd?"✔":"")+"</td><td>"+(L.lodge?"✔":"")+"</td>"+(priced?'<td class="mono num">'+(a==null?'<span class="late">No rate</span>':money(a))+"</td>":"")+"</tr>";}).join("")+
    '</tbody><tfoot><tr><td colspan="2" class="num"><b>Total hours</b></td>'+TE_HRS.map(([k])=>'<td class="mono num"><b>'+fmtN((d.labor||[]).reduce((a,L)=>a+(Number(L[k])||0),0))+"</b></td>").join("")+'<td colspan="'+(priced?3:2)+'"></td></tr></tfoot></table></div>';
  const eq='<h2 class="sec">Equipment</h2>'+((d.equip||[]).length?'<div class="tablebox"><table class="static"><thead><tr><th>Equipment</th><th>Billed by</th><th class="num">Qty</th>'+(priced?'<th class="num">Rate</th><th class="num">Amount</th>':"")+"</tr></thead><tbody>"+
    by("Equipment").map(l=>"<tr><td><b>"+esc(l.item)+"</b></td><td>"+esc(l.type)+'</td><td class="mono num">'+fmtN(l.qty)+"</td>"+(priced?'<td class="mono num">'+(l.rate==null?'<span class="late">No rate</span>':money(l.rate))+'</td><td class="mono num">'+(l.ext==null?"—":money(l.ext))+"</td>":"")+"</tr>").join("")+"</tbody></table></div>":'<p class="sub">No equipment on this timesheet.</p>');
  const rest=by("Per diem").concat(by("Lodging"),by("Subcontractor"));
  const other=priced&&rest.length?'<h2 class="sec">Per diem, lodging &amp; subcontractors</h2><div class="tablebox"><table class="static"><thead><tr><th>Item</th><th>Type</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>'+
    rest.map(l=>"<tr><td>"+esc(l.item)+"</td><td>"+esc(l.type)+'</td><td class="mono num">'+fmtN(l.qty)+'</td><td class="mono num">'+(l.rate==null?'<span class="late">Not set</span>':money(l.rate))+'</td><td class="mono num">'+(l.ext==null?"—":money(l.ext))+"</td></tr>").join("")+"</tbody></table></div>":"";
  return(priced&&pr.errs.length?'<div class="banner bad"><b>Pricing check:</b> '+esc(pr.errs.join(" · "))+"</div>":"")+lab+eq+other+'<h2 class="sec">Photos</h2>'+photosSectionHtml(d)+
    (priced?'<div class="okbox" style="margin-top:10px">Day total: <b class="mono">'+(pr.total==null?"Incomplete":money(pr.total))+'</b> <span class="sub">Calculated: Σ hours / qty × rate ('+esc(pr.label)+"), USD</span></div>":"");}

/* ---------- T&E job page: locations, timesheets, CM sign-off ---------- */
function renderTeJob(j){
  const ss=visibleSheets().filter(s=>s.jobId===j.id);const gfList=ss.filter(s=>s.status===ST.SUB).sort((a,b)=>String(a.workDate).localeCompare(String(b.workDate))||String(a.no).localeCompare(String(b.no)));
  if(!S.jobTab)S.jobTab=canGfSign()&&gfList.length?"gf":"locs";const tab=S.jobTab;
  const by=st=>ss.filter(s=>s.status===st).length;const ok=ss.filter(isReady).length,inv=by(ST.INV);const locs=j.poles||[];
  const all=sheets().filter(s=>isTe(s)&&s.jobId===j.id);const locSt=p=>teLocStatus(all.filter(s=>s.poleId===p.id));const nDone=locs.filter(p=>locSt(p)[0]==="Complete").length;
  let appr=0,apprOk=true;ss.filter(s=>isReady(s)||s.status===ST.INV).forEach(s=>{const t=priceTe(s).total;if(t==null)apprOk=false;else appr+=t;});
  main.innerHTML='<a class="back" href="#overview">← Overview</a>'+
    '<section class="jobhead"><div><h1>'+esc(j.name)+'</h1><div class="meta"><span class="chip c-sch">T&amp;E</span>'+(j.archived?'<span class="chip c-stage">Closed</span>':'<span class="chip c-done">Active</span>')+"<span>"+esc(j.customer)+"</span>"+(j.po?"<span>PO "+esc(j.po)+"</span>":"")+(j.wo?"<span>WO / Job # "+esc(j.wo)+"</span>":"")+(teJobSet(j)?"<span>"+esc(teJobSet(j).name)+(j.teArea&&!teAreaFree(teJobSet(j))?" · "+esc(j.teArea):"")+"</span>":"")+(j.gf?"<span>CM "+esc(j.gf)+"</span>":"")+'</div></div><div class="acts">'+
      (can.newSheet()&&!j.archived?'<button class="btn primary" type="button" id="tj-new">+ New T&amp;E timesheet</button>':"")+'<button class="btn" type="button" id="tj-print">Print blank timesheet</button>'+
      (can.setup()?'<button class="btn" type="button" id="tj-add">+ Add locations</button><button class="btn" type="button" id="tj-roster">Crew roster</button><button class="btn" type="button" id="tj-edit">Edit job</button>':"")+(role()!=="crew"?'<button class="btn" type="button" id="tj-csv">Export CSV</button>':"")+"</div></section>"+
    (!teJobSet(j)&&role()!=="crew"?'<div class="banner">No T&amp;E pricing is picked for this job, so its timesheets can\'t be priced. Pick it with <b>Edit job</b>.</div>':(teJobSet(j)&&!teJobArea(j,teJobSet(j))&&role()!=="crew"?'<div class="banner">'+esc(teJobSet(j).name)+' has different labor rates by service area. Pick the service area with <b>Edit job</b>.</div>':""))+
    (role()!=="crew"&&((j.packages||[]).length||can.setup())?'<div class="pkgbar"><b>Job package</b>'+(j.packages||[]).map((pk,i)=>'<button class="btn sm" type="button" data-pk="'+i+'">'+esc(pk.name)+' <span class="sub">'+fmtSize(pk.size)+"</span></button>").join("")+((j.packages||[]).length?"":'<span class="sub">None uploaded</span>')+(can.setup()?'<button class="btn sm primary" type="button" id="tj-pkg">Upload package</button>':"")+"</div>":"")+
    '<section class="tiles">'+tile("Locations complete",nDone+" / "+locs.length,locs.filter(p=>locSt(p)[0]!=="Not started").length+" started",false)+tile("Awaiting CM signature",by(ST.SUB),"Timesheets to review",by(ST.SUB)>0)+tile("Ready to bill",ok,"Signed by the CM",false)+tile("Invoiced",inv,"On invoices",false)+(can.seePrice()?tile("Approved $",ok+inv?(apprOk?money(appr):"Check"):"$0.00","Ready + invoiced",false):"")+"</section>"+
    '<div class="subtabs" role="tablist"><button role="tab" type="button" id="t-locs" aria-selected="'+(tab==="locs")+'">Locations ('+locs.length+')</button><button role="tab" type="button" id="t-sheets" aria-selected="'+(tab==="sheets")+'">Timesheets ('+ss.length+")</button>"+(canGfSign()?'<button role="tab" type="button" id="t-gf" aria-selected="'+(tab==="gf")+'">CM sign-off ('+gfList.length+")</button>":"")+'</div><div id="jbody"></div>';
  const on=(i,fn)=>{const b=document.getElementById(i);if(b)b.onclick=fn;};
  on("t-locs",()=>{S.jobTab="locs";renderJob();});on("t-sheets",()=>{S.jobTab="sheets";renderJob();});on("t-gf",()=>{S.jobTab="gf";renderJob();});
  on("tj-new",()=>openTeForm(null,j.id));on("tj-print",()=>printTeSheet(j,null));on("tj-add",()=>openAddLocations(j.id));on("tj-roster",openRoster);on("tj-edit",()=>{location.hash="jobedit-"+j.id;});on("tj-pkg",()=>openAddLocations(j.id,true));
  main.querySelectorAll("[data-pk]").forEach(b=>b.onclick=()=>openPackage(j.packages[+b.dataset.pk],b));
  on("tj-csv",()=>{const head=["Timesheet #","Work date","Location","Ticket ID","Location complete","Crew lead","Name","Classification","ST hrs","OT hrs","DT hrs","Per diem","Lodging","Status","Invoice #"];
    const L=[head];ss.slice().sort((a,b)=>String(a.workDate).localeCompare(String(b.workDate))).forEach(s=>{const p=poleById(j,s.poleId);(s.labor||[]).forEach(x=>L.push([s.no,fmtD(s.workDate),sheetPoleText(s),p?p.ticket:"",s.locComplete?"Y":"",s.crew,x.name,x.role,x.st||0,x.ot||0,x.dt||0,x.pd?"Y":"",x.lodge?"Y":"",ST_LABEL[s.status]||s.status,s.invoiceNo||""]));});
    download(new Blob(["﻿"+L.map(r=>r.map(v=>'"'+String(v==null?"":v).replace(/"/g,'""')+'"').join(",")).join("\r\n")],{type:"text/csv"}),"T&E timesheets - "+j.name+".csv");});
  const box=document.getElementById("jbody");
  if(tab==="gf"){if(!canGfSign())box.innerHTML='<p class="sub">Only a Construction Manager or admin can sign.</p>';else gfTable(box,gfList,false);return;}
  if(tab==="sheets"){
    const rows=ss.slice().sort((a,b)=>ST_ORDER.indexOf(a.status)-ST_ORDER.indexOf(b.status)||String(b.workDate).localeCompare(String(a.workDate)));
    box.innerHTML='<div class="tablebox"><table><thead><tr><th class="nosort">Timesheet #</th><th class="nosort">Work date</th><th class="nosort">Location</th><th class="nosort">Crew lead</th><th class="nosort">Crew</th>'+(can.seePrice()?'<th class="nosort num">Amount</th>':"")+'<th class="nosort">Status</th></tr></thead><tbody id="tj-sh"></tbody></table></div>';
    const tb=document.getElementById("tj-sh");
    tb.innerHTML=rows.map(s=>{const pr=can.seePrice()?priceTe(s):null;return'<tr tabindex="0" data-id="'+esc(s.id)+'"><td class="mono"><b>'+esc(s.no)+"</b></td><td>"+dateCell(s)+'</td><td class="wrapc">'+esc(sheetPoleText(s))+(s.locComplete?' <span class="chip c-done">Complete</span>':"")+"</td><td>"+crewCell(s)+'</td><td class="wrapc">'+esc(teSummary(s))+"</td>"+(pr?'<td class="mono num">'+(pr.total==null?'<span class="sub" title="'+esc(pr.errs.join("; "))+'">Check pricing</span>':money(pr.total))+"</td>":"")+"<td>"+stChip(s)+"</td></tr>";}).join("")||'<tr><td colspan="7"><div class="empty"><b>No timesheets yet</b>'+(can.newSheet()?"Pick a location on the Locations tab and use Log time.":"")+"</div></td></tr>";
    bindRows(tb,id=>location.hash="sheet-"+id);return;}
  const q=S.pf.q||"",stf=S.pf.st||"";
  box.innerHTML='<div class="filters" style="margin-bottom:10px"><input type="search" id="pl-q" placeholder="Search street, pole #, ticket…" aria-label="Search locations" value="'+esc(q)+'"><select id="pl-st" aria-label="Status"><option value="">All statuses</option>'+["Not started","In progress","Returned to field","Complete — awaiting CM","Complete"].map(x=>"<option"+(x===stf?" selected":"")+">"+x+"</option>").join("")+'</select><span class="count" id="pl-count"></span></div>'+
    '<div class="tablebox"><table><thead><tr><th class="nosort">#</th><th class="nosort">Ticket ID</th><th class="nosort">Town</th><th class="nosort">Street</th><th class="nosort">ES pole #</th><th class="nosort">Status</th><th class="nosort">Timesheets</th><th class="nosort num">Labor hrs</th>'+(can.seePrice()?'<th class="nosort num">Approved $</th>':"")+'<th class="nosort">Photos</th><th class="nosort"></th></tr></thead><tbody id="pl-body"></tbody></table></div>';
  const qi=document.getElementById("pl-q"),si=document.getElementById("pl-st");qi.oninput=()=>{S.pf.q=qi.value;fill();};si.onchange=()=>{S.pf.st=si.value;fill();};
  function fill(){const qq=(S.pf.q||"").trim().toLowerCase();
    const rows=locs.map(p=>{const sh=ss.filter(s=>s.poleId===p.id);const stt=teLocStatus(all.filter(s=>s.poleId===p.id));const ap=sh.filter(s=>isReady(s)||s.status===ST.INV).map(priceTe);const amt=ap.some(x=>x.total==null)?null:ap.reduce((a,x)=>a+x.total,0);
      const hasB=sh.some(s=>s.photos&&s.photos.before),hasA=sh.some(s=>s.photos&&s.photos.after);return{p,sh,stt,amt,nap:ap.length,hrs:sh.reduce((a,s)=>a+teHours(s),0),hasB,hasA};})
      .filter(r=>(!qq||[r.p.street,r.p.esPole,r.p.vzPole,r.p.ticket,r.p.town,r.p.notes].join(" ").toLowerCase().indexOf(qq)>=0)&&(!S.pf.st||r.stt[0]===S.pf.st));
    document.getElementById("pl-count").textContent=rows.length+" of "+locs.length+" locations";
    const tb=document.getElementById("pl-body");
    tb.innerHTML=rows.map(r=>{const p=r.p;return'<tr tabindex="0" data-id="'+esc(p.id)+'"><td class="mono">'+esc(p.n)+'</td><td class="mono">'+esc(p.ticket)+"</td><td>"+esc(p.town)+"</td><td><b>"+esc(p.street)+'</b></td><td class="mono">'+esc(p.esPole)+'</td><td><span class="chip '+r.stt[1]+'">'+esc(r.stt[0])+'</span></td><td class="mono">'+r.sh.length+'</td><td class="mono num">'+(r.hrs?fmtN(r.hrs):"")+"</td>"+
      (can.seePrice()?'<td class="mono num">'+(r.nap?(r.amt==null?'<span class="sub">Check pricing</span>':money(r.amt)):"")+"</td>":"")+"<td>"+(r.sh.length?(r.hasB?'<span class="chip c-done">Before ✓</span>':'<span class="chip c-bad">No before</span>')+" "+(r.hasA?'<span class="chip c-done">After ✓</span>':(r.stt[0].indexOf("Complete")===0?'<span class="chip c-bad">No after</span>':"")):"")+"</td>"+
      '<td style="white-space:nowrap">'+(can.newSheet()&&!j.archived?'<button class="btn sm primary" type="button" data-log="'+esc(p.id)+'">Log time</button> ':"")+'<button class="btn sm" type="button" data-print="'+esc(p.id)+'" aria-label="Print timesheet for '+esc(p.street+" "+p.esPole)+'">Print</button></td></tr>';}).join("")||'<tr><td colspan="11"><div class="empty"><b>No locations</b>'+(locs.length?"Nothing matches the filters.":(can.setup()?"Use + Add locations.":"Billing adds the job's locations."))+"</div></td></tr>";
    tb.querySelectorAll("[data-log]").forEach(b=>b.onclick=ev=>{ev.stopPropagation();openTeForm(null,j.id,b.dataset.log);});
    tb.querySelectorAll("[data-print]").forEach(b=>b.onclick=ev=>{ev.stopPropagation();printTeSheet(j,poleById(j,b.dataset.print));});
    if(role()!=="crew")bindRows(tb,pid=>openPoleForm(j.id,pid));}
  fill();}

/* ---------- printable blank T&E timesheet (crew and equipment pre-filled from the last timesheet) ---------- */
function printTeSheet(j,pole){
  const prev=lastTe(j.id);const people=(prev&&prev.labor)||[];const eq=(prev&&prev.equip)||[];
  const NL=Math.max(14,people.length+3),NE=Math.max(7,eq.length+2);
  const box=(label,val,cls)=>'<div class="us-f '+(cls||"")+'"><span>'+esc(label)+'</span><div class="us-box">'+esc(val||"")+"</div></div>";
  const lab=Array.from({length:NL},(_,i)=>{const p=people[i];return"<tr><td>"+esc(p?p.name:"")+"</td><td>"+esc(p?p.role:"")+'</td><td class="q"></td><td class="q"></td><td class="q"></td><td class="q"></td><td class="q"></td></tr>';}).join("");
  const eqr=Array.from({length:NE},(_,i)=>{const e=eq[i];const b=e?(TE_BASIS.find(x=>x[0]===e.basis)||TE_BASIS[0])[1]:"";return"<tr><td>"+esc(e?e.item:"")+'</td><td class="q2">'+esc(b?"☐ Hrs ☐ Days ☐ Mo":"☐ Hrs ☐ Days ☐ Mo")+'</td><td class="q"></td></tr>';}).join("");
  const p=document.getElementById("print");
  p.innerHTML='<div class="us"><section class="us-page te-page"><div class="us-top"><div><h1>T&amp;E DAILY TIMESHEET</h1><div class="sub" style="font-size:11px;margin-top:4px">Time &amp; equipment · one sheet per location per day · before photo on the first day, after photo when complete</div></div><div class="us-job"><img src="pg-logo.jpg" alt="P&amp;G Power Co."><b>'+esc(j.name)+"</b>"+(j.po?"<span>PO "+esc(j.po)+"</span>":"")+(teJobSet(j)?"<span>"+esc(teJobSet(j).name)+"</span>":"")+"</div></div>"+
    '<div class="us-row">'+box("DATE","","w1")+box("CREW LEAD",prev?prev.crew:"","w2")+box("WORK ORDER #",prev?prev.wo:j.wo,"w1")+box("WEATHER / START–END TIME","","w2")+"</div>"+
    '<div class="us-row">'+box("LOCATION — POLE # / STREET",pole?[pole.esPole,[pole.street,pole.town].filter(Boolean).join(", ")].filter(Boolean).join(" — "):"","w3")+box("TICKET ID",pole?pole.ticket:"","w1")+'<div class="us-f w1"><span>LOCATION COMPLETE?</span><div class="us-box">[&nbsp;&nbsp;] YES &nbsp; [&nbsp;&nbsp;] NO</div></div></div>'+
    '<table class="us-sec te-sec" style="margin-top:10px"><thead><tr><th>NAME</th><th>CLASSIFICATION</th><th class="q">ST HRS</th><th class="q">OT HRS</th><th class="q">DT HRS</th><th class="q">PER DIEM</th><th class="q">LODGING</th></tr></thead><tbody>'+lab+"</tbody></table>"+
    '<table class="us-sec te-sec"><thead><tr><th>EQUIPMENT</th><th class="q2">BILL BY</th><th class="q">QTY</th></tr></thead><tbody>'+eqr+"</tbody></table>"+
    '<table class="us-sec te-sec"><thead><tr><th>SUBCONTRACTOR</th><th>DESCRIPTION OF WORK</th></tr></thead><tbody><tr><td></td><td></td></tr><tr><td></td><td></td></tr></tbody></table>'+
    '<div class="us-notes"><b>NOTES / WORK PERFORMED:</b><div class="us-l"></div><div class="us-l"></div></div>'+
    '<div class="us-row" style="margin-top:12px">'+box("GENERAL FOREMAN SIGNATURE","","w2")+box("CM SIGNATURE","","w2")+box("DATE","","w1")+"</div>"+
    '<div class="us-foot">P&amp;G Power Co. · '+esc(j.name)+(prev?" · crew pre-filled from "+esc(prev.no)+" ("+esc(fmtD(prev.workDate))+")":"")+"</div></section></div>";
  document.body.classList.add("printing");const pt=document.title;document.title="T&E Timesheet - "+j.name+(pole?" - "+pole.street+" "+pole.esPole:"");
  const done=()=>{document.body.classList.remove("printing");document.title=pt;window.removeEventListener("afterprint",done);};window.addEventListener("afterprint",done);
  const imgs=[...p.querySelectorAll("img")];Promise.all(imgs.map(im=>im.complete?1:new Promise(r=>{im.onload=im.onerror=r;}))).then(()=>setTimeout(()=>window.print(),150));}

/* ---------- T&E invoice ---------- */
const TE_CATS=["Labor","Equipment","Per diem","Lodging","Subcontractor"];
function buildTeInvoice(sel){
  const errs=[];const days=sel.slice().sort((a,b)=>String(a.workDate).localeCompare(String(b.workDate))||String(a.no).localeCompare(String(b.no))).map(s=>{const pr=priceTe(s);if(s.hold&&s.hold.on)errs.push(s.no+" is on hold");pr.errs.forEach(e=>errs.push(s.no+": "+e));
    return{sheetId:s.id,no:s.no,date:s.workDate,loc:sheetPoleText(s),locComplete:!!s.locComplete,crew:s.crew,wo:s.wo||"",area:pr.area,year:pr.year,label:pr.label,gfBy:s.gfBy||"",gfAt:s.gfAt||"",lines:pr.lines,total:pr.lines.reduce((a,l)=>a+(l.ext||0),0)};});
  const summary=TE_CATS.map(c=>({cat:c,amount:days.reduce((a,d)=>a+d.lines.filter(l=>l.cat===c).reduce((x,l)=>x+(l.ext||0),0),0)})).filter(x=>x.amount);
  const lab=new Map();days.forEach(d=>d.lines.filter(l=>l.cat==="Labor").forEach(l=>{const k=l.item+"|"+l.type+"|"+l.rate;const e=lab.get(k)||{item:l.item,type:l.type,rate:l.rate,qty:0,ext:0};e.qty+=l.qty;e.ext+=l.ext||0;lab.set(k,e);}));
  const eqm=new Map();days.forEach(d=>d.lines.filter(l=>l.cat==="Equipment").forEach(l=>{const k=l.item+"|"+l.type+"|"+l.rate;const e=eqm.get(k)||{item:l.item,type:l.type,rate:l.rate,qty:0,ext:0};e.qty+=l.qty;e.ext+=l.ext||0;eqm.set(k,e);}));
  const dates=days.map(d=>d.date).filter(Boolean).sort();
  return{kind:"te",days,summary,labor:[...lab.values()],equipment:[...eqm.values()],poles:[],errs:[...new Set(errs)],total:cents(days.reduce((a,d)=>a+d.total,0)),period:dates.length?fmtD(dates[0])+(dates[dates.length-1]!==dates[0]?" – "+fmtD(dates[dates.length-1]):""):""};}
function teInvPreviewHtml(b){
  return'<div class="tablebox"><table class="static"><thead><tr><th>Date</th><th>Timesheet</th><th>Location</th><th>Crew lead</th><th class="num">Labor hrs</th><th class="num">Amount</th></tr></thead><tbody>'+
    (b.days.map(d=>"<tr><td>"+esc(fmtD(d.date))+'</td><td class="mono">'+esc(d.no)+"</td><td>"+esc(d.loc||"")+"</td><td>"+esc(d.crew)+'</td><td class="mono num">'+fmtN(d.lines.filter(l=>l.cat==="Labor").reduce((a,l)=>a+l.qty,0))+'</td><td class="mono num">'+money(d.total)+"</td></tr>").join("")||'<tr><td colspan="6" class="sub">Select at least one timesheet.</td></tr>')+
    '</tbody><tfoot><tr><td colspan="5" class="num"><b>Total (USD) · '+b.days.length+" day"+(b.days.length===1?"":"s")+'</b></td><td class="mono num"><b>'+(b.errs.length?"—":money(b.total))+"</b></td></tr></tfoot></table></div>";}
function teInvCoverHtml(i,pv){
  const T=pv?"pv-lines":"static";const n=pv?"num":"mono num";
  return'<table class="'+T+'"><thead><tr><th>Category</th><th class="num">Amount</th></tr></thead><tbody>'+i.summary.map(x=>"<tr><td>"+esc(x.cat)+'</td><td class="'+n+'">'+money(x.amount)+"</td></tr>").join("")+'</tbody><tfoot><tr><td class="num">TOTAL (USD)</td><td class="'+n+'">'+money(i.total)+"</td></tr></tfoot></table>"+
    (i.labor.length?(pv?'<h2 class="pv-h2" style="margin-top:14px">Labor by classification</h2>':'<h2 class="sec">Labor by classification</h2>')+'<table class="'+T+'"><thead><tr><th>Classification</th><th>Hour type</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>'+i.labor.map(x=>"<tr><td>"+esc(x.item)+"</td><td>"+esc(x.type)+'</td><td class="'+n+'">'+fmtN(x.qty)+'</td><td class="'+n+'">'+money(x.rate)+'</td><td class="'+n+'">'+money(x.ext)+"</td></tr>").join("")+"</tbody></table>":"")+
    (i.equipment.length?(pv?'<h2 class="pv-h2" style="margin-top:14px">Equipment</h2>':'<h2 class="sec">Equipment</h2>')+'<table class="'+T+'"><thead><tr><th>Equipment</th><th>Billed by</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>'+i.equipment.map(x=>"<tr><td>"+esc(x.item)+"</td><td>"+esc(x.type)+'</td><td class="'+n+'">'+fmtN(x.qty)+'</td><td class="'+n+'">'+money(x.rate)+'</td><td class="'+n+'">'+money(x.ext)+"</td></tr>").join("")+"</tbody></table>":"");}
function teInvDayHtml(d,pv){const n=pv?"num":"mono num";
  return'<table class="'+(pv?"pv-lines pv-pole":"static")+'"><thead><tr><th colspan="6">'+esc(fmtD(d.date)+"  |  "+d.no+(d.loc?"  |  "+d.loc+(d.locComplete?" (COMPLETE)":""):"")+"  |  CREW LEAD "+d.crew+(d.wo?"  |  WO #"+d.wo:"")+"  |  "+(d.label||(d.area+" "+d.year+" rates")).toUpperCase())+'</th></tr><tr class="subh"><td>Category</td><td>Description</td><td>Type</td><td class="num">Qty</td><td class="num">Rate</td><td class="num">Amount</td></tr></thead><tbody>'+
    d.lines.map(l=>"<tr><td>"+esc(l.cat)+"</td><td>"+esc(l.item+(l.who?" — "+l.who:""))+"</td><td>"+esc(l.type)+'</td><td class="'+n+'">'+fmtN(l.qty)+'</td><td class="'+n+'">'+money(l.rate)+'</td><td class="'+n+'">'+money(l.ext)+"</td></tr>").join("")+
    '</tbody><tfoot><tr><td colspan="5">'+esc(fmtD(d.date)+" DAY TOTAL")+(d.gfBy?' <span style="font-weight:400;font-size:10.5px">· CM signed: '+esc(d.gfBy)+"</span>":"")+'</td><td class="'+n+'">'+money(d.total)+"</td></tr></tfoot></table>";}
function renderTeInvoice(i,id){
  const chk=cents(i.days.reduce((a,d)=>a+d.lines.reduce((x,l)=>x+(l.ext||0),0),0));const tieOk=chk===cents(i.total);
  const acts=['<button class="btn primary" type="button" id="v-pdf">P&amp;G T&amp;E invoice PDF</button>'];
  if(can.invoice()&&i.status==="Draft")acts.push('<button class="btn" type="button" id="v-sent">Mark as sent</button>');
  if(can.invoice()&&i.status!=="Void")acts.push('<button class="btn danger" type="button" id="v-void">Void</button>');
  main.innerHTML='<a class="back" href="#invoices">← Invoices</a><section class="jobhead"><div><h1>Invoice '+esc(i.no)+'</h1><div class="meta"><span class="chip c-sch">T&amp;E</span>'+invChip(i.status)+"<span>"+esc(i.jobName)+"</span><span>"+esc(fmtD(i.date))+'</span></div></div><div class="acts">'+acts.join("")+"</div></section>"+
    (tieOk?"":'<div class="banner bad">Day lines total '+money(chk)+" but the saved invoice total is "+money(i.total)+" (variance "+money(cents(chk-i.total))+"). Do not send until this is resolved.</div>")+
    '<section class="details">'+dl("Bill to",esc(i.customer))+dl("Terms",esc(i.terms))+dl("PO#",esc(i.po))+dl("Billing period",esc(i.period))+dl("Billing package",esc(i.pkg))+dl("Invoice total",'<b class="mono">'+money(i.total)+"</b>")+dl("Timesheets",esc(i.days.map(d=>d.no).join(", ")),true)+(i.sentAt?dl("Sent",esc(i.sentBy+" · "+fmtT(i.sentAt))):"")+"</section>"+
    '<h2 class="sec">T&amp;E billing summary</h2><div class="tablebox">'+teInvCoverHtml(i,false)+"</div>"+
    '<h2 class="sec">Daily detail</h2>'+i.days.map(d=>'<div class="tablebox" style="margin-bottom:10px">'+teInvDayHtml(d,false)+"</div>").join("")+'<h2 class="sec">History</h2>'+histHtml(i);
  document.getElementById("v-pdf").onclick=()=>printTeInvoice(i);
  const s=document.getElementById("v-sent");if(s)s.onclick=()=>confirmBox("Mark "+i.no+" as sent?","Record that this invoice was submitted. Its timesheets drop off the UBL.","Mark sent",async n=>{await commitDoc(id,x=>{x.status="Sent";x.sentAt=new Date().toISOString();x.sentBy=S.me.name;},"Marked sent"+(n?": "+n:""));},{note:"Note"});
  const v=document.getElementById("v-void");if(v)v.onclick=()=>confirmBox("Void invoice "+i.no+"?","Its timesheets go back to Ready to bill so they can be billed again. The voided invoice stays on record.","Void invoice",async n=>{
    const ok=await commitDoc(id,x=>{x.status="Void";x.voidAt=new Date().toISOString();x.voidBy=S.me.name;},"Voided: "+n,true);if(!ok)return;
    for(const sid of i.sheetIds||[]){if(S.index.docs[sid])await commitDoc(sid,x=>{if(x.invoiceId===id){x.status=ST.OK;x.invoiceId="";x.invoiceNo="";}},"Invoice "+i.no+" voided — back to Ready to bill",true);}
    refresh();toast("Invoice "+i.no+" voided");},{note:"Reason",noteReq:true,danger:true});}
function printTeInvoice(i){
  const p=document.getElementById("print");
  const head='<div class="pv-head"><div><img src="pg-logo.jpg" alt="P&amp;G Power Co."><div class="pv-from">'+(i.from||[]).map(esc).join("<br>")+'</div></div><div class="pv-title"><h1>INVOICE</h1><table class="pv-meta"><tr><td>Invoice No.</td><td><b>'+esc(i.no)+"</b></td></tr><tr><td>Invoice Date</td><td>"+esc(fmtD(i.date))+"</td></tr>"+(i.terms?"<tr><td>Terms</td><td>"+esc(i.terms)+"</td></tr>":"")+"<tr><td>Bill To</td><td>"+esc(i.customer)+"</td></tr>"+(i.po?"<tr><td>PO#</td><td>"+esc(i.po)+"</td></tr>":"")+(i.period?"<tr><td>Billing Period</td><td>"+esc(i.period)+"</td></tr>":"")+'</table></div></div><div class="pv-stripe"></div>';
  p.innerHTML='<div class="pv">'+head+'<h2 class="pv-h2">'+esc((i.customer||"").toUpperCase())+" — TIME &amp; EQUIPMENT BILLING SUMMARY"+(i.jobName?" · "+esc(i.jobName.toUpperCase()):"")+"</h2>"+teInvCoverHtml(i,true)+'<p class="pv-foot">Daily detail follows. Rates per '+esc([...new Set(i.days.map(d=>(d.label||"").split(" · ")[0]).filter(Boolean))].join(", ")||"the Eversource T&D MSA, Exhibit B")+'.</p>'+
    '<div class="pv-break"></div>'+head+'<h2 class="pv-h2">DAILY DETAIL</h2>'+i.days.map(d=>teInvDayHtml(d,true)).join("")+'<table class="pv-lines"><tfoot><tr><td class="num">INVOICE TOTAL (USD)</td><td class="num" style="width:140px">'+money(i.total)+"</td></tr></tfoot></table></div>";
  document.body.classList.add("printing");const prev=document.title;document.title="P&G T&E Invoice "+i.no;
  const done=()=>{document.body.classList.remove("printing");document.title=prev;window.removeEventListener("afterprint",done);};window.addEventListener("afterprint",done);setTimeout(()=>window.print(),200);}
