 const root=document.getElementById('compact-companion-v7'),canvas=root.querySelector('canvas'),ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;
 const ui={act:root.querySelector('.cc-act'),play:root.querySelector('.cc-play'),duration:root.querySelector('.cc-duration'),state:root.querySelector('.cc-state'),slow:root.querySelector('.cc-slow'),reduced:root.querySelector('.cc-reduced'),status:root.querySelector('.cc-status')};
 const kit=createMinimalKit(),acts={...createCompactCoreActs({kit}),...(typeof createCompactPropActs==='function'?createCompactPropActs({kit}):{})},states=createCompactStateActs({kit}),registry={...acts,...states};
 const media=matchMedia('(prefers-reduced-motion:reduce)'),sourceToken='compact-v7-'+Math.random().toString(36).slice(2);
 let systemReduced=media.matches;
 let action='click',state='idle',frame=0,raf=0,running=false,started=0,startFrame=0,slow=false,userReduced=false,looping=false;
 const reduced=()=>systemReduced||userReduced,speed=()=>slow?.5:1,clamp=(key,f)=>Number.isFinite(f)?Math.max(0,Math.min(registry[key].frames-1,Math.floor(f))):0;
 function paint(key=action,f=frame){key=Object.hasOwn(registry,key)?key:'idle';registry[key].render(ctx,clamp(key,f));}
 function sync(announce=false){ui.play.disabled=reduced();ui.play.textContent=running?'Pause':frame>=registry[action].frames-1?'Replay':'Play';ui.duration.textContent=(registry[action].frames/registry[action].fps/speed()).toFixed(2).replace(/0$/,'').replace(/\.0$/,'')+' s';ui.slow.checked=slow;ui.reduced.checked=reduced();ui.reduced.disabled=systemReduced;ui.state.value=state;if(announce)ui.status.textContent=registry[action].label+(reduced()?' · Still':running&&action==='idle3'?' · Loop':'');canvas.setAttribute('aria-label','Pixel companion: '+registry[action].label);}
 function pause(){if(raf)cancelAnimationFrame(raf);raf=0;running=false;looping=false;sync(true);}
 function show(key=action,f=0){pause();action=Object.hasOwn(registry,key)?key:'idle';frame=clamp(action,f);paint();sync(true);}
 function remember(){if(globalThis.openai?.setWidgetState)globalThis.openai.setWidgetState({modelContent:{selectedAct:ui.act.value,lastState:state},privateContent:{slow,reduced:userReduced,sourceToken}}).catch(()=>{});}
 function select(key){state=Object.hasOwn(states,key)?key:'idle';show(key,reduced()?registry[key].stillFrame:0);if(Object.hasOwn(acts,key))ui.act.value=key;remember();}
 function tick(now){if(!running)return;const n=startFrame+Math.max(0,Math.floor(Math.max(0,now-started)*registry[action].fps*speed()/1000)),count=registry[action].frames;if(n>=count&&!looping){frame=count-1;paint();pause();return;}const next=looping?n%count:n;if(next!==frame){frame=next;paint();}raf=requestAnimationFrame(tick);}
 function play(key=action,{restart=false}={}){if(key!==action)select(key);if(reduced()){show(action,registry[action].stillFrame);return;}if(raf)cancelAnimationFrame(raf);if(restart||frame>=registry[action].frames-1)frame=0;running=true;looping=action==='idle3';startFrame=frame;started=performance.now();paint();sync(true);raf=requestAnimationFrame(tick);}
 function restore(s){const m=s?.modelContent,d=s?.privateContent;action=Object.hasOwn(acts,m?.selectedAct)?m.selectedAct:'click';ui.act.value=action;state=Object.hasOwn(states,m?.lastState)?m.lastState:'idle';slow=Boolean(d?.slow);userReduced=Boolean(d?.reduced);if(state!=='idle')action=state;show(action,reduced()||state!=='idle'?registry[action].stillFrame:0);}
 for(const key of ['click','backflip','half','hop','hello','peek','stretching','entrance','moonwalk','hero','idle3']){if(!acts[key])continue;const o=document.createElement('option');o.value=key;o.textContent=acts[key].label;ui.act.append(o);}
 ui.act.addEventListener('change',()=>select(ui.act.value));ui.play.addEventListener('click',()=>running?pause():play());
 ui.state.addEventListener('change',()=>{select(ui.state.value);play(action,{restart:true});});
 root.querySelector('.cc-touch').addEventListener('click',()=>{select('click');play('click',{restart:true});});
 ui.slow.addEventListener('change',()=>{const next=ui.slow.checked,resume=running;pause();slow=next;if(resume)play();sync();remember();});
 ui.reduced.addEventListener('change',()=>{userReduced=ui.reduced.checked;show(action,registry[action].stillFrame);remember();});
 media.addEventListener('change',event=>{systemReduced=event.matches;show(action,reduced()?registry[action].stillFrame:frame);});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
 if(globalThis.IntersectionObserver)new IntersectionObserver(entries=>{if(!entries[0].isIntersecting)pause();},{threshold:.1}).observe(root);
 globalThis.addEventListener('openai:set_globals',e=>{const s=e.detail?.globals?.widgetState;if(!s||s.privateContent?.sourceToken===sourceToken)return;const m=s.modelContent||{},d=s.privateContent||{};if(m.selectedAct===ui.act.value&&m.lastState===state&&Boolean(d.slow)===slow&&Boolean(d.reduced)===userReduced)return;restore(s);});
 root.pixelCompanion={paint,play,pause,stop:pause,select,scrub:f=>show(action,f),registry,kit,actionFrames:Object.fromEntries(Object.entries(registry).map(([key,a])=>[key,a.frames])),getStatus:()=>({active:action,state,lastFrame:frame,running,looping,reduced:reduced(),slow,scheduled:Boolean(raf)})};
 restore(globalThis.openai?.widgetState);
