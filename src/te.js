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
const teHours=d=>(d.labor||[]).reduce((a,L)=>a+(d.weekly?(L.h||[]).reduce((x,h)=>x+(h?TE_HRS.reduce((y,[k])=>y+(Number(h[k])||0),0):0),0):TE_HRS.reduce((x,[k])=>x+(Number(L[k])||0),0)),0);
function teSummary(d){const n=(d.labor||[]).length,e=(d.equip||[]).length;return n+" people · "+fmtN(teHours(d))+" labor hrs"+(e?" · "+e+" equipment":"");}
function teRoleNames(set){const out=[];(set?[set]:teSets()).forEach(r=>r.labor.forEach(x=>{if(!out.some(o=>o.role===x.role))out.push({role:x.role,group:x.group});}));return out;}
function teEquipNames(set){const out=[];(set?[set]:teSets()).forEach(r=>r.equipment.forEach(x=>{if(!out.some(o=>o.item===x.item))out.push({item:x.item,category:x.category});}));return out;}
/* ---------- pricing ---------- */
function priceTe(d){
  if(d.weekly)return priceTeWeek(d);
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

/* ---------- weekly T&E timesheets (from the P&G / Eversource weekly time sheet workbook) ----------
   One record per crew per week: 6 day columns dated Monday → Saturday from the sheet's "Week:" start date.
   Each person has S.T. / T.H. (= OT) / D.T. hours per day; each piece of equipment has hours per day and bills by the
   hour as one or two rate items (e.g. a digger with pole trailer). Rate year follows each day's date. */
const TE_DAYS=["Mon","Tue","Wed","Thu","Fri","Sat"];
const addDays=(iso,n)=>{const d=new Date(iso+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const teWeekText=d=>d.weekStart?"Week of "+fmtD(d.weekStart)+(d.weekEnd?" – "+fmtD(d.weekEnd):""):"T&E timesheet";
function teDayCell(h){if(!h)return"";const p=[h.st?fmtN(h.st):"",h.ot?fmtN(h.ot)+" OT":"",h.dt?fmtN(h.dt)+" DT":""].filter(Boolean);return p.join(" + ");}
function priceTeWeek(d){
  const j=jobById(d.jobId),r=teJobSet(j),area=teJobArea(j,r);const errs=[],lines=[];
  if(!r)errs.push(j&&j.teSet?"The job's T&E pricing was removed (Edit job)":"No T&E pricing picked on the job (Edit job)");else if(!area)errs.push(r.name+" differs by service area; pick the job's service area (Edit job)");
  const ok=!!(r&&area);const days=d.days||[];
  const yrOk=i=>{const y=yearOf(days[i]);if(!y){errs.push("Day "+(i+1)+" has no date");return null;}if(ok&&!r.years.includes(y)){errs.push(r.name+" has no "+y+" rates");return null;}return y;};
  (d.labor||[]).forEach(L=>{(L.h||[]).forEach((h,i)=>{if(!h)return;TE_HRS.forEach(([k,ab])=>{const q=Number(h[k])||0;if(!q)return;const y=yrOk(i);const rr=ok&&y?r.labor.find(x=>x.area===area&&x.year===y&&x.role===L.role):null;
      if(ok&&y&&!rr)errs.push((L.role||"(no classification)")+" has no "+y+" rate in "+r.name);const rate=rr&&rr[k]!=null?rr[k]:null;if(rr&&rate==null)errs.push(L.role+" has no "+ab+" rate");
      lines.push({cat:"Labor",item:L.role,who:L.name,type:ab,qty:q,unit:"hr",rate,ext:rate==null?null:q*rate,date:days[i]});});});});
  (d.equip||[]).forEach(E=>{(E.items||[]).filter(Boolean).forEach(it=>{(E.h||[]).forEach((q,i)=>{q=Number(q)||0;if(!q)return;const y=yrOk(i);const er=ok&&y?r.equipment.find(x=>x.year===y&&x.item===it):null;const rate=er&&er.hourly!=null?er.hourly:null;
      if(ok&&y&&rate==null)errs.push(it+" has no "+y+" hourly rate");lines.push({cat:"Equipment",item:it,who:E.unitNo?"#"+E.unitNo:"",type:"Hours",qty:q,unit:"hour",rate,ext:rate==null?null:q*rate,date:days[i]});});});
    if(!(E.items||[]).filter(Boolean).length&&(E.h||[]).some(Number))errs.push((E.desc||"Equipment")+" isn't matched to a rate item");});
  const pd=(d.labor||[]).reduce((a,L)=>a+(Number(L.pdDays)||0),0),lo=(d.labor||[]).reduce((a,L)=>a+(Number(L.lodgeNights)||0),0);
  if(pd){const rate=r&&r.perDiem!=null?r.perDiem:null;if(rate==null)errs.push("Per diem rate isn't set (Rates tab)");lines.push({cat:"Per diem",item:"Per diem",who:"",type:"Person-days",qty:pd,unit:"day",rate,ext:rate==null?null:pd*rate});}
  if(lo){const rate=r&&r.lodging!=null?r.lodging:null;if(rate==null)errs.push("Lodging rate isn't set (Rates tab)");lines.push({cat:"Lodging",item:"Lodging",who:"",type:"Person-nights",qty:lo,unit:"night",rate,ext:rate==null?null:lo*rate});}
  (d.subs||[]).forEach(s=>{const amt=Number(s.amount)||0;const mk=r&&r.subMarkup!=null?r.subMarkup:null;lines.push({cat:"Subcontractor",item:s.vendor+(s.desc?" — "+s.desc:""),who:"",type:"Cost",qty:1,unit:"ls",rate:amt,ext:amt});
    if(mk==null)errs.push("Subcontractor markup isn't set (Rates tab)");else lines.push({cat:"Subcontractor",item:"Markup "+fmtN(mk)+"% — "+s.vendor,who:"",type:"Markup",qty:1,unit:"ls",rate:amt*mk/100,ext:amt*mk/100});});
  const total=errs.length?null:lines.reduce((a,l)=>a+l.ext,0);const yrs=[...new Set(days.filter(Boolean).map(yearOf))].join("/");
  return{lines,total,area,year:yrs,label:r?r.name+(yrs?" · "+yrs+" rates":"")+(area&&!teAreaFree(r)?" · "+area:""):"",set:r,errs:[...new Set(errs)],job:j,pole:null,te:true};}
/* lines grouped for display: same category, item, person/unit, hour type and rate summed over the week */
function teGroupLines(lines){const m=new Map();lines.forEach(l=>{const k=[l.cat,l.item,l.who,l.type,l.rate].join("|");const e=m.get(k)||Object.assign({},l,{qty:0,ext:0,days:0});e.qty+=l.qty;e.ext=e.ext==null||l.ext==null?null:e.ext+l.ext;e.days++;m.set(k,e);});return[...m.values()];}

/* ---------- weekly timesheet view ---------- */
function teDetailsHtml(d){const j=jobById(d.jobId);const im=d.imported||{};const set=teJobSet(j);
  return dl("Week",esc(teWeekText(d)))+dl("Foreman (crew lead)",String(d.crew||"").trim()?esc(d.crew):'<span class="chip c-req">Not filled in yet</span>')+dl("General Foreman",esc(d.gf||""))+
    dl("Work order",esc(d.wo||""))+dl("Field work order",esc(d.fwo||""))+dl("Town",esc(im.town||""))+(im.typeOfWork?dl("Type of work",esc(im.typeOfWork)):"")+
    dl("T&E pricing",set?esc(set.name+(j.teArea&&!teAreaFree(set)?" · "+j.teArea:"")):'<span class="late">Not set on the job</span>')+dl("Crew",esc(teSummary(d)))+
    dl("Submitted",esc(d.createdBy+" · "+fmtT(d.submittedAt||d.createdAt)))+dl("CM signature",d.gfAt?'<span class="sig">✔ Approved by '+esc(d.gfBy)+"</span> · "+esc(fmtT(d.gfAt)):"")+(can.seeInvoices()?dl("Invoice",esc(d.invoiceNo||"")):"")+
    (d.source?dl("Weekly time sheet",'<button class="btn sm" type="button" id="a-src">'+esc(d.source.name)+"</button>"+(im.tab?' <span class="sub">tab '+esc(im.tab)+"</span>":""),true):"")+
    (d.paySheet?dl("Pay sheet",'<button class="btn sm" type="button" id="a-paydl">'+esc(d.paySheet.file.name)+'</button> <span class="sub">published by '+esc(d.paySheet.by)+" · "+esc(fmtT(d.paySheet.at))+"</span>",true):"")+(d.scan?dl("Signed copy",'<button class="btn sm" type="button" id="a-scan">'+esc(d.scan.name)+"</button>"):"")+(im.signedDate?dl("Sheet date",esc(fmtD(im.signedDate))):"")+(im.custRep?dl("Customer rep",esc(im.custRep)):"")+
    (d.notes?dl("Description of work",esc(d.notes),true):"")+(d.gfNote?dl("CM note",esc(d.gfNote),true):"");}
function teBodyHtml(d){
  const priced=can.seePrice();const pr=priceTeWeek(d);const days=d.days||[];
  const dh=days.map((x,i)=>'<th class="num">'+TE_DAYS[i]+'<div class="sub" style="font-weight:400">'+esc(x?fmtD(x).replace(/\/\d{4}$/,""):"")+"</div></th>").join("");
  const sum=(L,k)=>(L.h||[]).reduce((a,h)=>a+(h&&Number(h[k])||0),0);
  const lab='<h2 class="sec">Crew</h2><div class="tablebox"><table class="static"><thead><tr><th>Name</th><th>Class</th>'+dh+'<th class="num">ST</th><th class="num">OT</th><th class="num">DT</th><th class="num">Per diem days</th><th class="num">Lodging nights</th>'+(priced?'<th class="num">Amount</th>':"")+"</tr></thead><tbody>"+
    (d.labor||[]).map(L=>{const ls=pr.lines.filter(l=>l.cat==="Labor"&&l.who===L.name);const a=ls.some(l=>l.ext==null)?null:ls.reduce((x,l)=>x+l.ext,0);
      return"<tr><td><b>"+esc(L.name)+'</b></td><td class="wrapc">'+esc(L.role||"")+(L.cls&&L.cls!==L.role?' <span class="sub">('+esc(L.cls)+")</span>":"")+"</td>"+days.map((x,i)=>'<td class="mono num">'+esc(teDayCell(L.h&&L.h[i]))+"</td>").join("")+
        TE_HRS.map(([k])=>'<td class="mono num"><b>'+(sum(L,k)?fmtN(sum(L,k)):"")+"</b></td>").join("")+'<td class="mono num">'+(L.pdDays?fmtN(L.pdDays):"")+'</td><td class="mono num">'+(L.lodgeNights?fmtN(L.lodgeNights):"")+"</td>"+(priced?'<td class="mono num">'+(a==null?'<span class="late">No rate</span>':money(a))+"</td>":"")+"</tr>";}).join("")+
    '</tbody><tfoot><tr><td colspan="2" class="num"><b>Total hours</b></td>'+days.map((x,i)=>'<td class="mono num"><b>'+fmtN((d.labor||[]).reduce((a,L)=>{const h=L.h&&L.h[i];return a+(h?(Number(h.st)||0)+(Number(h.ot)||0)+(Number(h.dt)||0):0);},0))+"</b></td>").join("")+
    TE_HRS.map(([k])=>'<td class="mono num"><b>'+fmtN((d.labor||[]).reduce((a,L)=>a+sum(L,k),0))+"</b></td>").join("")+'<td colspan="'+(priced?3:2)+'"></td></tr></tfoot></table></div>';
  const eq='<h2 class="sec">Equipment <span class="sub">(hours)</span></h2>'+((d.equip||[]).length?'<div class="tablebox"><table class="static"><thead><tr><th>Equipment</th><th>Unit #</th><th>Billed as</th>'+dh+'<th class="num">Total</th>'+(priced?'<th class="num">Amount</th>':"")+"</tr></thead><tbody>"+
    d.equip.map(E=>{const ls=pr.lines.filter(l=>l.cat==="Equipment"&&l.who===(E.unitNo?"#"+E.unitNo:"")&&(E.items||[]).includes(l.item));const a=ls.some(l=>l.ext==null)?null:ls.reduce((x,l)=>x+l.ext,0);
      return"<tr><td><b>"+esc(E.desc)+"</b>"+(E.code?' <span class="sub">code '+esc(E.code)+"</span>":"")+'</td><td class="mono">'+esc(E.unitNo||"")+'</td><td class="wrapc">'+((E.items||[]).filter(Boolean).map(esc).join("<br>+ ")||'<span class="late">Not matched</span>')+"</td>"+days.map((x,i)=>'<td class="mono num">'+(Number(E.h&&E.h[i])?fmtN(E.h[i]):"")+"</td>").join("")+'<td class="mono num"><b>'+fmtN((E.h||[]).reduce((s,v)=>s+(Number(v)||0),0))+"</b></td>"+(priced?'<td class="mono num">'+(a==null?'<span class="late">No rate</span>':money(a))+"</td>":"")+"</tr>";}).join("")+"</tbody></table></div>":'<p class="sub">No equipment on this week.</p>');
  const rest=pr.lines.filter(l=>["Per diem","Lodging","Subcontractor"].includes(l.cat));
  const other=priced&&rest.length?'<h2 class="sec">Per diem, lodging &amp; subcontractors</h2><div class="tablebox"><table class="static"><thead><tr><th>Item</th><th>Type</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>'+
    rest.map(l=>"<tr><td>"+esc(l.item)+"</td><td>"+esc(l.type)+'</td><td class="mono num">'+fmtN(l.qty)+'</td><td class="mono num">'+(l.rate==null?'<span class="late">Not set</span>':money(l.rate))+'</td><td class="mono num">'+(l.ext==null?"—":money(l.ext))+"</td></tr>").join("")+"</tbody></table></div>":"";
  return(priced&&pr.errs.length?'<div class="banner bad"><b>Pricing check:</b> '+esc(pr.errs.join(" · "))+"</div>":"")+lab+eq+other+
    (priced?'<div class="okbox" style="margin-top:10px">Week total: <b class="mono">'+(pr.total==null?"Incomplete":money(pr.total))+'</b> <span class="sub">Calculated: Σ hours × hourly rate for each day ('+esc(pr.label)+"), USD</span></div>":"");}
/* billing / CM can add per diem, lodging and subcontractors to a week (not on the weekly sheet) */
function openTeExtras(id){
  const d=S.docs.get(id);if(!d)return;if(d.status===ST.INV){toast("This week is already invoiced.");return;}if(!(can.setup()||canGfSign())){toast("Only billing or a Construction Manager can change this.");return;}
  const subs=JSON.parse(JSON.stringify(d.subs||[]));const showSubs=can.seePrice();
  const m=modal("Per diem, lodging & subcontractors — "+d.no,'<p class="sub" style="margin:0">'+esc(teWeekText(d))+". These aren't on the weekly sheet. Days and nights are per person for the week.</p>"+
    '<div class="tablebox"><table class="static"><thead><tr><th>Name</th><th>Class</th><th class="num">Days worked</th><th class="num">Per diem days</th><th class="num">Lodging nights</th></tr></thead><tbody>'+
    (d.labor||[]).map((L,i)=>{const dw=(L.h||[]).filter(h=>h&&((Number(h.st)||0)+(Number(h.ot)||0)+(Number(h.dt)||0))>0).length;return"<tr><td><b>"+esc(L.name)+"</b></td><td>"+esc(L.role||"")+'</td><td class="mono num">'+dw+'</td><td class="num"><input data-pd="'+i+'" type="number" min="0" max="7" step="1" inputmode="numeric" style="width:80px" value="'+esc(L.pdDays||"")+'"></td><td class="num"><input data-lo="'+i+'" type="number" min="0" max="7" step="1" inputmode="numeric" style="width:80px" value="'+esc(L.lodgeNights||"")+'"></td></tr>';}).join("")+
    '</tbody></table></div><div class="row-inline"><button class="btn" type="button" id="tx-all-pd">Per diem = days worked for everyone</button><button class="btn" type="button" id="tx-all-lo">Lodging = days worked for everyone</button><button class="btn" type="button" id="tx-clr">Clear</button></div>'+
    (showSubs?'<div class="sec-h" style="margin-top:10px">Subcontractors <span class="sub">(cost before markup, USD)</span></div><div id="tx-subs" class="te-rows"></div><button class="btn" type="button" id="tx-add-s" style="margin-top:6px">+ Add subcontractor</button>':""),
    '<button class="btn" type="button" data-x>Cancel</button><button class="btn primary" type="button" id="tx-save">Save</button>',"wide");
  const dw=L=>(L.h||[]).filter(h=>h&&((Number(h.st)||0)+(Number(h.ot)||0)+(Number(h.dt)||0))>0).length;
  m.querySelector("#tx-all-pd").onclick=()=>m.querySelectorAll("[data-pd]").forEach(el=>{el.value=dw(d.labor[+el.dataset.pd]);});
  m.querySelector("#tx-all-lo").onclick=()=>m.querySelectorAll("[data-lo]").forEach(el=>{el.value=dw(d.labor[+el.dataset.lo]);});
  m.querySelector("#tx-clr").onclick=()=>m.querySelectorAll("[data-pd],[data-lo]").forEach(el=>{el.value="";});
  function drawSub(){const box=m.querySelector("#tx-subs");if(!box)return;box.innerHTML=subs.length?subs.map((s,i)=>'<div class="te-row te-sub" data-i="'+i+'"><label class="f">Subcontractor<input data-k="vendor" value="'+esc(s.vendor)+'"></label><label class="f ds">Description<input data-k="desc" value="'+esc(s.desc)+'"></label><label class="f">Cost (USD)<input data-k="amount" type="number" inputmode="decimal" step="0.01" min="0" value="'+esc(s.amount==null?"":s.amount)+'"></label><button class="btn sm danger" type="button" data-rm aria-label="Remove subcontractor">✕</button></div>').join(""):'<p class="sub" style="margin:0">None.</p>';
    box.querySelectorAll(".te-row").forEach(row=>{const s=subs[+row.dataset.i];row.querySelectorAll("[data-k]").forEach(inp=>{inp.oninput=()=>{s[inp.dataset.k]=inp.value;};});row.querySelector("[data-rm]").onclick=()=>{subs.splice(+row.dataset.i,1);drawSub();};});}
  drawSub();const as=m.querySelector("#tx-add-s");if(as)as.onclick=()=>{subs.push({vendor:"",desc:"",amount:""});drawSub();};
  m.querySelector("#tx-save").onclick=e=>busyRun(e.target,m,async()=>{const n=v=>{if(v===""||v==null)return 0;const x=Number(v);if(!isFinite(x)||x<0)throw new Error("Use numbers of 0 or more.");return x;};
    const pd=[...m.querySelectorAll("[data-pd]")].map(el=>n(el.value)),lo=[...m.querySelectorAll("[data-lo]")].map(el=>n(el.value));
    if(pd.concat(lo).some(v=>v>7))throw new Error("Days and nights can't be more than 7 in a week.");
    const sv=[];if(showSubs)for(const s of subs){const v=String(s.vendor||"").trim();if(!v&&(s.amount===""||s.amount==null))continue;if(!v)throw new Error("Enter the subcontractor's name.");const a=n(s.amount);if(!a)throw new Error(v+": enter the cost.");sv.push({vendor:v,desc:String(s.desc||"").trim(),amount:a});}
    if(!canSave())return;
    const ok=await commitDoc(id,x=>{if(x.status===ST.INV)throw new Error("This week is already invoiced.");(x.labor||[]).forEach((L,i)=>{L.pdDays=pd[i]||0;L.lodgeNights=lo[i]||0;});if(showSubs)x.subs=sv;},
      "Per diem "+pd.reduce((a,b)=>a+b,0)+" person-days · lodging "+lo.reduce((a,b)=>a+b,0)+" person-nights"+(showSubs?" · subcontractors "+sv.length:""));if(ok){closeOverlay();toast("Saved");}});}

/* ---------- location complete (T&E jobs): checkbox with required before / after photos, stored on the job location ---------- */
function openTeComplete(jobId,poleId){
  const j=jobById(jobId),p=poleById(j,poleId);if(!j||!p)return;if(!can.newSheet()){canSave();return;}
  const slots={before:{meta:null},after:{meta:null}};
  const m=modal("Mark complete — "+p.esPole+" · "+p.street,'<p class="sub" style="margin:0">'+esc([p.ticket?"Ticket "+p.ticket:"",p.town,p.woJob?"WO "+p.woJob:""].filter(Boolean).join(" · "))+'</p><p style="margin:0">A before and an after photo are required.</p>'+photoSlotsHtml("tc",true)+'<label class="f" for="tc-note">Note (optional)<textarea id="tc-note"></textarea></label>',
    '<button class="btn" type="button" data-x>Cancel</button><button class="btn primary" type="button" id="tc-save">Mark complete</button>',"wide");
  bindPhotoSlots(m,slots);
  m.querySelector("#tc-save").onclick=e=>busyRun(e.target,m,async()=>{const miss=photosMissing(slots);if(miss.length)throw new Error("Add the "+miss.join(" and ")+" photo"+(miss.length>1?"s":"")+".");if(!canSave())return;
    e.target.textContent="Uploading photos…";const photos=await savePhotos(slots);const note=m.querySelector("#tc-note").value.trim();
    await commitIndex(ix=>{const jj=ix.jobs.find(x=>x.id===jobId);const pp=jj&&(jj.poles||[]).find(x=>x.id===poleId);if(!pp)throw new Error("This location was removed.");if(pp.teDone)throw new Error("Someone already marked this location complete.");
      pp.teDone={at:new Date().toISOString(),by:S.me.name,photos,note};(jj.log=jj.log||[]).push({t:new Date().toISOString(),by:S.me.name,text:"Location "+pp.esPole+" ("+pp.street+") marked complete"+(note?": "+note:"")});},"Workflow: location complete");
    closeOverlay();refresh();toast(p.esPole+" marked complete");});}
function openTeUncomplete(jobId,poleId){const j=jobById(jobId),p=poleById(j,poleId);if(!p||!p.teDone)return;
  if(!(canGfSign()||can.setup())){toast("Only a Construction Manager or billing can undo a completed location.",6000);return;}
  confirmBox("Mark "+p.esPole+" not complete?","The before and after photos stay on record in the job history but the location goes back to not complete.","Mark not complete",async n=>{if(!canSave())return;
    await commitIndex(ix=>{const jj=ix.jobs.find(x=>x.id===jobId);const pp=jj&&(jj.poles||[]).find(x=>x.id===poleId);if(!pp||!pp.teDone)return;(pp.teUndone=pp.teUndone||[]).push(Object.assign({},pp.teDone,{undoneAt:new Date().toISOString(),undoneBy:S.me.name,why:n}));delete pp.teDone;
      (jj.log=jj.log||[]).push({t:new Date().toISOString(),by:S.me.name,text:"Location "+pp.esPole+" ("+pp.street+") marked NOT complete: "+n});},"Workflow: location not complete");refresh();toast(p.esPole+" marked not complete");},{note:"Reason",noteReq:true,danger:true});}
function openTePhotos(jobId,poleId){const j=jobById(jobId),p=poleById(j,poleId);if(!p||!p.teDone)return;const ph=p.teDone.photos||{};
  const mm=modal("Photos — "+p.esPole+" · "+p.street,'<div class="ph-grid">'+PHOTO_KINDS.map(([k,l])=>'<figure class="ph-fig"><figcaption><b>'+l+"</b></figcaption>"+(ph[k]?'<img class="ph-big" data-photo="'+esc(JSON.stringify(ph[k]))+'" alt="'+l+' photo">':'<div class="ph-frame"><span class="ph-empty">No '+l.toLowerCase()+" photo</span></div>")+"</figure>").join("")+'</div><p class="sub" style="margin:0">Marked complete by '+esc(p.teDone.by)+" · "+esc(fmtT(p.teDone.at))+(p.teDone.note?" · "+esc(p.teDone.note):"")+"</p>",'<button class="btn primary" type="button" data-x>Close</button>',"wide");fillPhotoImgs(mm);}

/* ---------- T&E job page: locations (complete checkbox), weekly timesheets, CM sign-off ---------- */
function renderTeJob(j){
  const ss=visibleSheets().filter(s=>s.jobId===j.id);const gfList=ss.filter(s=>s.status===ST.SUB).sort((a,b)=>String(a.workDate).localeCompare(String(b.workDate))||String(a.no).localeCompare(String(b.no)));
  if(!S.jobTab)S.jobTab=canGfSign()&&gfList.length?"gf":"locs";const tab=S.jobTab;
  const by=st=>ss.filter(s=>s.status===st).length;const ok=ss.filter(isReady).length,inv=by(ST.INV);const locs=j.poles||[];const nDone=locs.filter(p=>p.teDone).length;const sa=jobStats(j,sheets());
  let appr=0,apprOk=true;ss.filter(s=>isReady(s)||s.status===ST.INV).forEach(s=>{const t=priceSheet(s).total;if(t==null)apprOk=false;else appr+=t;});
  main.innerHTML='<a class="back" href="#overview">← Overview</a>'+
    '<section class="jobhead"><div><h1>'+esc(j.name)+'</h1><div class="meta"><span class="chip c-sch">T&amp;E</span>'+(j.archived?'<span class="chip c-stage">Closed</span>':'<span class="chip c-done">Active</span>')+"<span>"+esc(j.customer)+"</span>"+(j.po?"<span>PO "+esc(j.po)+"</span>":"")+(j.wo?"<span>WO / Job # "+esc(j.wo)+"</span>":"")+(teJobSet(j)?"<span>"+esc(teJobSet(j).name)+(j.teArea&&!teAreaFree(teJobSet(j))?" · "+esc(j.teArea):"")+"</span>":"")+(j.gf?"<span>CM "+esc(j.gf)+"</span>":"")+'</div></div><div class="acts">'+
      (can.newSheet()&&!j.archived?'<button class="btn primary" type="button" id="tj-imp">Upload weekly timesheet (.xlsx)</button>':"")+
      (can.setup()?'<button class="btn" type="button" id="tj-add">+ Add locations</button><button class="btn" type="button" id="tj-roster">Crew roster</button><button class="btn" type="button" id="tj-edit">Edit job</button>':"")+(role()!=="crew"?'<button class="btn" type="button" id="tj-csv">Export CSV</button>':"")+"</div></section>"+
    (!teJobSet(j)&&role()!=="crew"?'<div class="banner">No T&amp;E pricing is picked for this job, so its timesheets can\'t be priced. Pick it with <b>Edit job</b>.</div>':(teJobSet(j)&&!teJobArea(j,teJobSet(j))&&role()!=="crew"?'<div class="banner">'+esc(teJobSet(j).name)+' has different labor rates by service area. Pick the service area with <b>Edit job</b>.</div>':""))+
    (role()!=="crew"&&((j.packages||[]).length||can.setup())?'<div class="pkgbar"><b>Job package</b>'+(j.packages||[]).map((pk,i)=>'<button class="btn sm" type="button" data-pk="'+i+'">'+esc(pk.name)+' <span class="sub">'+fmtSize(pk.size)+"</span></button>").join("")+((j.packages||[]).length?"":'<span class="sub">None uploaded</span>')+(can.setup()?'<button class="btn sm primary" type="button" id="tj-pkg">Upload package</button>':"")+"</div>":"")+
    '<section class="tiles">'+tile("Locations complete",nDone+" / "+locs.length,locs.length?progSub(sa):"No locations yet",false)+shutTile(sa)+tile("Weekly timesheets",ss.length,ss.length?"Latest "+teWeekText(ss.slice().sort((a,b)=>String(b.workDate).localeCompare(String(a.workDate)))[0]):"None yet",false)+tile("Awaiting CM signature",by(ST.SUB),"Weeks to review",by(ST.SUB)>0)+tile("Ready to bill",ok,"Signed by the CM",false)+tile("Invoiced",inv,"On invoices",false)+(can.seePrice()?tile("Approved $",ok+inv?(apprOk?money(appr):"Check"):"$0.00","Ready + invoiced",false):"")+"</section>"+
    '<div class="subtabs" role="tablist"><button role="tab" type="button" id="t-locs" aria-selected="'+(tab==="locs")+'">Locations ('+nDone+"/"+locs.length+')</button><button role="tab" type="button" id="t-sheets" aria-selected="'+(tab==="sheets")+'">Weekly timesheets ('+ss.length+")</button>"+(canGfSign()?'<button role="tab" type="button" id="t-gf" aria-selected="'+(tab==="gf")+'">CM sign-off ('+gfList.length+")</button>":"")+'</div><div id="jbody"></div>';
  const on=(i,fn)=>{const b=document.getElementById(i);if(b)b.onclick=fn;};
  on("t-locs",()=>{S.jobTab="locs";renderJob();});on("t-sheets",()=>{S.jobTab="sheets";renderJob();});on("t-gf",()=>{S.jobTab="gf";renderJob();});
  on("tj-imp",()=>openTeWeekImport(j.id));on("tj-add",()=>openAddLocations(j.id));on("tj-roster",openRoster);on("tj-edit",()=>{location.hash="jobedit-"+j.id;});on("tj-pkg",()=>openAddLocations(j.id,true));
  main.querySelectorAll("[data-pk]").forEach(b=>b.onclick=()=>openPackage(j.packages[+b.dataset.pk],b));
  on("tj-csv",()=>{const L=[["Record","Type","Week start","Week end","Day","Date","Foreman","Name / equipment","Class","Unit #","ST hrs","OT hrs","DT hrs","Equipment hrs","Status","Invoice #","Shutdown","Shutdown date"]];
    ss.slice().sort((a,b)=>String(a.workDate).localeCompare(String(b.workDate))).forEach(s=>{(s.days||[]).forEach((dt,i)=>{(s.labor||[]).forEach(x=>{const h=x.h&&x.h[i];if(h&&(h.st||h.ot||h.dt))L.push([s.no,"Labor",s.weekStart,s.weekEnd,TE_DAYS[i],dt,s.crew,x.name,x.role,"",h.st||0,h.ot||0,h.dt||0,"",ST_LABEL[s.status]||s.status,s.invoiceNo||""]);});
      (s.equip||[]).forEach(x=>{const q=Number(x.h&&x.h[i])||0;if(q)L.push([s.no,"Equipment",s.weekStart,s.weekEnd,TE_DAYS[i],dt,s.crew,x.desc+" → "+(x.items||[]).join(" + "),"",x.unitNo||"","","","",q,ST_LABEL[s.status]||s.status,s.invoiceNo||""]);});});});
    locs.forEach(p=>L.push(["Location","Location",p.esPole,p.street,"","",p.ticket||"",p.teDone?"Complete":"Not complete",p.teDone?p.teDone.by:"",p.teDone?fmtD(p.teDone.at):"","","","","","","",sdOn(p)?"Yes":"",sdOn(p)?p.shutdown.date||"":""]));
    download(new Blob(["﻿"+L.map(r=>r.map(v=>'"'+String(v==null?"":v).replace(/"/g,'""')+'"').join(",")).join("\r\n")],{type:"text/csv"}),"T&E - "+j.name+".csv");});
  const box=document.getElementById("jbody");
  if(tab==="gf"){if(!canGfSign())box.innerHTML='<p class="sub">Only a Construction Manager or admin can sign.</p>';else gfTable(box,gfList,false);return;}
  if(tab==="sheets"){
    const rows=ss.slice().sort((a,b)=>String(b.workDate).localeCompare(String(a.workDate))||ST_ORDER.indexOf(a.status)-ST_ORDER.indexOf(b.status));
    box.innerHTML='<div class="tablebox"><table><thead><tr><th class="nosort">Timesheet #</th><th class="nosort">Week</th><th class="nosort">Foreman</th><th class="nosort">Crew</th>'+(can.seePrice()?'<th class="nosort num">Amount</th>':"")+'<th class="nosort">Status</th></tr></thead><tbody id="tj-sh"></tbody></table></div>';
    const tb=document.getElementById("tj-sh");
    tb.innerHTML=rows.map(s=>{const pr=can.seePrice()?priceSheet(s):null;return'<tr tabindex="0" data-id="'+esc(s.id)+'"><td class="mono"><b>'+esc(s.no)+"</b></td><td>"+esc(teWeekText(s))+"</td><td>"+crewCell(s)+'</td><td class="wrapc">'+esc(teSummary(s))+"</td>"+(pr?'<td class="mono num">'+(pr.total==null?'<span class="sub" title="'+esc(pr.errs.join("; "))+'">Check pricing</span>':money(pr.total))+"</td>":"")+"<td>"+stChip(s)+"</td></tr>";}).join("")||'<tr><td colspan="6"><div class="empty"><b>No weekly timesheets yet</b>'+(can.newSheet()?"Use Upload weekly timesheet (.xlsx).":"")+"</div></td></tr>";
    bindRows(tb,id=>location.hash="sheet-"+id);return;}
  const stf=S.pf.st||"";
  box.innerHTML='<div class="filters" style="margin-bottom:10px"><input type="search" id="pl-q" placeholder="Search street, pole #, ticket…" aria-label="Search locations" value="'+esc(S.pf.q||"")+'"><select id="pl-st" aria-label="Status"><option value="">All</option><option'+(stf==="Complete"?" selected":"")+'>Complete</option><option'+(stf==="Not complete"?" selected":"")+'>Not complete</option><option'+(stf==="Shutdown"?" selected":"")+'>Shutdown</option></select><span class="count" id="pl-count"></span></div>'+
    '<div class="tablebox"><table><thead><tr><th class="nosort">Complete</th><th class="nosort">#</th><th class="nosort">Ticket ID</th><th class="nosort">Town</th><th class="nosort">Street</th><th class="nosort">ES pole #</th><th class="nosort">WO / Job #</th><th class="nosort">Completed</th><th class="nosort">Photos</th><th class="nosort">Shutdown</th></tr></thead><tbody id="pl-body"></tbody></table></div>';
  const qi=document.getElementById("pl-q"),si=document.getElementById("pl-st");qi.oninput=()=>{S.pf.q=qi.value;fill();};si.onchange=()=>{S.pf.st=si.value;fill();};
  function fill(){const qq=(S.pf.q||"").trim().toLowerCase();
    const rows=locs.filter(p=>(!qq||[p.street,p.esPole,p.vzPole,p.ticket,p.town,p.woJob,p.notes].join(" ").toLowerCase().indexOf(qq)>=0)&&(!S.pf.st||(S.pf.st==="Shutdown"?sdOn(p):(S.pf.st==="Complete")===!!p.teDone)));
    document.getElementById("pl-count").textContent=rows.length+" of "+locs.length+" locations · "+nDone+" complete"+(sa.shut?" · "+sa.shut+" shutdown":"");
    const tb=document.getElementById("pl-body");const canTick=can.newSheet()&&!j.archived;
    tb.innerHTML=rows.map(p=>'<tr data-id="'+esc(p.id)+'"><td><label class="te-chk" style="flex-direction:row;gap:8px;padding:0;font-size:13px"><input type="checkbox" data-done="'+esc(p.id)+'"'+(p.teDone?" checked":"")+(canTick?"":" disabled")+' aria-label="'+esc(p.esPole+" "+p.street)+' complete">'+(p.teDone?'<span class="chip c-done">Complete</span>':"")+'</label></td><td class="mono">'+esc(p.n)+'</td><td class="mono">'+esc(p.ticket)+"</td><td>"+esc(p.town)+"</td><td><b>"+esc(p.street)+'</b></td><td class="mono">'+esc(p.esPole)+'</td><td class="mono">'+esc(p.woJob||"")+"</td><td>"+(p.teDone?esc(fmtD(p.teDone.at))+' <span class="sub">'+esc(p.teDone.by)+"</span>":"")+"</td><td>"+(p.teDone?'<button class="btn sm" type="button" data-ph="'+esc(p.id)+'">Before &amp; after</button>':"")+"</td><td>"+shutCell(j,p)+"</td></tr>").join("")||'<tr><td colspan="10"><div class="empty"><b>No locations</b>'+(locs.length?"Nothing matches the filters.":(can.setup()?"Use + Add locations.":"Billing adds the job's locations."))+"</div></td></tr>";
    tb.querySelectorAll("[data-done]").forEach(cb=>cb.onchange=()=>{const pid=cb.dataset.done;cb.checked=!cb.checked;const p=poleById(j,pid);if(p.teDone)openTeUncomplete(j.id,pid);else openTeComplete(j.id,pid);});
    tb.querySelectorAll("[data-ph]").forEach(b=>b.onclick=()=>openTePhotos(j.id,b.dataset.ph));bindShut(tb,j);}
  fill();}

/* ---------- upload the weekly time sheet workbook (.xlsx): one tab per week ---------- */
const TE_CODE_ROLE={GF:"General Foreman",F:"Foreman",LL:"Lead/Head Lineman",L:"Lineman/Splicer",JL:"Journeyman Lineman/Splicer",J:"Journeyman",AP1:"1st Step Apprentice",AP2:"2nd Step Apprentice",AP3:"3rd Step Apprentice",AP4:"4th Step Apprentice",AP5:"5th Step Apprentice",AP6:"6th Step Apprentice",AP7:"7th Step Apprentice",GM:"Groundman",G:"Groundman",OP:"Operator",D:"Driver",DG:"Driver Groundman",FL:"Flagman",S:"Superintendent"};
function parseWeekSheet(aoa,tab){
  const s=v=>String(v==null?"":v).replace(/\s+/g," ").trim();const num=v=>{if(typeof v==="number")return isFinite(v)?v:0;const t=s(v).replace(/,/g,"");return /^-?\d+(\.\d+)?$/.test(t)?+t:0;};
  const row=r=>aoa[r]||[];const find=(re,from,to)=>{for(let r=from||0;r<Math.min(aoa.length,to||aoa.length);r++){const c=row(r).findIndex(v=>re.test(s(v)));if(c>=0)return{r,c};}return null;};
  if(!find(/time sheet/i,0,4))return null;
  const val=(re,r0,r1)=>{for(let r=r0;r<r1;r++){const rw=row(r);for(let c=0;c<rw.length;c++){const t=s(rw[c]);const m=re.exec(t);if(!m)continue;const rest=t.slice(m[0].length).replace(/^[\s:#.-]+/,"").trim();if(rest)return rest;
        for(let k=c+1;k<Math.min(rw.length,c+8);k++){const v=rw[k];if(v==null||s(v)==="")continue;return v;}return"";}}return"";};
  const wk=s(val(/^week/i,1,5));const m=/(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[-–to]+\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/.exec(wk);
  let weekStart=m?xlDate(m[1]):xlDate(wk),weekEnd=m?xlDate(m[2]):"";if(!weekStart){const t=/^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(tab||"");if(t)weekStart=t[3]+"-"+t[1].padStart(2,"0")+"-"+t[2].padStart(2,"0");}
  const head={town:s(val(/^town/i,1,5)),foreman:s(val(/^fore(man|person)/i,1,5)),gf:s(val(/^general fore(man|person)/i,1,5)),project:s(val(/^project\s*#?/i,1,5)),contract:s(val(/^contract\s*#?/i,1,5)),crewNo:s(val(/^crew\s*#/i,1,5)),typeOfWork:s(val(/^type of work/i,1,5)),pct:s(val(/^% complete/i,1,5)),
    signedDate:xlDate(val(/^date/i,1,5)),fwo:s(val(/^field work order/i,3,8)),wo:s(val(/^work order/i,3,8))};
  const lh=find(/^code$/i,4,20);if(!lh||!/name/i.test(s(row(lh.r)[2])))throw new Error("Tab "+tab+": the labor header row (Code / SSN / Name / Class) wasn't found.");
  const hr=row(lh.r);const stCols=[];hr.forEach((v,c)=>{if(/^s\.?\s?t\.?$/i.test(s(v)))stCols.push(c);});
  const totR=find(/^total$/i,3,lh.r);const totC=totR?totR.c:(stCols.length?stCols[stCols.length-1]:99);const gcols=stCols.filter(c=>c<totC).slice(0,6);
  const endL=find(/^n\s*=\s*new/i,lh.r+1);const labor=[];
  for(let r=lh.r+1;r<(endL?endL.r:lh.r+25);r++){const rw=row(r);const name=s(rw[2]);/* columns B (SSN) and E (Pay Rate) are deliberately never read */
    const code=s(rw[0]).toUpperCase(),cls=s(rw[3]);const h=gcols.map(c=>({st:num(rw[c]),ot:num(rw[c+1]),dt:num(rw[c+2])}));const any=h.some(x=>x.st||x.ot||x.dt);if(!name&&!any)continue;
    labor.push({r,code,name,cls,h,tot:totC<99?{st:num(rw[totC]),ot:num(rw[totC+1]),dt:num(rw[totC+2])}:null});}
  const eh=find(/^equipment description/i,lh.r);const equip=[];
  if(eh){const ehr=row(eh.r);const hc=[];ehr.forEach((v,c)=>{if(/^hours$/i.test(s(v)))hc.push(c);});const tc=ehr.findIndex(v=>/^total hours$/i.test(s(v)));const numC=ehr.findIndex(v=>/^equipment number$/i.test(s(v)));const endE=find(/^i\s*=\s*idle/i,eh.r+1);
    for(let r=eh.r+1;r<(endE?endE.r:eh.r+20);r++){const rw=row(r);const desc=s(rw[eh.c]);const h=hc.slice(0,gcols.length).map(c=>num(rw[c]));if(!desc&&!h.some(Boolean))continue;equip.push({r,code:s(rw[0]).toUpperCase(),desc,unitNo:numC>=0?s(rw[numC]):"",h,tot:tc>=0?num(rw[tc]):null});}}
  const cm=find(/^description of work/i,eh?eh.r:lh.r);let comments="";if(cm){comments=s(row(cm.r)[cm.c]).replace(/^description of work or comments:?/i,"").trim();if(!comments){const nx=row(cm.r+1);if(!/^foreman/i.test(s(nx[0])))comments=s(nx.map(s).filter(Boolean).join(" "));}}
  const fm=find(/^foreman:/i,cm?cm.r:lh.r);let custRep="";if(fm){const t=row(fm.r).map(s).filter(Boolean).join(" ");const mm=/customer representative:?\s*(.*)$/i.exec(t);if(mm)custRep=mm[1].trim();}
  const hours=labor.reduce((a,L)=>a+L.h.reduce((x,h)=>x+h.st+h.ot+h.dt,0),0)+equip.reduce((a,E)=>a+E.h.reduce((x,v)=>x+v,0),0);
  return{tab,head,weekStart,weekEnd,days:weekStart?gcols.map((c,i)=>addDays(weekStart,i)):[],labor,equip,comments,custRep,hours};}
function teWeekChecks(W){const out=[];
  W.labor.forEach(L=>{if(!L.tot)return;const sum=k=>L.h.reduce((a,h)=>a+h[k],0);[["st","S.T."],["ot","T.H."],["dt","D.T."]].forEach(([k,l])=>{if(Math.abs(sum(k)-L.tot[k])>1e-9)out.push(W.tab+" · "+(L.name||"row "+(L.r+1))+": "+l+" days add to "+fmtN(sum(k))+" but TOTAL says "+fmtN(L.tot[k]));});
    L.h.forEach((h,i)=>{const t=h.st+h.ot+h.dt;if(t>24)out.push(W.tab+" · "+L.name+": "+fmtN(t)+" hours on "+TE_DAYS[i]);});});
  W.equip.forEach(E=>{const sm=E.h.reduce((a,v)=>a+v,0);if(E.tot!=null&&Math.abs(sm-E.tot)>1e-9)out.push(W.tab+" · "+(E.desc||"equipment row "+(E.r+1))+(E.unitNo?" #"+E.unitNo:"")+": days add to "+fmtN(sm)+" but Total Hours says "+fmtN(E.tot));});
  if(W.weekStart&&new Date(W.weekStart+"T12:00:00Z").getUTCDay()!==1)out.push(W.tab+": the week starts "+fmtD(W.weekStart)+", which isn't a Monday. Days are dated from that date.");return out;}
function openTeWeekImport(jobId){
  const j=jobById(jobId);if(!j||!can.newSheet()){canSave();return;}const set=teJobSet(j);if(!set){toast("Pick the job's T&E pricing first (Edit job).",7000);return;}
  const m=modal("Upload weekly timesheet",'<p class="sub" style="margin:0">Choose the weekly time sheet workbook (.xlsx). Each tab with hours is one week for <b>'+esc(j.name)+'</b>; the 6 day columns are Monday → Saturday from the tab\'s "Week:" start date. T.H. bills as overtime. The SSN and Pay Rate columns are never read. Check everything before it goes to the CM.</p>'+
    '<label class="f" for="tw-file">Weekly time sheet (.xlsx)<input type="file" id="tw-file" accept=".xlsx"></label><label class="f" for="tw-scan">Signed copy (photo or PDF, optional)<input type="file" id="tw-scan" accept="application/pdf,image/*"></label><div id="tw-prev"></div>',
    '<button class="btn" type="button" data-x>Cancel</button><button class="btn primary" type="button" id="tw-save" disabled>Submit to CM</button>',"wide");
  const alias=(S.index&&S.index.teAlias)||{role:{},equip:{}};const roles=teRoleNames(set),items=teEquipNames(set);
  let weeks=[],file=null,st=null;
  const existing=W=>sheets().find(x=>isTe(x)&&x.jobId===j.id&&x.weekStart&&x.weekStart===W.weekStart)||null;
  m.querySelector("#tw-file").onchange=async ev=>{file=ev.target.files[0];if(!file)return;const pv=m.querySelector("#tw-prev");pv.innerHTML='<p class="sub">Reading…</p>';m.querySelector("#tw-save").disabled=true;
    try{const book=await TMPL.tables(await file.arrayBuffer());weeks=[];for(const n of book.names){if(/^lists?$/i.test(n))continue;const W=parseWeekSheet(await book.get(n),n);if(W&&W.hours>0)weeks.push(W);}
      if(!weeks.length)throw new Error("No tab in this workbook has hours entered yet.");}catch(e){weeks=[];pv.innerHTML='<div class="err">'+esc(errText(e))+"</div>";return;}
    st={pick:{},role:{},equip:{},crew:{}};
    weeks.forEach(W=>{const ex=existing(W);st.pick[W.tab]=!ex||ex.status===ST.RET;st.crew[W.tab]=W.head.foreman;
      W.labor.forEach(L=>{const k=teNorm(L.cls);if(k in st.role)return;const known=alias.role[k];const code=TE_CODE_ROLE[k];st.role[k]=known&&roles.some(r=>r.role===known)?known:(roles.some(r=>r.role===L.cls)?L.cls:(code&&roles.some(r=>r.role===code)?code:teSuggest(L.cls,roles.map(r=>r.role))));});
      W.equip.forEach(E=>{const k=teNorm(E.desc);if(k in st.equip)return;const known=alias.equip[k];const ok=v=>items.some(r=>r.item===v);
        st.equip[k]=known&&known.length&&known.every(ok)?known.slice():[ok(E.desc)?E.desc:teSuggest(E.desc,items.map(r=>r.item))].filter(Boolean);});});
    draw();};
  function draw(){const pv=m.querySelector("#tw-prev");const sel=weeks.filter(W=>st.pick[W.tab]);
    const cls=[...new Set(sel.flatMap(W=>W.labor.filter(L=>!/^[VS]$/.test(L.code)&&L.h.some(h=>h.st||h.ot||h.dt)).map(L=>teNorm(L.cls))))];
    const eqs=[...new Set(sel.flatMap(W=>W.equip.filter(E=>E.h.some(Boolean)).map(E=>teNorm(E.desc))))];
    const clsLabel=k=>{for(const W of weeks){const L=W.labor.find(x=>teNorm(x.cls)===k);if(L)return L.cls||"(blank)";}return k;};const eqLabel=k=>{for(const W of weeks){const E=W.equip.find(x=>teNorm(x.desc)===k);if(E)return E.desc||"(blank)";}return k;};
    const ck=sel.flatMap(teWeekChecks);const jw=teNorm(j.wo);const woNote=sel.filter(W=>jw&&W.head.wo&&teNorm(W.head.wo)!==jw&&teNorm(W.head.fwo)!==jw).map(W=>W.tab+": WO "+W.head.wo+" / FWO "+W.head.fwo+" doesn't match the job's WO / Job # "+j.wo);
    const skip=sel.flatMap(W=>W.labor.filter(L=>/^[VS]$/.test(L.code)).map(L=>W.tab+" · "+L.name+" ("+L.code+")"));
    pv.innerHTML='<div class="sec-h" style="margin-top:6px">Weeks found ('+weeks.length+')</div><div class="tablebox"><table class="static"><thead><tr><th>Import</th><th>Tab</th><th>Week (Mon → Sat)</th><th>Foreman</th><th class="num">People</th><th class="num">Labor hrs</th><th class="num">Equip hrs</th><th>Already in the app</th></tr></thead><tbody>'+
      weeks.map(W=>{const ex=existing(W);const lh=W.labor.filter(L=>!/^[VS]$/.test(L.code)).reduce((a,L)=>a+L.h.reduce((x,h)=>x+h.st+h.ot+h.dt,0),0),ehh=W.equip.reduce((a,E)=>a+E.h.reduce((x,v)=>x+v,0),0);const lock=ex&&ex.status!==ST.RET;
        return'<tr><td><input type="checkbox" data-pick="'+esc(W.tab)+'"'+(st.pick[W.tab]?" checked":"")+(lock?" disabled":"")+' aria-label="Import '+esc(W.tab)+'"></td><td class="mono">'+esc(W.tab)+"</td><td>"+(W.weekStart?esc(fmtD(W.days[0])+" – "+fmtD(W.days[W.days.length-1])):'<span class="late">No week date</span>')+'</td><td><input data-crew="'+esc(W.tab)+'" value="'+esc(st.crew[W.tab]||"")+'" style="min-width:140px" aria-label="Foreman"></td><td class="mono num">'+W.labor.filter(L=>!/^[VS]$/.test(L.code)&&L.h.some(h=>h.st||h.ot||h.dt)).length+'</td><td class="mono num">'+fmtN(lh)+'</td><td class="mono num">'+fmtN(ehh)+"</td><td>"+(ex?esc(ex.no)+" · "+stChip(ex)+(ex.status===ST.RET?' <span class="sub">will be replaced</span>':""):"")+"</td></tr>";}).join("")+"</tbody></table></div>"+
      (ck.length?'<div class="banner bad"><b>Check the sheet:</b><br>'+ck.map(esc).join("<br>")+"<br>The day columns are what get billed.</div>":(sel.length?'<div class="okbox">Every row\'s day columns add up to its TOTAL column.</div>':""))+
      (woNote.length?'<div class="banner">'+woNote.map(esc).join("<br>")+"</div>":"")+
      (cls.length?'<div class="sec-h" style="margin-top:10px">Class → '+esc(set.name)+' <span class="sub">(remembered for next time)</span></div>'+cls.map(k=>'<div class="row-inline" style="margin-bottom:6px"><span style="min-width:90px"><b>'+esc(clsLabel(k))+"</b></span>"+roleSelect(st.role[k],roles,' data-role="'+esc(k)+'"')+'<span class="sub">'+esc([...new Set(sel.flatMap(W=>W.labor.filter(L=>teNorm(L.cls)===k).map(L=>L.name)))].join(", "))+"</span></div>").join(""):"")+
      (eqs.length?'<div class="sec-h" style="margin-top:10px">Equipment → '+esc(set.name)+' <span class="sub">(billed by the hour; idle and in-repair included; add a second item for combos like a digger with pole trailer)</span></div>'+eqs.map(k=>{const v=st.equip[k]||[];const units=[...new Set(sel.flatMap(W=>W.equip.filter(E=>teNorm(E.desc)===k).map(E=>E.unitNo).filter(Boolean)))];
          return'<div class="row-inline" style="margin-bottom:6px;flex-wrap:wrap"><span style="min-width:180px"><b>'+esc(eqLabel(k))+'</b> <span class="sub">'+(units.length?"#"+esc(units.join(", #")):"")+"</span></span>"+equipSelect(v[0]||"",set).replace("<select",'<select data-eq="'+esc(k)+'" data-n="0"')+
            (v.length>1?" + "+equipSelect(v[1]||"",set).replace("<select",'<select data-eq="'+esc(k)+'" data-n="1"')+'<button class="btn sm" type="button" data-eq2rm="'+esc(k)+'">Remove 2nd</button>':'<button class="btn sm" type="button" data-eq2="'+esc(k)+'">+ second item</button>')+"</div>";}).join(""):"")+
      (skip.length?'<p class="sub" style="margin-top:8px">Not billed (code V vacation / S sick): '+esc(skip.join("; "))+"</p>":"")+
      '<p class="sub" style="margin-top:8px">Per diem, lodging and subcontractors aren\'t on this sheet; billing adds them on each week after import.</p>';
    pv.querySelectorAll("[data-pick]").forEach(el=>el.onchange=()=>{st.pick[el.dataset.pick]=el.checked;draw();});
    pv.querySelectorAll("[data-crew]").forEach(el=>el.oninput=()=>{st.crew[el.dataset.crew]=el.value;});
    pv.querySelectorAll("[data-role]").forEach(el=>el.onchange=()=>{st.role[el.dataset.role]=el.value;});
    pv.querySelectorAll("[data-eq]").forEach(el=>el.onchange=()=>{const a=st.equip[el.dataset.eq]=st.equip[el.dataset.eq]||[];a[+el.dataset.n]=el.value;});
    pv.querySelectorAll("[data-eq2]").forEach(b=>b.onclick=()=>{const a=st.equip[b.dataset.eq2]=st.equip[b.dataset.eq2]||[];if(!a.length)a.push("");a.push("");draw();});
    pv.querySelectorAll("[data-eq2rm]").forEach(b=>b.onclick=()=>{const a=st.equip[b.dataset.eq2rm]||[];a.length=1;draw();});
    const n=sel.length;const sb=m.querySelector("#tw-save");sb.disabled=!n;sb.textContent=n?"Submit "+n+" week"+(n===1?"":"s")+" to CM":"Pick a week";}
  m.querySelector("#tw-save").onclick=e=>busyRun(e.target,m,async()=>{const sel=weeks.filter(W=>st.pick[W.tab]);if(!sel.length)return;
    for(const W of sel){if(!W.weekStart)throw new Error(W.tab+": the week start date couldn't be read from \"Week:\".");if(!String(st.crew[W.tab]||"").trim())throw new Error(W.tab+": enter the foreman.");
      for(const L of W.labor){if(/^[VS]$/.test(L.code)||!L.h.some(h=>h.st||h.ot||h.dt))continue;if(!L.name)throw new Error(W.tab+": a labor row with hours has no name (row "+(L.r+1)+").");if(!st.role[teNorm(L.cls)])throw new Error("Match the class "+(L.cls||"(blank)")+" ("+L.name+").");
        L.h.forEach((h,i)=>{if(h.st+h.ot+h.dt>24)throw new Error(W.tab+": "+L.name+" has "+fmtN(h.st+h.ot+h.dt)+" hours on "+TE_DAYS[i]+". A day can't be more than 24.");});}
      for(const E of W.equip)if(E.h.some(Boolean)&&!(st.equip[teNorm(E.desc)]||[]).filter(Boolean).length)throw new Error("Match the equipment "+(E.desc||"(blank)")+".");}
    if(!canSave())return;
    e.target.textContent="Uploading files…";const src=await storePackage(file);const scanF=m.querySelector("#tw-scan").files[0];const scan=scanF?await storePackage(scanF):null;
    const names=[...new Set(sel.flatMap(W=>W.labor.filter(L=>L.name&&!/^[VS]$/.test(L.code)).map(L=>L.name)))];
    await commitIndex(ix=>{ix.teAlias=ix.teAlias||{role:{},equip:{}};Object.entries(st.role).forEach(([k,v])=>{if(k&&v)ix.teAlias.role[k]=v;});Object.entries(st.equip).forEach(([k,v])=>{const a=(v||[]).filter(Boolean);if(k&&a.length)ix.teAlias.equip[k]=a;});
      ix.roster=ix.roster||[];names.forEach(n=>{if(!ix.roster.some(p=>p.name.toLowerCase()===n.toLowerCase())){let cls="";for(const W of sel){const L=W.labor.find(x=>x.name===n);if(L){cls=L.cls;break;}}ix.roster.push({id:newId("w-"),name:n,role:st.role[teNorm(cls)]||"",addedBy:S.me.name,addedAt:new Date().toISOString()});}});},"Workflow: weekly timesheet matches and roster");
    const made=[];
    for(const W of sel){e.target.textContent="Saving "+(made.length+1)+" of "+sel.length+"…";
      const labor=W.labor.filter(L=>!/^[VS]$/.test(L.code)&&L.h.some(h=>h.st||h.ot||h.dt)).map(L=>{const p=roster().find(x=>x.name.toLowerCase()===L.name.toLowerCase());return{pid:p?p.id:"",name:L.name,cls:L.cls,code:L.code,role:st.role[teNorm(L.cls)],h:L.h.map(h=>({st:h.st,ot:h.ot,dt:h.dt})),pdDays:0,lodgeNights:0};});
      const equip=W.equip.filter(E=>E.h.some(Boolean)).map(E=>({desc:E.desc,unitNo:E.unitNo,code:E.code,items:(st.equip[teNorm(E.desc)]||[]).filter(Boolean),h:E.h.slice()}));
      const patch={kind:"te",weekly:true,jobId:j.id,poleId:"",poleText:"",weekStart:W.days[0],weekEnd:W.days[W.days.length-1],days:W.days,workDate:W.days[0],crew:String(st.crew[W.tab]).trim(),gf:W.head.gf,wo:W.head.wo,fwo:W.head.fwo,notes:W.comments,labor,equip,subs:[],source:src,scan:scan||undefined,
        imported:{file:file.name,tab:W.tab,town:W.head.town,project:W.head.project,contract:W.head.contract,crewNo:W.head.crewNo,typeOfWork:W.head.typeOfWork,pct:W.head.pct,signedDate:W.head.signedDate,custRep:W.custRep}};
      const sum=teWeekText(patch)+" · "+labor.length+" people · "+fmtN(teHours(patch))+" labor hrs · "+equip.length+" equipment";const ex=existing(W);
      if(ex&&ex.status===ST.RET){const okk=await commitDoc(ex.id,x=>{if(x.status!==ST.RET)throw new Error(x.no+" changed since you opened the upload.");const keep={pd:new Map((x.labor||[]).map(L=>[L.name,[L.pdDays,L.lodgeNights]]))};Object.assign(x,patch);x.labor.forEach(L=>{const k=keep.pd.get(L.name);if(k){L.pdDays=k[0]||0;L.lodgeNights=k[1]||0;}});x.status=ST.SUB;x.submittedAt=new Date().toISOString();},"Replaced from upload "+file.name+" (tab "+W.tab+") and resubmitted: "+sum);if(okk)made.push(ex.id);}
      else{patch.status=ST.SUB;patch.submittedAt=new Date().toISOString();const nid=await createDoc("sheet",patch,"Imported weekly timesheet "+file.name+" (tab "+W.tab+"): "+sum);if(nid)made.push(nid);}}
    closeOverlay();refresh();toast(made.length+" week"+(made.length===1?"":"s")+" submitted to the CM from "+file.name,7000);});}

/* ---------- T&E invoice ---------- */
const TE_CATS=["Labor","Equipment","Per diem","Lodging","Subcontractor"];
function buildTeInvoice(sel){
  const errs=[];const days=sel.slice().sort((a,b)=>String(a.workDate).localeCompare(String(b.workDate))||String(a.no).localeCompare(String(b.no))).map(s=>{const pr=priceTe(s);if(s.hold&&s.hold.on)errs.push(s.no+" is on hold");pr.errs.forEach(e=>errs.push(s.no+": "+e));
    return{sheetId:s.id,no:s.no,date:s.workDate,end:s.weekEnd||"",weekly:!!s.weekly,loc:sheetPoleText(s),locComplete:!!s.locComplete,crew:s.crew,wo:s.wo||"",area:pr.area,year:pr.year,label:pr.label,gfBy:s.gfBy||"",gfAt:s.gfAt||"",lines:pr.lines,total:pr.lines.reduce((a,l)=>a+(l.ext||0),0)};});
  const summary=TE_CATS.map(c=>({cat:c,amount:days.reduce((a,d)=>a+d.lines.filter(l=>l.cat===c).reduce((x,l)=>x+(l.ext||0),0),0)})).filter(x=>x.amount);
  const lab=new Map();days.forEach(d=>d.lines.filter(l=>l.cat==="Labor").forEach(l=>{const k=l.item+"|"+l.type+"|"+l.rate;const e=lab.get(k)||{item:l.item,type:l.type,rate:l.rate,qty:0,ext:0};e.qty+=l.qty;e.ext+=l.ext||0;lab.set(k,e);}));
  const eqm=new Map();days.forEach(d=>d.lines.filter(l=>l.cat==="Equipment").forEach(l=>{const k=l.item+"|"+l.type+"|"+l.rate;const e=eqm.get(k)||{item:l.item,type:l.type,rate:l.rate,qty:0,ext:0};e.qty+=l.qty;e.ext+=l.ext||0;eqm.set(k,e);}));
  const dates=days.map(d=>d.date).filter(Boolean).sort();
  return{kind:"te",days,summary,labor:[...lab.values()],equipment:[...eqm.values()],poles:[],errs:[...new Set(errs)],total:cents(days.reduce((a,d)=>a+d.total,0)),period:dates.length?fmtD(dates[0])+(dates[dates.length-1]!==dates[0]?" – "+fmtD(dates[dates.length-1]):""):""};}
function teInvPreviewHtml(b){
  return'<div class="tablebox"><table class="static"><thead><tr><th>Week / date</th><th>Timesheet</th><th>Location</th><th>Foreman</th><th class="num">Labor hrs</th><th class="num">Amount</th></tr></thead><tbody>'+
    (b.days.map(d=>"<tr><td>"+esc(fmtD(d.date)+(d.end&&d.end!==d.date?" – "+fmtD(d.end):""))+'</td><td class="mono">'+esc(d.no)+"</td><td>"+esc(d.weekly?"—":(d.loc||""))+"</td><td>"+esc(d.crew)+'</td><td class="mono num">'+fmtN(d.lines.filter(l=>l.cat==="Labor").reduce((a,l)=>a+l.qty,0))+'</td><td class="mono num">'+money(d.total)+"</td></tr>").join("")||'<tr><td colspan="6" class="sub">Select at least one timesheet.</td></tr>')+
    '</tbody><tfoot><tr><td colspan="5" class="num"><b>Total (USD) · '+b.days.length+(b.days.length&&b.days[0].weekly?" week"+(b.days.length===1?"":"s"):" day"+(b.days.length===1?"":"s"))+'</b></td><td class="mono num"><b>'+(b.errs.length?"—":money(b.total))+"</b></td></tr></tfoot></table></div>";}
function teInvCoverHtml(i,pv){
  const T=pv?"pv-lines":"static";const n=pv?"num":"mono num";
  return'<table class="'+T+'"><thead><tr><th>Category</th><th class="num">Amount</th></tr></thead><tbody>'+i.summary.map(x=>"<tr><td>"+esc(x.cat)+'</td><td class="'+n+'">'+money(x.amount)+"</td></tr>").join("")+'</tbody><tfoot><tr><td class="num">TOTAL (USD)</td><td class="'+n+'">'+money(i.total)+"</td></tr></tfoot></table>"+
    (i.labor.length?(pv?'<h2 class="pv-h2" style="margin-top:14px">Labor by classification</h2>':'<h2 class="sec">Labor by classification</h2>')+'<table class="'+T+'"><thead><tr><th>Classification</th><th>Hour type</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>'+i.labor.map(x=>"<tr><td>"+esc(x.item)+"</td><td>"+esc(x.type)+'</td><td class="'+n+'">'+fmtN(x.qty)+'</td><td class="'+n+'">'+money(x.rate)+'</td><td class="'+n+'">'+money(x.ext)+"</td></tr>").join("")+"</tbody></table>":"")+
    (i.equipment.length?(pv?'<h2 class="pv-h2" style="margin-top:14px">Equipment</h2>':'<h2 class="sec">Equipment</h2>')+'<table class="'+T+'"><thead><tr><th>Equipment</th><th>Billed by</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>'+i.equipment.map(x=>"<tr><td>"+esc(x.item)+"</td><td>"+esc(x.type)+'</td><td class="'+n+'">'+fmtN(x.qty)+'</td><td class="'+n+'">'+money(x.rate)+'</td><td class="'+n+'">'+money(x.ext)+"</td></tr>").join("")+"</tbody></table>":"");}
function teInvDayHtml(d,pv){const n=pv?"num":"mono num";if(d.weekly)d=Object.assign({},d,{lines:teGroupLines(d.lines)});
  return'<table class="'+(pv?"pv-lines pv-pole":"static")+'"><thead><tr><th colspan="6">'+esc((d.weekly?"WEEK "+fmtD(d.date)+" – "+fmtD(d.end):fmtD(d.date))+"  |  "+d.no+(!d.weekly&&d.loc?"  |  "+d.loc+(d.locComplete?" (COMPLETE)":""):"")+"  |  FOREMAN "+d.crew+(d.wo?"  |  WO #"+d.wo:"")+"  |  "+(d.label||(d.area+" "+d.year+" rates")).toUpperCase())+'</th></tr><tr class="subh"><td>Category</td><td>Description</td><td>Type</td><td class="num">'+(d.weekly?"Hrs / qty":"Qty")+'</td><td class="num">Rate</td><td class="num">Amount</td></tr></thead><tbody>'+
    d.lines.map(l=>"<tr><td>"+esc(l.cat)+"</td><td>"+esc(l.item+(l.who?" — "+l.who:""))+"</td><td>"+esc(l.type)+'</td><td class="'+n+'">'+fmtN(l.qty)+'</td><td class="'+n+'">'+money(l.rate)+'</td><td class="'+n+'">'+money(l.ext)+"</td></tr>").join("")+
    '</tbody><tfoot><tr><td colspan="5">'+esc((d.weekly?"WEEK OF "+fmtD(d.date):fmtD(d.date))+(d.weekly?" TOTAL":" DAY TOTAL"))+(d.gfBy?' <span style="font-weight:400;font-size:10.5px">· CM signed: '+esc(d.gfBy)+"</span>":"")+'</td><td class="'+n+'">'+money(d.total)+"</td></tr></tfoot></table>";}
function renderTeInvoice(i,id){
  const chk=cents(i.days.reduce((a,d)=>a+d.lines.reduce((x,l)=>x+(l.ext||0),0),0));const tieOk=chk===cents(i.total);
  const acts=['<button class="btn primary" type="button" id="v-pdf">P&amp;G T&amp;E invoice PDF</button>'];
  if(can.invoice()&&i.status==="Draft")acts.push('<button class="btn" type="button" id="v-sent">Mark as sent</button>');
  if(can.invoice()&&i.status!=="Void")acts.push('<button class="btn danger" type="button" id="v-void">Void</button>');
  main.innerHTML='<a class="back" href="#invoices">← Invoices</a><section class="jobhead"><div><h1>Invoice '+esc(i.no)+'</h1><div class="meta"><span class="chip c-sch">T&amp;E</span>'+invChip(i.status)+"<span>"+esc(i.jobName)+"</span><span>"+esc(fmtD(i.date))+'</span></div></div><div class="acts">'+acts.join("")+"</div></section>"+
    (tieOk?"":'<div class="banner bad">Day lines total '+money(chk)+" but the saved invoice total is "+money(i.total)+" (variance "+money(cents(chk-i.total))+"). Do not send until this is resolved.</div>")+
    '<section class="details">'+dl("Bill to",esc(i.customer))+dl("Terms",esc(i.terms))+dl("PO#",esc(i.po))+dl("Billing period",esc(i.period))+dl("Billing package",esc(i.pkg))+dl("Invoice total",'<b class="mono">'+money(i.total)+"</b>")+dl("Timesheets",esc(i.days.map(d=>d.no).join(", ")),true)+(i.sentAt?dl("Sent",esc(i.sentBy+" · "+fmtT(i.sentAt))):"")+"</section>"+
    '<h2 class="sec">'+(teIsWeeklyInv(i)?"Breakdown of the invoice total":"T&amp;E billing summary")+'</h2><div class="tablebox">'+(teIsWeeklyInv(i)?teInvBreakdownHtml(i,false):teInvCoverHtml(i,false))+"</div>"+
    (teIsWeeklyInv(i)?'<h2 class="sec">Daily breakdown — labor &amp; equipment hours</h2>'+i.days.map(d=>'<div style="margin-bottom:16px">'+teInvDailyHtml(d,false)+"</div>").join(""):'<h2 class="sec">Daily detail</h2>'+i.days.map(d=>'<div class="tablebox" style="margin-bottom:10px">'+teInvDayHtml(d,false)+"</div>").join(""))+'<h2 class="sec">History</h2>'+histHtml(i);
  document.getElementById("v-pdf").onclick=()=>printTeInvoice(i);
  const s=document.getElementById("v-sent");if(s)s.onclick=()=>confirmBox("Mark "+i.no+" as sent?","Record that this invoice was submitted. Its timesheets drop off the UBL.","Mark sent",async n=>{await commitDoc(id,x=>{x.status="Sent";x.sentAt=new Date().toISOString();x.sentBy=S.me.name;},"Marked sent"+(n?": "+n:""));},{note:"Note"});
  const v=document.getElementById("v-void");if(v)v.onclick=()=>confirmBox("Void invoice "+i.no+"?","Its timesheets go back to Ready to bill so they can be billed again. The voided invoice stays on record.","Void invoice",async n=>{
    const ok=await commitDoc(id,x=>{x.status="Void";x.voidAt=new Date().toISOString();x.voidBy=S.me.name;},"Voided: "+n,true);if(!ok)return;
    for(const sid of i.sheetIds||[]){if(S.index.docs[sid])await commitDoc(sid,x=>{if(x.invoiceId===id){x.status=ST.OK;x.invoiceId="";x.invoiceNo="";}},"Invoice "+i.no+" voided — back to Ready to bill",true);}
    refresh();toast("Invoice "+i.no+" voided");},{note:"Reason",noteReq:true,danger:true});}
function printTeInvoice(i){
  const p=document.getElementById("print");
  const head='<div class="pv-head"><div><img src="pg-logo.jpg" alt="P&amp;G Power Co."><div class="pv-from">'+(i.from||[]).map(esc).join("<br>")+'</div></div><div class="pv-title"><h1>INVOICE</h1><table class="pv-meta"><tr><td>Invoice No.</td><td><b>'+esc(i.no)+"</b></td></tr><tr><td>Invoice Date</td><td>"+esc(fmtD(i.date))+"</td></tr>"+(i.terms?"<tr><td>Terms</td><td>"+esc(i.terms)+"</td></tr>":"")+"<tr><td>Bill To</td><td>"+esc(i.customer)+"</td></tr>"+(i.po?"<tr><td>PO#</td><td>"+esc(i.po)+"</td></tr>":"")+(i.period?"<tr><td>Billing Period</td><td>"+esc(i.period)+"</td></tr>":"")+'</table></div></div><div class="pv-stripe"></div>';
  const rateNote=esc([...new Set(i.days.map(d=>(d.label||"").split(" · ")[0]).filter(Boolean))].join(", ")||"the Eversource T&D MSA, Exhibit B");
  if(teIsWeeklyInv(i)){p.innerHTML='<div class="pv">'+head+'<h2 class="pv-h2">'+esc((i.customer||"").toUpperCase())+" — TIME &amp; EQUIPMENT INVOICE"+(i.jobName?" · "+esc(i.jobName.toUpperCase()):"")+'</h2><h3 class="pv-h3">BREAKDOWN OF THE INVOICE TOTAL</h3>'+teInvBreakdownHtml(i,true)+'<p class="pv-foot">Daily labor and equipment hours follow. Rates per '+rateNote+'.</p>'+
    '<div class="pv-break"></div>'+head+'<h2 class="pv-h2">DAILY BREAKDOWN — LABOR &amp; EQUIPMENT HOURS</h2><p class="pv-foot" style="margin:0 0 6px">Labor cells show straight-time hours, with overtime (OT) and double time (DT) added where worked.</p>'+i.days.map(d=>teInvDailyHtml(d,true)).join("")+"</div>";}
  else p.innerHTML='<div class="pv">'+head+'<h2 class="pv-h2">'+esc((i.customer||"").toUpperCase())+" — TIME &amp; EQUIPMENT BILLING SUMMARY"+(i.jobName?" · "+esc(i.jobName.toUpperCase()):"")+"</h2>"+teInvCoverHtml(i,true)+'<p class="pv-foot">'+(i.days.length&&i.days[0].weekly?"Weekly":"Daily")+' detail follows. Rates per '+esc([...new Set(i.days.map(d=>(d.label||"").split(" · ")[0]).filter(Boolean))].join(", ")||"the Eversource T&D MSA, Exhibit B")+'.</p>'+
    '<div class="pv-break"></div>'+head+'<h2 class="pv-h2">'+(i.days.length&&i.days[0].weekly?"WEEKLY DETAIL":"DAILY DETAIL")+'</h2>'+i.days.map(d=>teInvDayHtml(d,true)).join("")+'<table class="pv-lines"><tfoot><tr><td class="num">INVOICE TOTAL (USD)</td><td class="num" style="width:140px">'+money(i.total)+"</td></tr></tfoot></table></div>";
  document.body.classList.add("printing");const prev=document.title;document.title="P&G T&E Invoice "+i.no;
  const done=()=>{document.body.classList.remove("printing");document.title=prev;window.removeEventListener("afterprint",done);};window.addEventListener("afterprint",done);setTimeout(()=>window.print(),200);}

/* ---------- shared upload helpers ---------- */
const teNorm=v=>String(v==null?"":v).toUpperCase().replace(/[^A-Z0-9]/g,"");
function xlDate(v){if(typeof v==="number"&&v>30000&&v<80000){const d=new Date(Date.UTC(1899,11,30)+Math.round(v)*864e5);return d.toISOString().slice(0,10);}
  const s=String(v==null?"":v).trim();let m=/^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);if(m)return m[1]+"-"+m[2].padStart(2,"0")+"-"+m[3].padStart(2,"0");
  m=/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(s);if(m){const y=m[3].length===2?"20"+m[3]:m[3];return y+"-"+m[1].padStart(2,"0")+"-"+m[2].padStart(2,"0");}return"";}
function teSuggest(text,options){const words=t=>new Set(String(t).toLowerCase().replace(/[^a-z0-9 ]/g," ").split(" ").filter(w=>w.length>1));const a=words(text);if(!a.size)return"";
  let best="",bs=0;options.forEach(o=>{const b=words(o);let n=0;a.forEach(w=>{if(b.has(w))n++;});const sc=n/Math.max(a.size,b.size);if(sc>bs){bs=sc;best=o;}});return bs>=0.34?best:"";}

/* ---------- weekly pay sheet (Western Mass Local 42 template) ----------
   Built from a weekly T&E timesheet: each person's daily ST / OT / DT go into the template's Monday → Sunday columns,
   PD = 1 for each day worked, meals left blank. The template's own formulas compute pay (wage from its SCALES tab × hours,
   OT × 1.5, DT × 2), per diem ($150 per PD) and dues (3%). The app shows the same math before publishing. */
const PAY_DAYS=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const payTpl=()=>(S.index&&S.index.payTpl)||null;
async function parsePayTemplate(buf){
  const book=await TMPL.tables(buf);const sc=book.names.find(n=>/scale/i.test(n));if(!sc)throw new Error('The pay sheet template needs its scales tab (e.g. "SCALES-DO NOT DELETE").');
  const s=v=>String(v==null?"":v).replace(/\s+/g," ").trim();
  const srows=await book.get(sc);const scales=[];srows.forEach((r,i)=>{if(i===0)return;const cls=s(r[1]),w=typeof r[2]==="number"?r[2]:Number(s(r[2]));if(cls&&isFinite(w)&&w>0)scales.push({pos:s(r[0]),cls,wage:w});});
  if(!scales.length)throw new Error("No wages were found on the scales tab (Position / Class / WAGE).");
  let tab="",layout=null;
  for(const n of book.names){if(n===sc)continue;const a=await book.get(n);const hr=a.findIndex(r=>/^name$/i.test(s(r[0]))&&/^class$/i.test(s(r[1])));if(hr<0)continue;
    const days=PAY_DAYS.map(d=>a[hr].findIndex(v=>s(v).toLowerCase()===d.toLowerCase()));if(days.some(c=>c<0))continue;
    const sub=a[hr+1]||[];const okSub=days.every(c=>/^st$/i.test(s(sub[c]))&&/^ot$/i.test(s(sub[c+1]))&&/^dt$/i.test(s(sub[c+2]))&&/^mm$/i.test(s(sub[c+3]))&&/^pd$/i.test(s(sub[c+4])));
    if(!okSub)throw new Error('Tab "'+n+'": each day needs ST / OT / DT / MM / PD columns under it.');
    const dateCol=a[hr].findIndex((v,c)=>c>days[0]&&c<days[1]&&s(v)!=="");
    let last=hr+2;for(let r=hr+2;r<a.length;r++){if(s(a[r][0])||typeof a[r][2]==="number"||s(a[r][2]))last=r;}
    layout={headerRow:hr+1,firstRow:hr+4,lastRow:Math.min(last+1,hr+4+60),days,dateCol};tab=n;break;}
  if(!layout)throw new Error("No pay tab with Name / CLASS and Monday → Sunday columns was found.");
  /* fixes: every row's meals total × $25 and per diem total × $150 (the template had ×20 / ×800 on some rows); clear old typed totals under the table */
  const raw=await TMPL.cells(buf,tab);const a=await book.get(tab);const hr=layout.headerRow-1;const tc=a[hr].findIndex(v=>/^total hrs$/i.test(s(v)));const fix={},notes=[];
  if(tc>=0){const mm=colL(tc+3),pd=colL(tc+4);
    [[mm,25,"meals"],[pd,150,"per diem"]].forEach(([c,k,l])=>{const base=raw.f[c+layout.firstRow];if(!base)return;
      /* write the formula on every row (the template shares one formula down the column, so fixing only the first cell would break the rows that reuse it) */
      for(let r=layout.firstRow;r<=layout.lastRow;r++){const own=raw.f[c+r];const m2=own&&/\*\s*(\d+(?:\.\d+)?)\s*$/.exec(own);if(m2&&+m2[1]!==k)notes.push(c+r+" "+l+" ×"+m2[1]+" → ×"+k+(r<layout.lastRow?" (and the rows that share it)":""));
        fix[c+r]={f:base.replace(new RegExp("([A-Z]+)"+layout.firstRow+"(?![0-9])","g"),"$1"+r).replace(/\*\s*\d+(?:\.\d+)?\s*$/,"*"+k)};}});}
  const pay=a[hr+1]?a[hr+1].findIndex(v=>/^st pay$/i.test(s(v))):-1;
  if(pay>=0)for(let r=layout.lastRow+1;r<=Math.min(a.length,layout.lastRow+8);r++)for(let c=pay;c<pay+8;c++){const ref=colL(c)+r;if(!raw.f[ref]&&typeof raw.v.get(ref)==="number"){fix[ref]="";notes.push(ref+" old typed total "+raw.v.get(ref)+" cleared");}}
  return{tab,scalesTab:sc,scales,layout,fix,fixNotes:notes};}
const colL=n=>{let s="";n++;while(n>0){const m=(n-1)%26;s=String.fromCharCode(65+m)+s;n=Math.floor((n-1)/26);}return s;};
function payClassFor(L){const al=(S.index&&S.index.payAlias)||{};const sc=(payTpl()&&payTpl().scales)||[];const has=c=>sc.some(x=>x.cls===c);const k=teNorm(L.cls);
  if(al[k]&&has(al[k]))return al[k];if(has(L.cls))return L.cls;const d={F:"FM",L:"JL",G:"GM2",GM:"GM2",OP:"OP",D:"DGM",DG:"DGM"}[k];return d&&has(d)?d:"";}
function payRows(d,cls){const sc=payTpl().scales;
  return(d.labor||[]).map((L,i)=>{const c=cls[i];const w=(sc.find(x=>x.cls===c)||{}).wage;const days=(d.days||[]).map((x,k)=>{const h=L.h&&L.h[k]||{};const t=(Number(h.st)||0)+(Number(h.ot)||0)+(Number(h.dt)||0);return{st:Number(h.st)||0,ot:Number(h.ot)||0,dt:Number(h.dt)||0,pd:t>0?1:0};});
    const st=days.reduce((a,x)=>a+x.st,0),ot=days.reduce((a,x)=>a+x.ot,0),dt=days.reduce((a,x)=>a+x.dt,0),pd=days.reduce((a,x)=>a+x.pd,0);
    const stp=w==null?null:w*st,otp=w==null?null:w*1.5*ot,dtp=w==null?null:w*2*dt,tot=w==null?null:stp+otp+dtp;
    return{name:L.name,cls:c,sheetCls:L.cls,wage:w,days,st,ot,dt,pd,stp,otp,dtp,tot,perDiem:pd*150,meals:0,dues:tot==null?null:tot*0.03};});}
function canPaySheet(d){return isTe(d)&&d.weekly&&(role()==="crew"?d.createdByKey===S.myKey:role()!=="viewer");}
function openPaySheet(id){
  const d=S.docs.get(id);if(!d||!canPaySheet(d))return;const tp=payTpl();
  if(!tp){toast(canRates()?"Load the pay sheet template first (Rates tab).":"The pay sheet template hasn't been loaded yet. Ask billing.",7000);return;}
  if(d.labor.length>tp.layout.lastRow-tp.layout.firstRow+1){toast("This week has "+d.labor.length+" people but the pay sheet template has room for "+(tp.layout.lastRow-tp.layout.firstRow+1)+".",8000);return;}
  const prev=d.paySheet;const cls=(d.labor||[]).map((L,i)=>(prev&&prev.rows&&prev.rows[i]&&prev.rows[i].name===L.name&&prev.rows[i].cls)||payClassFor(L));
  const m=modal("Pay sheet — "+teWeekText(d),'<div id="ps-body"></div>',
    (prev?'<button class="btn" type="button" id="ps-dl">Download published pay sheet</button>':"")+'<button class="btn" type="button" data-x>Close</button><button class="btn primary" type="button" id="ps-go">'+(prev?"Republish pay sheet":"Publish pay sheet")+"</button>","wide");
  const opts=tp.scales.map(x=>'<option value="'+esc(x.cls)+'">'+esc(x.cls+" — "+x.pos+" ($"+x.wage.toFixed(2)+")")+"</option>").join("");
  function draw(){const rows=payRows(d,cls);const T=k=>rows.reduce((a,r)=>a+(r[k]||0),0);const miss=rows.filter(r=>r.wage==null);
    m.querySelector("#ps-body").innerHTML=(prev?'<div class="okbox" style="margin:0">Published by '+esc(prev.by)+" · "+esc(fmtT(prev.at))+" · total pay "+money(prev.totals.pay)+". Republishing replaces it.</div>":"")+
      '<p class="sub" style="margin:0">From '+esc(d.no)+": hours by day, PD = 1 for each day worked, no meals. Pay uses the template's scales ("+esc(tp.name)+'): ST × wage, OT × 1.5, DT × 2; per diem $150 per PD day; dues 3% of pay. Check each person\'s pay class.</p>'+
      '<div class="tablebox" style="max-height:52vh;overflow:auto"><table class="static"><thead><tr><th>Name</th><th>Timesheet class</th><th>Pay class</th><th class="num">Wage</th><th class="num">ST</th><th class="num">OT</th><th class="num">DT</th><th class="num">PD</th><th class="num">ST pay</th><th class="num">OT pay</th><th class="num">DT pay</th><th class="num">Total pay</th><th class="num">Per diem</th><th class="num">Dues</th></tr></thead><tbody>'+
      rows.map((r,i)=>"<tr><td><b>"+esc(r.name)+"</b></td><td>"+esc(r.sheetCls)+'</td><td><select data-c="'+i+'" aria-label="Pay class for '+esc(r.name)+'"><option value="">Pick…</option>'+opts.replace('value="'+esc(r.cls)+'"','value="'+esc(r.cls)+'" selected')+'</select></td><td class="mono num">'+(r.wage==null?'<span class="late">—</span>':money(r.wage))+'</td><td class="mono num">'+fmtN(r.st)+'</td><td class="mono num">'+fmtN(r.ot)+'</td><td class="mono num">'+fmtN(r.dt)+'</td><td class="mono num">'+r.pd+'</td><td class="mono num">'+(r.stp==null?"—":money(r.stp))+'</td><td class="mono num">'+(r.otp==null?"—":money(r.otp))+'</td><td class="mono num">'+(r.dtp==null?"—":money(r.dtp))+'</td><td class="mono num"><b>'+(r.tot==null?"—":money(r.tot))+'</b></td><td class="mono num">'+money(r.perDiem)+'</td><td class="mono num">'+(r.dues==null?"—":money(r.dues))+"</td></tr>").join("")+
      '</tbody><tfoot><tr><td colspan="4" class="num"><b>Totals (USD)</b></td><td class="mono num"><b>'+fmtN(T("st"))+'</b></td><td class="mono num"><b>'+fmtN(T("ot"))+'</b></td><td class="mono num"><b>'+fmtN(T("dt"))+'</b></td><td class="mono num"><b>'+T("pd")+'</b></td><td class="mono num">'+(miss.length?"—":money(T("stp")))+'</td><td class="mono num">'+(miss.length?"—":money(T("otp")))+'</td><td class="mono num">'+(miss.length?"—":money(T("dtp")))+'</td><td class="mono num"><b>'+(miss.length?"—":money(T("tot")))+'</b></td><td class="mono num"><b>'+money(T("perDiem"))+'</b></td><td class="mono num"><b>'+(miss.length?"—":money(T("dues")))+"</b></td></tr></tfoot></table></div>"+
      (miss.length?'<div class="banner">Pick a pay class for: '+esc(miss.map(r=>r.name).join(", "))+"</div>":'<div class="okbox" style="margin:0">Total pay '+money(T("tot"))+" + per diem "+money(T("perDiem"))+" = <b>"+money(T("tot")+T("perDiem"))+'</b> <span class="sub">(Calculated; dues '+money(T("dues"))+" are 3% of pay)</span></div>");
    m.querySelectorAll("[data-c]").forEach(el=>el.onchange=()=>{cls[+el.dataset.c]=el.value;draw();});}
  draw();
  const dlb=m.querySelector("#ps-dl");if(dlb)dlb.onclick=()=>openPackage(prev.file,dlb);
  m.querySelector("#ps-go").onclick=e=>busyRun(e.target,m,async()=>{const rows=payRows(d,cls);const miss=rows.filter(r=>r.wage==null);if(miss.length)throw new Error("Pick a pay class for "+miss.map(r=>r.name).join(", ")+".");if(!canSave())return;
    e.target.textContent="Building pay sheet…";const box=await (async()=>{let b;if(hasToken()){const f=await ghGet("data/files/"+tp.file);if(!f)throw new Error("The pay sheet template file is missing.");b=JSON.parse(f.text);}else b=await pagesGet("data/files/"+tp.file);return decJson(S.dek,b);})();
    const L=tp.layout;const ed={};const ws=d.weekStart;const mdY=iso=>{const[y,mo,da]=iso.split("-");return(+mo)+"."+(+da)+"."+y.slice(2);};
    const serial=iso=>Math.round((Date.UTC(+iso.slice(0,4),+iso.slice(5,7)-1,+iso.slice(8,10))-Date.UTC(1899,11,30))/864e5);
    if(L.dateCol>=0)ed[colL(L.dateCol)+L.headerRow]=serial(ws);
    for(let r=L.firstRow;r<=L.lastRow;r++){ed["A"+r]="";ed["B"+r]="";L.days.forEach(c=>{for(let k=0;k<5;k++)ed[colL(c+k)+r]="";});}
    rows.forEach((p,i)=>{const r=L.firstRow+i;ed["A"+r]=p.name;ed["B"+r]=p.cls;p.days.forEach((x,k)=>{const c=L.days[k];if(x.st)ed[colL(c)+r]=x.st;if(x.ot)ed[colL(c+1)+r]=x.ot;if(x.dt)ed[colL(c+2)+r]=x.dt;if(x.pd)ed[colL(c+4)+r]=1;});});
    Object.assign(ed,tp.fix||{});
    const title=tp.title?tp.title.replace(/\d{1,2}\.\d{1,2}\.\d{2,4}/,mdY(ws)):"";if(title)ed["A1"]=title;
    const tabName=mdY(ws)+" TO "+mdY(addDays(ws,6));
    const out=await TMPL.fillCells(unb64(box.b64),tp.tab,ed,tabName);
    const fname=(jobById(d.jobId)||{name:"Job"}).name+" Paysheet "+mdY(ws).replace(/\./g,"-")+".xlsx";
    const fileObj=new File([out],fname,{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
    const meta=await storePackage(fileObj);const T=k=>rows.reduce((a,r)=>a+(r[k]||0),0);
    const rec={file:meta,at:new Date().toISOString(),by:S.me.name,rows:rows.map(r=>({name:r.name,cls:r.cls,wage:r.wage,st:r.st,ot:r.ot,dt:r.dt,pd:r.pd,tot:r.tot})),totals:{pay:T("tot"),perDiem:T("perDiem"),dues:T("dues"),hours:T("st")+T("ot")+T("dt")}};
    await commitIndex(ix=>{ix.payAlias=ix.payAlias||{};const by=new Map();rows.forEach(r=>{const k=teNorm(r.sheetCls);if(!k)return;(by.get(k)||by.set(k,new Set()).get(k)).add(r.cls);});by.forEach((v,k)=>{if(v.size===1)ix.payAlias[k]=[...v][0];});},"Workflow: pay class matches");
    const ok=await commitDoc(id,x=>{x.paySheet=rec;},(prev?"Pay sheet republished: ":"Pay sheet published: ")+fname+" · pay "+money(rec.totals.pay)+" + per diem "+money(rec.totals.perDiem));
    if(ok){download(new Blob([out],{type:fileObj.type}),fname);closeOverlay();toast("Pay sheet published and downloaded");}});}
/* Rates tab: pay sheet template */
function payTplSection(host){const tp=payTpl();const ed=canRates()&&S.canWrite;
  host.innerHTML='<section class="jobhead" style="margin-top:22px"><div><h1 style="font-size:20px">Pay sheet template</h1><div class="meta">'+(tp?"<b>"+esc(tp.name)+"</b> · loaded "+esc(fmtT(tp.at))+" by "+esc(tp.by)+" · tab "+esc(tp.tab)+" · "+tp.scales.length+" pay classes · room for "+(tp.layout.lastRow-tp.layout.firstRow+1)+" people":"Not loaded yet")+'</div></div><div class="acts">'+(tp?'<button class="btn" type="button" id="pt-dl">Download template</button>':"")+(ed?'<button class="btn primary" type="button" id="pt-up">'+(tp?"Replace template":"Load pay sheet template")+"</button>":"")+"</div></section>"+
    (tp?'<div class="tablebox"><table class="static"><thead><tr><th>Class</th><th>Position</th><th class="num">Wage (USD/hr)</th></tr></thead><tbody>'+tp.scales.map(x=>'<tr><td class="mono"><b>'+esc(x.cls)+"</b></td><td>"+esc(x.pos)+'</td><td class="mono num">'+money(x.wage)+"</td></tr>").join("")+'</tbody></table></div><p class="sub">Wages come from the template\'s scales tab. To change them, update the template in Excel and load it again.</p>':"");
  const dl=document.getElementById("pt-dl");if(dl)dl.onclick=()=>openPackage({file:tp.file,name:tp.name},dl);
  const up=document.getElementById("pt-up");if(up)up.onclick=()=>{const m=modal("Load pay sheet template",'<p class="sub" style="margin:0">Choose the pay sheet workbook (.xlsx) with its scales tab and the weekly pay tab (Name / CLASS / Monday → Sunday with ST, OT, DT, MM, PD).</p><label class="f" for="pt-file">Pay sheet template<input type="file" id="pt-file" accept=".xlsx"></label><div id="pt-prev"></div>','<button class="btn" type="button" data-x>Cancel</button><button class="btn primary" type="button" id="pt-save" disabled>Save template</button>',"wide");
    let P=null,f=null;m.querySelector("#pt-file").onchange=async ev=>{f=ev.target.files[0];if(!f)return;const pv=m.querySelector("#pt-prev");try{P=await parsePayTemplate(await f.arrayBuffer());pv.innerHTML='<div class="okbox">Pay tab "'+esc(P.tab)+'" · '+P.scales.length+" pay classes · rows "+P.layout.firstRow+"–"+P.layout.lastRow+"</div>"+(P.fixNotes.length?'<div class="banner"><b>Fixed on every published pay sheet:</b><br>'+P.fixNotes.map(esc).join("<br>")+"</div>":"");m.querySelector("#pt-save").disabled=false;}catch(e){P=null;pv.innerHTML='<div class="err">'+esc(errText(e))+"</div>";}};
    m.querySelector("#pt-save").onclick=e=>busyRun(e.target,m,async()=>{if(!P||!canSave())return;const meta=await storePackage(f);const book=await TMPL.tables(await f.arrayBuffer());const a=await book.get(P.tab);
      await commitIndex(ix=>{ix.payTpl=Object.assign({file:meta.file,name:f.name,at:new Date().toISOString(),by:S.me.name,title:String(a[0]&&a[0][0]||"")},P);},"Workflow: pay sheet template");closeOverlay();refresh();toast("Pay sheet template saved");});};}

/* ---------- T&E invoice layout (weekly timesheets): 1) breakdown of the invoice total, 2) daily labor & equipment hours ---------- */
const teIsWeeklyInv=i=>!!(i.days&&i.days.length&&i.days[0].weekly);
function teInvAll(i){return i.days.flatMap(d=>d.lines||[]);}
function teInvBreakdownHtml(i,pv){
  const n=pv?"num":"mono num",T=pv?"pv-lines":"static";const L=teInvAll(i);const sum=(arr,k)=>arr.reduce((a,l)=>a+(Number(l[k])||0),0);
  const lab=L.filter(l=>l.cat==="Labor"),eq=L.filter(l=>l.cat==="Equipment");
  const rows=[];
  TE_HRS.forEach(([,ab,lb])=>{const x=lab.filter(l=>l.type===ab);if(x.length)rows.push(["Labor",lb,fmtN(sum(x,"qty"))+" hrs",sum(x,"ext")]);});
  const labT=sum(lab,"ext");
  if(eq.length)rows.push(["Equipment","Equipment hours",fmtN(sum(eq,"qty"))+" hrs",sum(eq,"ext")]);
  ["Per diem","Lodging"].forEach(c=>{const x=L.filter(l=>l.cat===c);if(x.length)rows.push([c,c==="Per diem"?"Person-days":"Person-nights",fmtN(sum(x,"qty")),sum(x,"ext")]);});
  const sub=L.filter(l=>l.cat==="Subcontractor");if(sub.length){const c=sub.filter(l=>l.type==="Cost"),mk=sub.filter(l=>l.type==="Markup");rows.push(["Subcontractors","Cost",c.length+" item"+(c.length===1?"":"s"),sum(c,"ext")]);if(mk.length)rows.push(["Subcontractors","Markup","",sum(mk,"ext")]);}
  const total=sum(L,"ext");const tie=cents(total)===cents(i.total);
  const byCls=new Map();lab.forEach(l=>{const k=l.item+"|"+l.type+"|"+l.rate;const e=byCls.get(k)||{item:l.item,type:l.type,rate:l.rate,qty:0,ext:0,who:new Set()};e.qty+=l.qty;e.ext+=l.ext||0;e.who.add(l.who);byCls.set(k,e);});
  const byEq=new Map();eq.forEach(l=>{const k=l.item+"|"+l.rate;const e=byEq.get(k)||{item:l.item,rate:l.rate,qty:0,ext:0,units:new Set()};e.qty+=l.qty;e.ext+=l.ext||0;if(l.who)e.units.add(l.who);byEq.set(k,e);});
  const ord=t=>["ST","OT","DT"].indexOf(t);
  const h2=t=>pv?'<h2 class="pv-h2" style="margin-top:14px">'+t+"</h2>":'<h2 class="sec">'+t+"</h2>";
  return'<table class="'+T+'"><thead><tr><th>Category</th><th>Item</th><th class="num">Quantity</th><th class="num">Amount (USD)</th></tr></thead><tbody>'+
    rows.map((r,k)=>"<tr><td>"+(k&&rows[k-1][0]===r[0]?"":"<b>"+esc(r[0])+"</b>")+"</td><td>"+esc(r[1])+'</td><td class="'+n+'">'+esc(r[2])+'</td><td class="'+n+'">'+money(r[3])+"</td></tr>"+(r[0]==="Labor"&&(!rows[k+1]||rows[k+1][0]!=="Labor")?'<tr class="subh"><td></td><td>Labor subtotal</td><td class="'+n+'">'+fmtN(sum(lab,"qty"))+' hrs</td><td class="'+n+'">'+money(labT)+"</td></tr>":"")).join("")+
    '</tbody><tfoot><tr><td colspan="3" class="num">INVOICE TOTAL (USD)</td><td class="'+n+'">'+money(i.total)+"</td></tr></tfoot></table>"+
    (tie?"":'<p class="late" style="margin:6px 0">The lines add to '+money(total)+", not the saved total "+money(i.total)+" (variance "+money(cents(total-i.total))+"). Do not send until resolved.</p>")+
    (byCls.size?h2("Labor by classification")+'<table class="'+T+'"><thead><tr><th>Classification</th><th>Hour type</th><th class="num">People</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>'+
      [...byCls.values()].sort((a,b)=>a.item.localeCompare(b.item)||ord(a.type)-ord(b.type)).map(x=>"<tr><td>"+esc(x.item)+"</td><td>"+esc(x.type)+'</td><td class="'+n+'">'+x.who.size+'</td><td class="'+n+'">'+fmtN(x.qty)+'</td><td class="'+n+'">'+money(x.rate)+'</td><td class="'+n+'">'+money(x.ext)+"</td></tr>").join("")+
      '</tbody><tfoot><tr><td colspan="3" class="num">Labor total</td><td class="'+n+'">'+fmtN(sum(lab,"qty"))+'</td><td></td><td class="'+n+'">'+money(labT)+"</td></tr></tfoot></table>":"")+
    (byEq.size?h2("Equipment by rate item")+'<table class="'+T+'"><thead><tr><th>Equipment</th><th class="num">Units</th><th class="num">Hours</th><th class="num">Hourly rate</th><th class="num">Amount</th></tr></thead><tbody>'+
      [...byEq.values()].sort((a,b)=>a.item.localeCompare(b.item)).map(x=>"<tr><td>"+esc(x.item)+'</td><td class="'+n+'">'+(x.units.size||"")+'</td><td class="'+n+'">'+fmtN(x.qty)+'</td><td class="'+n+'">'+money(x.rate)+'</td><td class="'+n+'">'+money(x.ext)+"</td></tr>").join("")+
      '</tbody><tfoot><tr><td colspan="2" class="num">Equipment total</td><td class="'+n+'">'+fmtN(sum(eq,"qty"))+'</td><td></td><td class="'+n+'">'+money(sum(eq,"ext"))+"</td></tr></tfoot></table>":"");}
function teInvDailyHtml(d,pv){
  const n=pv?"num":"mono num",T=pv?"pv-lines pv-hrs":"static";const days=Array.from({length:6},(_,k)=>addDays(d.date,k));const L=d.lines||[];
  const hd=days.map((x,k)=>'<th class="num">'+TE_DAYS[k]+"<br>"+esc(fmtD(x).replace(/\/\d{4}$/,""))+"</th>").join("");
  const people=[];L.filter(l=>l.cat==="Labor").forEach(l=>{let p=people.find(x=>x.who===l.who);if(!p){p={who:l.who,item:l.item,h:days.map(()=>({ST:0,OT:0,DT:0}))};people.push(p);}const k=days.indexOf(l.date);if(k>=0)p.h[k][l.type]+=l.qty;});
  const cell=h=>{const t=[h.ST?fmtN(h.ST):"",h.OT?fmtN(h.OT)+" OT":"",h.DT?fmtN(h.DT)+" DT":""].filter(Boolean);return t.join(" + ");};
  const tot=(p,k)=>p.h.reduce((a,h)=>a+h[k],0);const dayTot=k=>people.reduce((a,p)=>a+p.h[k].ST+p.h[k].OT+p.h[k].DT,0);
  const eq=[];L.filter(l=>l.cat==="Equipment").forEach(l=>{let e=eq.find(x=>x.item===l.item);if(!e){e={item:l.item,units:new Set(),h:days.map(()=>0)};eq.push(e);}if(l.who)e.units.add(l.who);const k=days.indexOf(l.date);if(k>=0)e.h[k]+=l.qty;});
  const title=esc("WEEK "+fmtD(d.date)+" – "+fmtD(d.end)+"  |  "+d.no+"  |  FOREMAN "+d.crew+(d.wo?"  |  WO #"+d.wo:""));
  return(pv?'<div class="pv-pole"><h3 class="pv-h3">'+title+"</h3>":'<p class="sub" style="margin:4px 0 6px"><b>'+title+"</b></p>")+
    '<div'+(pv?"":' class="tablebox"')+'><table class="'+T+'"><thead><tr><th>Labor — name</th><th>Classification</th>'+hd+'<th class="num">ST</th><th class="num">OT</th><th class="num">DT</th><th class="num">Total</th></tr></thead><tbody>'+
    people.map(p=>"<tr><td>"+esc(p.who)+"</td><td>"+esc(p.item)+"</td>"+p.h.map(h=>'<td class="'+n+'">'+esc(cell(h))+"</td>").join("")+["ST","OT","DT"].map(k=>'<td class="'+n+'">'+(tot(p,k)?fmtN(tot(p,k)):"")+"</td>").join("")+'<td class="'+n+'"><b>'+fmtN(tot(p,"ST")+tot(p,"OT")+tot(p,"DT"))+"</b></td></tr>").join("")+
    '</tbody><tfoot><tr><td colspan="2">Labor hours ('+people.length+" people)</td>"+days.map((x,k)=>'<td class="'+n+'">'+(dayTot(k)?fmtN(dayTot(k)):"")+"</td>").join("")+["ST","OT","DT"].map(k=>'<td class="'+n+'">'+fmtN(people.reduce((a,p)=>a+tot(p,k),0))+"</td>").join("")+'<td class="'+n+'">'+fmtN(people.reduce((a,p)=>a+tot(p,"ST")+tot(p,"OT")+tot(p,"DT"),0))+"</td></tr></tfoot></table></div>"+
    (eq.length?'<div'+(pv?' style="margin-top:8px"':' class="tablebox" style="margin-top:8px"')+'><table class="'+T+'"><thead><tr><th>Equipment — rate item</th><th class="num">Units</th>'+hd+'<th class="num">Total hrs</th></tr></thead><tbody>'+
      eq.map(e=>"<tr><td>"+esc(e.item)+'</td><td class="'+n+'">'+(e.units.size||"")+"</td>"+e.h.map(v=>'<td class="'+n+'">'+(v?fmtN(v):"")+"</td>").join("")+'<td class="'+n+'"><b>'+fmtN(e.h.reduce((a,v)=>a+v,0))+"</b></td></tr>").join("")+
      '</tbody><tfoot><tr><td colspan="2">Equipment hours</td>'+days.map((x,k)=>'<td class="'+n+'">'+(eq.reduce((a,e)=>a+e.h[k],0)?fmtN(eq.reduce((a,e)=>a+e.h[k],0)):"")+"</td>").join("")+'<td class="'+n+'">'+fmtN(eq.reduce((a,e)=>a+e.h.reduce((x,v)=>x+v,0),0))+"</td></tr></tfoot></table></div>":"")+(pv?"</div>":"");}

/* ---------- Timesheets tab: every submitted T&E timesheet across jobs ---------- */
function renderTimesheets(){
  const f=S.tsf||(S.tsf={q:"",job:"",st:"",pay:""});const all=visibleSheets().filter(isTe);const priced=can.seePrice();
  const jl=jobs().filter(j=>isTeJob(j)||all.some(s=>s.jobId===j.id));
  const by=st=>all.filter(s=>s.status===st).length;
  main.innerHTML='<section class="jobhead"><div><h1>Timesheets</h1><div class="meta"><span>Every submitted T&amp;E timesheet, all jobs</span></div></div></section>'+
    '<section class="tiles">'+tile("Timesheets",all.length,all.length?"Latest "+teWeekText(all.slice().sort((a,b)=>String(b.workDate).localeCompare(String(a.workDate)))[0]):"None yet",false)+tile("Awaiting CM signature",by(ST.SUB),"To review",by(ST.SUB)>0)+tile("Returned to field",by(ST.RET),"Need a corrected upload",by(ST.RET)>0)+tile("Ready to bill",all.filter(isReady).length,"Signed by the CM",false)+tile("Invoiced",by(ST.INV),"On invoices",false)+tile("Pay sheets",all.filter(s=>s.paySheet).length+" / "+all.length,"Published",false)+"</section>"+
    '<div class="filters"><input type="search" id="ts-q" placeholder="Search timesheet #, foreman, WO, person…" aria-label="Search timesheets" value="'+esc(f.q)+'">'+
    '<select id="ts-job" aria-label="Job"><option value="">All jobs</option>'+jl.map(j=>'<option value="'+esc(j.id)+'"'+(j.id===f.job?" selected":"")+">"+esc(j.name)+"</option>").join("")+"</select>"+
    '<select id="ts-st" aria-label="Status"><option value="">All statuses</option>'+[ST.SUB,ST.RET,"ready",ST.INV].map(x=>'<option value="'+x+'"'+(x===f.st?" selected":"")+">"+esc(x==="ready"?"Ready to bill":ST_LABEL[x]||x)+"</option>").join("")+"</select>"+
    '<select id="ts-pay" aria-label="Pay sheet"><option value="">Pay sheet: any</option><option value="yes"'+(f.pay==="yes"?" selected":"")+'>Published</option><option value="no"'+(f.pay==="no"?" selected":"")+'>Not published</option></select><span class="count" id="ts-count"></span><button class="btn" type="button" id="ts-csv">Export CSV</button></div>'+
    '<div class="tablebox"><table><thead><tr><th class="nosort">Timesheet #</th><th class="nosort">Job</th><th class="nosort">Week</th><th class="nosort">Foreman</th><th class="nosort">Crew</th>'+(priced?'<th class="nosort num">Amount</th>':"")+'<th class="nosort">Status</th><th class="nosort">Pay sheet</th><th class="nosort">Invoice</th><th class="nosort">Submitted</th></tr></thead><tbody id="ts-body"></tbody></table></div>';
  const rows=()=>{const q=f.q.trim().toLowerCase();return all.filter(s=>(!f.job||s.jobId===f.job)&&(!f.st||(f.st==="ready"?isReady(s):s.status===f.st))&&(!f.pay||(f.pay==="yes")===!!s.paySheet)&&
      (!q||[s.no,s.crew,s.gf,s.wo,s.fwo,(jobById(s.jobId)||{}).name,s.invoiceNo,(s.labor||[]).map(L=>L.name).join(" ")].join(" ").toLowerCase().indexOf(q)>=0))
    .sort((a,b)=>String(b.workDate).localeCompare(String(a.workDate))||String(b.no).localeCompare(String(a.no)));};
  function fill(){const list=rows();document.getElementById("ts-count").textContent=list.length+" of "+all.length;
    const tb=document.getElementById("ts-body");
    tb.innerHTML=list.map(s=>{const j=jobById(s.jobId);const pr=priced?priceSheet(s):null;return'<tr tabindex="0" data-id="'+esc(s.id)+'"><td class="mono"><b>'+esc(s.no)+"</b></td><td>"+esc(j?j.name:"")+"</td><td>"+esc(teWeekText(s))+"</td><td>"+crewCell(s)+'</td><td class="wrapc">'+esc(teSummary(s))+"</td>"+
      (pr?'<td class="mono num">'+(pr.total==null?'<span class="sub" title="'+esc(pr.errs.join("; "))+'">Check pricing</span>':money(pr.total))+"</td>":"")+"<td>"+stChip(s)+"</td><td>"+(s.paySheet?'<span class="chip c-done">Published</span>':'<span class="sub">—</span>')+'</td><td class="mono">'+esc(s.invoiceNo||"")+'</td><td class="sub">'+esc((s.createdBy||"")+" · "+fmtD((s.submittedAt||s.createdAt||"").slice(0,10)))+"</td></tr>";}).join("")||
      '<tr><td colspan="10"><div class="empty"><b>'+(all.length?"No timesheets match the filters":"No timesheets yet")+"</b>"+(all.length?"":"Weekly timesheets appear here once they're uploaded on a T&amp;E job.")+"</div></td></tr>";
    bindRows(tb,id=>location.hash="sheet-"+id);}
  const on=(id,ev,fn)=>{document.getElementById(id)[ev]=fn;};
  on("ts-q","oninput",e=>{f.q=e.target.value;fill();});on("ts-job","onchange",e=>{f.job=e.target.value;fill();});on("ts-st","onchange",e=>{f.st=e.target.value;fill();});on("ts-pay","onchange",e=>{f.pay=e.target.value;fill();});
  on("ts-csv","onclick",()=>{const L=[["Timesheet #","Job","Week start","Week end","Foreman","General Foreman","WO","FWO","People","Labor hrs","Equipment"].concat(priced?["Amount (USD)"]:[]).concat(["Status","Pay sheet","Invoice #","Submitted by","Submitted"])];
    rows().forEach(s=>{const pr=priced?priceSheet(s):null;L.push([s.no,(jobById(s.jobId)||{}).name||"",s.weekStart||s.workDate||"",s.weekEnd||"",s.crew,s.gf||"",s.wo||"",s.fwo||"",(s.labor||[]).length,teHours(s),(s.equip||[]).length].concat(priced?[pr.total==null?"":cents(pr.total)]:[]).concat([ST_LABEL[s.status]||s.status,s.paySheet?"Published":"",s.invoiceNo||"",s.createdBy||"",(s.submittedAt||s.createdAt||"").slice(0,10)]));});
    download(new Blob(["﻿"+L.map(r=>r.map(v=>'"'+String(v==null?"":v).replace(/"/g,'""')+'"').join(",")).join("\r\n")],{type:"text/csv"}),"Timesheets.csv");});
  fill();}
