/**
 * The GoHighLevel snippet (rev 812 §5, rev 815 §5; rev 837: blocks marked by CSS class). The member pastes it into a Custom
 * Code element on their registration page and on the thank-you page. It reads ?mf=<code>, asks HelixOS for that person's page,
 * and fills the blocks the member marked with classes: the page shows its own default copy straight away and the personal
 * version swaps in when it arrives; with no code or a failed fetch nothing changes and the form stays empty. It fills the form
 * by its field names, keeps the code in this one site's session for the thank-you page, puts it in a hidden mf_code field for
 * GoHighLevel's workflow webhook, and sends its own quiet signal on submit as the backup. Every rule is under one wrapper class.
 */

/** The classes a member puts on GoHighLevel blocks, and what each holds. */
export const MF_CLASSES: { cls: string; what: string }[] = [
  { cls: "mf-header", what: "The headline" },
  { cls: "mf-subheader", what: "The line under it" },
  { cls: "mf-cta", what: "The register button's words" },
  { cls: "mf-when", what: "The date and time, from the webinar" },
  { cls: "mf-why-you", what: "Three bullets (a list, or three text blocks inside it)" },
  { cls: "mf-pillar-p1 / -p2 / -p3", what: "Each pillar block, reordered for them; a text inside marked mf-pillar-line gets their line" },
  { cls: "mf-example-title / mf-example", what: "\"What this looks like for…\" and the example, labelled Example" },
  { cls: "mf-proof-<proof id>", what: "Each proof block; theirs move first" },
  { cls: "mf-objection / mf-answer", what: "Their likely doubt, answered" },
  { cls: "mf-agenda-a1, -a2…", what: "Agenda items; theirs is marked mf-highlight, with mf-agenda-why inside filled" },
  { cls: "mf-urgency / mf-emotional / mf-logical", what: "The three paragraphs" },
  { cls: "mf-ticket-title / mf-bring", what: "On the thank-you page: the title and what to bring" },
];

/** The snippet for one member, pointing at this HelixOS. Plain JavaScript, no libraries, no personal data in it. */
export function mfSnippet(apiBase: string): string {
  const api = `${apiBase.replace(/\/+$/, "")}/api/mf/`;
  return `<!-- HelixOS Magic funnel. Paste into a Custom Code element on the registration page and on the thank-you page. -->
<style>
.hx-mf{max-width:100%;display:none}
.hx-mf-ready .mf-highlight{outline:2px solid currentColor;outline-offset:4px;border-radius:6px}
</style>
<div class="hx-mf" aria-hidden="true"></div>
<script>
(function(){
  var API=${JSON.stringify(api)};
  var KEY="hx_mf";
  var q=new URLSearchParams(location.search);
  var code=q.get("mf");
  try{ if(code){sessionStorage.setItem(KEY,code);} else {code=sessionStorage.getItem(KEY);} }catch(e){}
  if(!code||!/^[A-Za-z0-9_-]{43}$/.test(code)) return;
  var all=function(sel){return Array.prototype.slice.call(document.querySelectorAll(sel));};
  var text=function(cls,value){ if(value==null||value==="") return; all("."+cls).forEach(function(el){ var t=el.querySelector("h1,h2,h3,h4,h5,p,span")||el; t.innerText=String(value); }); };
  var list=function(cls,items){ if(!items||!items.length) return; all("."+cls).forEach(function(el){ var li=el.querySelectorAll("li"); var kids=li.length?li:el.children; if(kids.length>=items.length){ for(var i=0;i<kids.length;i++){ if(i<items.length){kids[i].innerText=items[i];kids[i].style.display="";} else {kids[i].style.display="none";} } } else { el.innerText=items.join("\\n"); } }); };
  var reorder=function(prefix,ids){ var blocks=ids.map(function(id){return document.querySelector("."+prefix+id);}).filter(Boolean); if(!blocks.length) return; var parent=blocks[0].parentNode; var anchor=parent.firstChild; blocks.forEach(function(b){ if(b.parentNode===parent){ parent.insertBefore(b,anchor); anchor=b.nextSibling; } }); };
  var setField=function(names,value){ if(!value) return; names.forEach(function(n){ all('input[name="'+n+'"]').forEach(function(inp){ if(inp.value) return; var proto=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value"); if(proto&&proto.set){proto.set.call(inp,value);} else {inp.value=value;} inp.dispatchEvent(new Event("input",{bubbles:true})); inp.dispatchEvent(new Event("change",{bubbles:true})); }); }); };
  var hidden=function(){ all('input[name="mf_code"]').forEach(function(inp){ inp.value=code; inp.dispatchEvent(new Event("input",{bubbles:true})); }); };
  var fill=function(d){
    if(d.webinar&&d.webinar.when) text("mf-when",d.webinar.when);
    if(d.confirmation){ text("mf-ticket-title",d.confirmation.ticket_title); list("mf-bring",d.confirmation.bring); }
    if(d.prefill){ setField(["first_name","firstName","name"],d.prefill.first_name); setField(["last_name","lastName"],d.prefill.last_name); setField(["email"],d.prefill.email); setField(["phone"],d.prefill.phone); }
    hidden();
    var s=d.sections; if(!s) return;
    text("mf-header",s.hero.header); text("mf-subheader",s.hero.subheader); text("mf-cta",s.hero.cta_label);
    list("mf-why-you",s.why_you);
    reorder("mf-pillar-",s.pillars.order);
    s.pillars.order.forEach(function(id){ var line=s.pillars.lines[id]; all(".mf-pillar-"+id+" .mf-pillar-line").forEach(function(el){el.innerText=line;}); });
    text("mf-example-title",s.example.title); text("mf-example",s.example.label+": "+s.example.text);
    reorder("mf-proof-",(s.proof||[]).map(function(p){return p.id;}));
    text("mf-objection",s.objection.objection); text("mf-answer",s.objection.answer);
    if(s.agenda&&s.agenda.id){ all(".mf-agenda-"+s.agenda.id).forEach(function(el){ el.classList.add("mf-highlight"); var w=el.querySelector(".mf-agenda-why"); if(w) w.innerText=s.agenda.why; }); }
    text("mf-urgency",s.urgency); text("mf-emotional",s.emotional); text("mf-logical",s.logical);
    text("mf-ticket-title",s.confirmation.ticket_title); list("mf-bring",s.confirmation.bring);
    document.documentElement.classList.add("hx-mf-ready");
  };
  var tries=0;
  var load=function(){ fetch(API+code,{credentials:"omit",cache:"no-store"}).then(function(r){return r.ok?r.json():null;}).then(function(d){ if(!d) return; if(d.state==="personal"&&d.ready===false&&tries++<6){ if(d.prefill){fill({prefill:d.prefill,webinar:d.webinar});} setTimeout(load,1500); return; } fill(d); }).catch(function(){}); };
  if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",load);} else {load();}
  document.addEventListener("submit",function(){ hidden(); try{ navigator.sendBeacon(API+code+"/registered",""); }catch(e){} },true);
})();
</script>`;
}
