function createCompactCoreActs({kit:k}){
 const P=k.palette;
 function scene(c,p={}){k.clear(c);k.shadow(c,{width:p.bottom<66?20:26});k.orb(c,p);}
 const a={
  click:{label:'Springy tap',fps:15,frames:10,stillFrame:9,beats:[{frame:0,label:'Notice'},{frame:2,label:'Squash'},{frame:4,label:'Spring'},{frame:6,label:'Rebound'},{frame:9,label:'Settle'}],render(c,f){const shapes=['neutral','crouch','deep','crouch','stretch','neutral','stretch','neutral','neutral','neutral'];scene(c,{shape:shapes[f],expression:'happy'});}},
  idle3:{label:'Three-pose idle',fps:16,frames:24,stillFrame:0,beats:[{frame:0,label:'Rest'},{frame:8,label:'Settle'},{frame:16,label:'Breathe'}],render(c,f){scene(c,{shape:f<8?'neutral':f<16?'low':'high'});}},
  hello:{label:'Tiny hello',fps:15,frames:10,stillFrame:9,beats:[{frame:0,label:'Notice'},{frame:4,label:'Hello'},{frame:9,label:'Ready'}],render(c,f){const shapes=['neutral','low','low','neutral','high','neutral','high','neutral','neutral','neutral'];scene(c,{shape:shapes[f],expression:'happy',hands:f>=4&&f<8?[{side:1,pose:'wave',level:.55}]:[]});}},
  backflip:{label:'Little backflip',fps:16,frames:24,stillFrame:20,beats:[{frame:0,label:'Ready'},{frame:3,label:'Squash'},{frame:6,label:'Push'},{frame:10,label:'Tuck'},{frame:15,label:'Find the floor'},{frame:18,label:'Land'},{frame:21,label:'Pleased'}],render(c,f){
   const bottoms=[80,80,80,80,80,78,71,63,56,51,48,47,49,53,59,66,74,80,80,79,80,80,80,80];
   const turns=[0,0,0,0,0,0,0,1,2,3,4,4,5,6,7,0,0,0,0,0,0,0,0,0];
   scene(c,{bottom:bottoms[f],shape:f>=2&&f<=4?'crouch':f===5||f===6?'stretch':f>=8&&f<=13?'tuck':f===17||f===18?'deep':f===19?'crouch':'neutral',turn:turns[f],expression:f>=20&&f<=22?'happy':f>=2&&f<=4?'effort':'normal',hands:f===4||f===5?[{side:-1,pose:'push'},{side:1,pose:'push'}]:[],feet:f===5||f===6||f===16?[{side:-1},{side:1}]:[]});
  }},
  half:{label:'Almost a flip',fps:16,frames:24,stillFrame:19,beats:[{frame:0,label:'A small idea'},{frame:3,label:'Push'},{frame:8,label:'Wait…'},{frame:12,label:'Roll through'},{frame:16,label:'Still here'},{frame:20,label:'All good'}],render(c,f){
   const bottom=[80,80,80,79,73,67,62,59,59,60,63,68,74,80,80,80,80,80,80,80,80,80,80,80][f],turn=[0,0,0,0,1,2,3,4,4,4,5,6,7,0,0,0,0,0,0,0,0,0,0,0][f],x=f>=11&&f<18?[49,50,51,51,50,49,48][f-11]:48;
   scene(c,{x,bottom,turn,shape:f<3?'crouch':f>=6&&f<=12?'tuck':f===13||f===14?'deep':f===15?'crouch':'neutral',expression:f>=16&&f<20?'sheepish':f>=20&&f<23?'happy':'normal'});
  }},
  hop:{label:'Small happy hop',fps:16,frames:18,stillFrame:14,beats:[{frame:0,label:'Ready'},{frame:2,label:'Dip'},{frame:6,label:'Hop'},{frame:11,label:'Land'},{frame:14,label:'Hello again'}],render(c,f){const b=[80,80,80,80,77,71,66,64,66,71,77,80,80,79,80,80,80,80][f];scene(c,{bottom:b,shape:f>=1&&f<4||f===12?'crouch':f===4||f===5?'stretch':f===11?'deep':'neutral',expression:f>=6&&f<16?'happy':'normal'});}},
  stretching:{label:'Little stretch',fps:16,frames:20,stillFrame:15,beats:[{frame:0,label:'Sleepy'},{frame:3,label:'Stretch'},{frame:8,label:'Yawn'},{frame:14,label:'Release'},{frame:18,label:'Ready'}],render(c,f){scene(c,{shape:f<3?'low':f<6?'high':f<12?'stretch':f<15?'high':f===15?'low':'neutral',expression:f<6?'blink':f<12?'yawn':f<17?'blink':'normal'});}},
  peek:{label:'Attentive glance',fps:16,frames:16,stillFrame:12,beats:[{frame:0,label:'Notice'},{frame:3,label:'Look'},{frame:8,label:'Look back'},{frame:12,label:'Available'}],render(c,f){scene(c,{view:f>=3&&f<8?'quarter':'front',gaze:f>=2&&f<8?1:0,shape:f>=3&&f<8?'high':'neutral',expression:f===8?'blink':f>=11&&f<15?'happy':'normal'});}},
  entrance:{label:'Drop & settle',fps:16,frames:24,stillFrame:20,beats:[{frame:0,label:'Incoming'},{frame:5,label:'Impact'},{frame:8,label:'Spring back'},{frame:13,label:'A little dazed'},{frame:19,label:'Oh, hello'}],render(c,f){const b=[-3,8,27,50,73,80,80,80,74,69,73,78,80,80,80,80,80,80,80,80,80,80,80,80][f];scene(c,{bottom:b,shape:f<5?'stretch':f===5||f===6?'deep':f===7?'crouch':f<10?'stretch':'neutral',expression:f>=5&&f<8?'effort':f>=12&&f<17?'surprised':f>=19&&f<23?'happy':'normal'});if(f<5){k.pixel(c,35,Math.max(0,b-39),1,5,P.accent);k.pixel(c,60,Math.max(0,b-33),1,4,P.accent);}if(f>=12&&f<17){k.star(c,35+(f-12)*3,47);k.star(c,59-(f-12)*3,44);}}}
 };
 for(const act of Object.values(a)){const draw=act.render;act.render=(c,f)=>draw(c,Number.isFinite(f)?Math.max(0,Math.min(act.frames-1,Math.floor(f))):0);}
 return a;
}
