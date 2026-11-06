(()=>{
 const root=document.getElementById('kt-panel-companion-v8');
 const $=s=>root.querySelector(s), surface=$('.rf-surface'), content=$('.rf-content'), footer=$('.rf-footer'), stage=$('.rf-stage'), win=$('.rf-window'), field=$('.rf-writing'), send=$('.rf-send'), reveal=$('.rf-reveal'), contextButton=$('.rf-context-button'), canvas=$('canvas'), ctx=canvas.getContext('2d');
 const source='panel-v8-'+Math.random().toString(36).slice(2), media=matchMedia('(prefers-reduced-motion: reduce)');
 let systemReduced=media.matches;
 const questions=[
  {id:'timing',case:'TRN-042',text:'Did traffic return right after the reset?',why:'The missing timing changes whether we record an immediate recovery or a later one.',rows:[['Observed','Link up after an SFP change, but no traffic. Optics normal.'],['Proposed','Forwarding-state issue; inspect counters.'],['Attempted','Interface reset.'],['Reported','Traffic returned. Exact timing unknown.']],caveat:'Timing alone won’t prove the cause or a lasting fix.'},
  {id:'revision',case:'TRN-042',text:'Was this the older controller revision?',why:'The revision changes which equipment history we compare with this incident.',rows:[['Known','This report does not identify the controller revision.'],['Needed','Confirm the revision from the equipment record.']],caveat:'A matching revision would not establish the cause.'}
 ];
 const allowedViews=['input','question','queue','settings','receipt','collapsed'];
 const state={view:'question',panelOpen:true,lastOpen:'question',openNode:null,expanded:false,active:'timing',answers:{},deferred:[],points:false,reduced:false};
 let attachments=[],undo=null,receipt=null,revealTimer=0,reservedStage=0,reservedWidth=0,animation=0,idleTimer=0,idlePose=0,visible=true,avatarMode='idle',lastFrame=0;
 const views=[...root.querySelectorAll('.rf-view')];
 const motion=createPanelMotion({surface,skin:$('.rf-motion-skin'),content,footer,canvas,reveal,history:()=>$('.rf-history'),naturalHeight:()=>{const v=views.find(n=>!n.hidden);return (v?.getBoundingClientRect().height||0)+footer.getBoundingClientRect().height+2;},reduced:()=>state.reduced||systemReduced});
 const activeQuestion=()=>questions.find(q=>q.id===state.active)||questions[0];
 function restore(saved){if(!saved||saved.version!==8)return;const s=saved.state||{};state.view=allowedViews.includes(s.view)&&!['receipt','collapsed'].includes(s.view)?s.view:'input';state.panelOpen=s.panelOpen!==false;state.lastOpen=allowedViews.includes(s.lastOpen)&&!['receipt','collapsed'].includes(s.lastOpen)?s.lastOpen:'input';state.openNode=typeof s.openNode==='string'?s.openNode:null;state.expanded=!!s.expanded;state.active=questions.some(q=>q.id===s.active)?s.active:'timing';state.answers={};for(const q of questions)if(['yes','no','unknown','dismiss'].includes(s.answers?.[q.id]))state.answers[q.id]=s.answers[q.id];state.deferred=Array.isArray(s.deferred)?s.deferred.filter(id=>questions.some(q=>q.id===id)):[];state.points=!!s.points;state.reduced=!!s.reduced;}
 restore(window.openai?.widgetState?.privateContent?.panelV8);
 function snapshot(){return {version:8,state:{...state,answers:{...state.answers},deferred:[...state.deferred]}};}
 function save(){window.openai?.setWidgetState?.({modelContent:{panelV8:{view:state.view,openNode:state.openNode,answers:state.answers,expanded:state.expanded,points:state.points}},privateContent:{panelV8:snapshot(),panelV8Source:source}})?.catch(()=>{});}
 // Exact v006 art; only its white scene background is omitted for the transparent perch.
 const kit=createMinimalKit(), raw=document.createElement('canvas');raw.width=raw.height=96;
 const rawCtx=raw.getContext('2d');rawCtx.imageSmoothingEnabled=false;
 const transparentCtx={get fillStyle(){return rawCtx.fillStyle;},set fillStyle(v){rawCtx.fillStyle=v;},clearRect(...a){rawCtx.clearRect(...a);},fillRect(x,y,w,h){if(x===0&&y===0&&w===96&&h===96)return;rawCtx.fillRect(x,y,w,h);}};
 const stateActs=createCompactStateActs({kit}), coreActs=createCompactCoreActs({kit});
 const isReduced=()=>state.reduced||systemReduced;
 // Keep the original question glyph while the existing three-pose body idles.
 // Extract it from the accepted artwork instead of authoring a new sprite.
 const questionGlyph=document.createElement('canvas');questionGlyph.width=5;questionGlyph.height=7;
 stateActs.question.render(transparentCtx,stateActs.question.stillFrame);
 questionGlyph.getContext('2d').drawImage(raw,64,50,5,7,0,0,5,7);
 const hasQuestion=()=>state.panelOpen&&state.view==='question';
 const canAnimate=()=>!isReduced()&&visible&&!document.hidden;
 function draw(act,frame){act.render(transparentCtx,frame);if(hasQuestion()&&act!==stateActs.question)rawCtx.drawImage(questionGlyph,64,50);ctx.clearRect(0,0,44,44);ctx.imageSmoothingEnabled=false;ctx.drawImage(raw,26,42,44,44,0,0,44,44);lastFrame=frame;}
 function stop(){cancelAnimationFrame(animation);clearTimeout(idleTimer);animation=0;idleTimer=0;}
 function rest(){
  stop();avatarMode='idle3';idlePose=0;draw(coreActs.idle3,0);
  canvas.setAttribute('aria-label',hasQuestion()?'White pixel companion with a question available':'White pixel companion at rest');
  if(!canAnimate())return;
  // One paint per authored pose, not a continuous requestAnimationFrame loop.
  function nextPose(){
   idleTimer=0;if(!canAnimate()){rest();return;}
   idlePose=(idlePose+1)%3;draw(coreActs.idle3,idlePose*8);
   idleTimer=setTimeout(nextPose,500);
  }
  idleTimer=setTimeout(nextPose,500);
 }
 function play(key){
  stop();const a=stateActs[key]||coreActs[key];avatarMode=key;
  if(!a||!canAnimate()){rest();return;}
  draw(a,0);let started;
  function frame(t){
   if(!canAnimate()){rest();return;}started??=t;
   const n=Math.max(0,Math.floor((t-started)*a.fps/1000));
   if(n>=a.frames){rest();return;}if(n!==lastFrame)draw(a,n);
   animation=requestAnimationFrame(frame);
  }
  animation=requestAnimationFrame(frame);
 }
 function syncMotion(event){if(typeof event?.matches==='boolean')systemReduced=event.matches;root.classList.toggle('rf-reduced',isReduced());$('.rf-motion').checked=isReduced();$('.rf-motion').disabled=systemReduced;if(isReduced()){motion.settle();rest();}else if(!animation&&!idleTimer)rest();}
 const observer=new IntersectionObserver(entries=>{const wasVisible=visible;visible=entries[entries.length-1]?.isIntersecting!==false;if(!visible){motion.settle();rest();}else if(!wasVisible&&!animation)rest();});observer.observe(canvas);
 document.addEventListener('visibilitychange',()=>{if(document.hidden){motion.settle();rest();}else{syncMotion({matches:media.matches});if(visible&&!animation&&!idleTimer)rest();}});
 function maximumContextHeight(){const details=[...reveal.querySelectorAll('.rf-node-detail')],before=details.map(n=>n.style.height);let height=0;for(let i=-1;i<details.length;i++){details.forEach((n,j)=>n.style.height=(j===i?Math.ceil(n.firstElementChild.getBoundingClientRect().height):0)+'px');height=Math.max(height,$('.rf-history').getBoundingClientRect().height);}details.forEach((n,i)=>n.style.height=before[i]);return height;}
 function setExpanded(value,animate=true){state.expanded=!!value;reveal.inert=!state.expanded;reveal.setAttribute('aria-hidden',String(!state.expanded));contextButton.setAttribute('aria-expanded',String(state.expanded));contextButton.dataset.open=String(state.expanded);motion.context(state.expanded,animate);}
 function reserveStage(){
  const width=stage.getBoundingClientRect().width;if(!width)return;if(width!==reservedWidth){reservedWidth=width;reservedStage=0;}
  const hidden=views.map(v=>v.hidden),q=views.find(v=>v.dataset.view==='question'),title=$('.rf-question h2');views.forEach(v=>v.hidden=v!==q);let max=0;
  for(const candidate of questions){title.textContent=candidate.text;renderContext(candidate);max=Math.max(max,q.getBoundingClientRect().height-reveal.getBoundingClientRect().height+maximumContextHeight()+footer.getBoundingClientRect().height+2);}
  title.textContent=activeQuestion().text;renderContext();
  for(const v of views){views.forEach(n=>n.hidden=n!==v);max=Math.max(max,v.getBoundingClientRect().height+footer.getBoundingClientRect().height+2);}views.forEach((v,i)=>v.hidden=hidden[i]);reservedStage=Math.max(reservedStage,Math.ceil(max+60));stage.style.height=reservedStage+'px';
 }
 function fit(){reserveStage();setExpanded(state.expanded,false);motion.view(false);}
 function renderContext(q=activeQuestion()){
  const h=$('.rf-history');h.replaceChildren();
  const nodes=q.id==='timing'?[
   {id:'problem',label:'Problem',kind:'problem',text:'After an SFP change, the link came up but no traffic passed. Optics were reported normal.'},
   {id:'hypothesis',label:'Possible cause',kind:'step',text:'A forwarding-state issue was suggested. This is a hypothesis, not a confirmed cause.'},
   {id:'check',label:'Suggested check',kind:'step',text:'Inspecting counters was proposed. The record does not confirm that this check happened or show a result.'},
   {id:'attempt',label:'Attempted reset',kind:'step',text:'An interface reset was attempted. Timing helps assess whether it affected the reported recovery.'},
   {id:'outcome',label:'Reported recovery',kind:'reported',text:'Traffic recovery was reported. Its timing, cause and lasting resolution remain unconfirmed.'}
  ]:[
   {id:'missing',label:'Missing revision',kind:'problem',text:'The incident report does not identify which controller revision was installed.'},
   {id:'record',label:'Suggested record check',kind:'step',text:'Check the equipment record for the installed revision. This check is proposed; no result is recorded.'},
   {id:'purpose',label:'Comparison goal',kind:'step',text:'The revision will help select relevant equipment history. A matching revision would not establish the cause.'}
  ];
  const path=document.createElement('ol');path.className='rf-evidence-path';path.setAttribute('aria-label','Incident context; expand a title for details');
  nodes.forEach(node=>{const li=document.createElement('li');li.className='rf-evidence-node';li.dataset.kind=node.kind;const button=document.createElement('button');button.type='button';button.className='rf-node-title cursor-interaction';button.dataset.node=node.id;const id='rf8-'+q.id+'-'+node.id;button.setAttribute('aria-controls',id);button.setAttribute('aria-expanded',String(state.openNode===node.id));const title=document.createElement('span');title.textContent=node.label;const icon=document.createElement('i');icon.dataset.lucide='chevron-down';icon.setAttribute('aria-hidden','true');button.append(title,icon);const detail=document.createElement('div');detail.className='rf-node-detail';detail.id=id;detail.dataset.node=node.id;detail.setAttribute('aria-hidden',String(state.openNode!==node.id));const detailText=document.createElement('p');detailText.textContent=node.text;detail.append(detailText);button.addEventListener('click',()=>{state.openNode=state.openNode===node.id?null:node.id;path.querySelectorAll('.rf-node-title').forEach(b=>b.setAttribute('aria-expanded',String(b.dataset.node===state.openNode)));motion.node(state.openNode);save();});li.append(button,detail);path.append(li);});
  h.append(path);motion.registerDetails(state.openNode);if(globalThis.lucide)lucide.createIcons({attrs:{width:16,height:16}});
 }
 function updateCount(){const count=questions.filter(q=>!Object.hasOwn(state.answers,q.id)).length;$('.rf-count').textContent=count||'';$('.rf-footer [data-action="queue"]').setAttribute('aria-label',`Open questions (${count})`);}
 function renderQueue(){const list=$('.rf-queue-list');list.replaceChildren();questions.filter(q=>!Object.hasOwn(state.answers,q.id)).forEach(q=>{const b=document.createElement('button');b.type='button';b.className='rf-question-item cursor-interaction';b.dataset.question=q.id;const label=document.createElement('small');label.textContent=q.case+(state.deferred.includes(q.id)?' · later':'');b.append(label,document.createTextNode(q.text));b.addEventListener('click',()=>{if(state.active!==q.id){state.openNode=null;state.expanded=false;}state.active=q.id;setView('question');$('[data-action="yes"]').focus({preventScroll:true});play('question');save();});list.append(b);});if(!list.children.length){const p=document.createElement('p');p.style.cssText='font-size:13px;color:#747b82;margin:0 0 12px';p.textContent='All quiet.';list.append(p);}}
 function syncPanelA11y(){const avatar=$('.rf-avatar');avatar.setAttribute('aria-expanded',String(state.panelOpen));avatar.setAttribute('aria-label',state.panelOpen?'Close panel':'Open panel');}
 function setView(view,animate=true){
  if(view==='collapsed'){closePanel(animate);return;}
  state.lastOpen=view;state.view=view;state.panelOpen=true;stage.dataset.view=view;views.forEach(v=>v.hidden=(v.dataset.view||(v.classList.contains('rf-input')?'input':''))!==view);send.hidden=view!=='input';contextButton.hidden=view!=='question';syncPanelA11y();
  const compose=$('[data-action="attach"]');compose.setAttribute('aria-label',view==='input'?'Attach text, images or files':'Write a message');compose.dataset.tooltip=view==='input'?'Attach files':'Write a message';compose.replaceChildren();const icon=document.createElement('i');icon.dataset.lucide=view==='input'?'paperclip':'square-pen';icon.setAttribute('aria-hidden','true');compose.append(icon);
  if(view==='queue')renderQueue();if(view==='question'){$('.rf-question h2').textContent=activeQuestion().text;$('.rf-case').textContent=activeQuestion().case;}reserveStage();setExpanded(state.expanded,false);updateCount();motion.panel(true,animate);motion.view(animate);rest();if(globalThis.lucide)lucide.createIcons({attrs:{width:16,height:16}});
 }
 function closePanel(animate=true){state.lastOpen=state.view;state.panelOpen=false;syncPanelA11y();motion.panel(false,animate);rest();$('.rf-avatar').focus({preventScroll:true});save();}
 function openPanel(){state.panelOpen=true;syncPanelA11y();motion.panel(true);const view=state.view;const target=view==='input'?field:view==='question'?$('[data-action="yes"]'):view==='receipt'?($('.rf-undo').hidden?$('[data-action="attach"]'):$('.rf-undo')):view==='queue'?$('.rf-question-item')||$('[data-action="attach"]'):$('.rf-server');target?.focus({preventScroll:true});play('hello');save();}
 function showReceipt(title,detail,canUndo){$('.rf-receipt-title').textContent=title;$('.rf-receipt-detail').textContent=detail;$('.rf-undo').hidden=!canUndo;setView('receipt');play('result');}
 function respond(value){const q=activeQuestion();undo={active:state.active,answers:{...state.answers},deferred:[...state.deferred]};if(value==='later'){if(!state.deferred.includes(q.id))state.deferred.push(q.id);}else state.answers[q.id]=value;state.expanded=false;receipt={kind:value,id:q.id};const titles={yes:'Recorded: Yes',no:'Recorded: No',unknown:'Recorded: Not sure',later:'Saved for later',dismiss:'Question dismissed'};showReceipt(titles[value],q.text,true);save();}
 function updateSend(){send.disabled=!field.value.trim()&&!attachments.length;}
 function renderAttachments(){const wrap=$('.rf-attachments');wrap.replaceChildren();attachments.forEach((file,i)=>{const chip=document.createElement('div');chip.className='rf-chip';const name=document.createElement('span');name.textContent=file.name;const remove=document.createElement('button');remove.type='button';remove.className='cursor-interaction';remove.textContent='×';remove.setAttribute('aria-label','Remove '+file.name);remove.addEventListener('click',()=>{attachments.splice(i,1);renderAttachments();});chip.append(name,remove);wrap.append(chip);});wrap.hidden=!attachments.length;updateSend();fit();}
 root.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>{
  const a=button.dataset.action;
  if(button.classList.contains('rf-avatar')){state.panelOpen?closePanel():openPanel();return;}
  if(['yes','no','unknown','later','dismiss'].includes(a)){respond(a);return;}
  if(['input','settings','queue'].includes(a)){setView(a);if(a==='input')field.focus({preventScroll:true});if(a==='queue')($('.rf-question-item[data-question="'+state.active+'"]')||$('.rf-question-item')||$('.rf-view[data-view="queue"] [data-action="input"]')).focus({preventScroll:true});save();return;}
  if(a==='attach'){if(state.view==='input')$('.rf-files').click();else{setView('input');field.focus({preventScroll:true});play('hello');save();}return;}
  if(a==='context'){setExpanded(!state.expanded);save();return;}
  if(a==='undo'){if(undo){Object.assign(state,{active:undo.active,answers:undo.answers,deferred:undo.deferred});undo=null;receipt=null;setView('question');$('[data-action="yes"]').focus({preventScroll:true});save();}return;}
  if(a==='send'&&!send.disabled){undo=null;receipt={kind:'input'};showReceipt('Ready to review',attachments.length?`${field.value.trim()?'Text and ':''}${attachments.length} ${attachments.length===1?'file':'files'} kept in your draft.`:'Your text is kept in the input.',false);save();}
 }));
 let inputNoticed=false;field.addEventListener('input',()=>{motion.settle();updateSend();if(field.value&&!inputNoticed){inputNoticed=true;play('input');}if(!field.value)inputNoticed=false;});
 field.addEventListener('paste',event=>{if(event.clipboardData?.files.length){attachments.push(...event.clipboardData.files);renderAttachments();play('input');}});
 $('.rf-files').addEventListener('change',event=>{attachments.push(...event.target.files);renderAttachments();play('input');event.target.value='';});
 let dragDepth=0;win.addEventListener('dragenter',event=>{event.preventDefault();dragDepth++;win.dataset.drag='true';});win.addEventListener('dragover',event=>event.preventDefault());win.addEventListener('dragleave',()=>{dragDepth--;if(dragDepth<=0)win.dataset.drag='false';});win.addEventListener('drop',event=>{event.preventDefault();dragDepth=0;win.dataset.drag='false';setView('input');if(event.dataTransfer.files.length)attachments.push(...event.dataTransfer.files);else{const text=event.dataTransfer.getData('text/plain');field.value+=text?(field.value?'\n':'')+text:'';}renderAttachments();play('input');});
 root.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closePanel();}if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){if(!state.panelOpen){event.preventDefault();return;}if(state.view==='input'&&!send.disabled){event.preventDefault();send.click();}}});
 $('.rf-motion').addEventListener('change',e=>{state.reduced=e.target.checked;syncMotion();save();});media.addEventListener('change',syncMotion);
 $('.rf-points').checked=state.points;$('.rf-points').addEventListener('change',e=>{state.points=e.target.checked;save();});
 $('.rf-provider').addEventListener('change',e=>{const select=$('.rf-model');select.replaceChildren();const option=document.createElement('option');option.textContent=e.target.value==='Google'?'Gemini · demo':e.target.value==='OpenAI'?'GPT · demo':'Local · demo';select.append(option);});
 window.addEventListener('openai:set_globals',event=>{const p=event.detail?.globals?.widgetState?.privateContent;if(!p?.panelV8||p.panelV8Source===source||JSON.stringify(p.panelV8)===JSON.stringify(snapshot()))return;restore(p.panelV8);syncMotion();$('.rf-points').checked=state.points;const open=state.panelOpen;setView(state.view,false);if(!open){state.panelOpen=false;syncPanelA11y();motion.panel(false,false);}});
 window.addEventListener('resize',()=>{fit();motion.settle();});
 root.companionPreview={status:()=>({view:state.panelOpen?state.view:'collapsed',panelOpen:state.panelOpen,uiMotion:motion.status(),lastOpen:state.lastOpen,openNode:state.openNode,expanded:state.expanded,answers:{...state.answers},deferred:[...state.deferred],attachments:attachments.map(f=>f.name),draft:field.value,avatarMode,lastFrame,animating:!!animation||!!idleTimer,reactionPlaying:!!animation,idleLoop:!!idleTimer,idlePose,questionCue:hasQuestion(),visible,reduced:isReduced()}),showQuestion:id=>{state.active=questions.some(q=>q.id===id)?id:'timing';state.expanded=false;setView('question');}};
 const initiallyOpen=state.panelOpen;syncMotion();setView(state.view,false);if(!initiallyOpen){state.panelOpen=false;syncPanelA11y();motion.panel(false,false);}updateSend();if(globalThis.lucide)lucide.createIcons({attrs:{width:16,height:16}});
 $('.rf-avatar').addEventListener('pointerdown',()=>motion.press(true));window.addEventListener('pointerup',()=>motion.press(false));$('.rf-avatar').addEventListener('pointercancel',()=>motion.press(false));
 if(globalThis.Tweak){const options={view:state.view};let previous=options.view;const tweak=new Tweak({container:stage,onChange:()=>{if(options.view!==previous){if(options.view==='collapsed')closePanel();else setView(options.view);}previous=options.view;}});tweak.addSelect(options,'view',{label:'Preview',options:[{label:'Question',value:'question'},{label:'Input',value:'input'},{label:'At rest',value:'collapsed'}]});}
})();
