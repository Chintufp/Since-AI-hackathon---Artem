function createCompactStateActs({kit:k}){
 const p=k.palette;
 const defs={idle:{label:'At rest',frames:1,fps:12,stillFrame:0},input:{label:'Receiving',frames:10,fps:15,stillFrame:9},processing:{label:'Processing',frames:20,fps:12,stillFrame:10},question:{label:'Question available',frames:16,fps:12,stillFrame:15},result:{label:'Result available',frames:12,fps:15,stillFrame:11},error:{label:'Needs attention',frames:10,fps:12,stillFrame:9}};
 for(const [key,a]of Object.entries(defs)){a.beats=[];a.render=(c,value)=>{const f=Number.isFinite(value)?Math.max(0,Math.min(a.frames-1,Math.floor(value))):0;k.clear(c);k.shadow(c,{});
  const s={};if(key==='input'){s.shape=['neutral','low','low','neutral','high','neutral','high','neutral','neutral','neutral'][f];s.expression='surprised';}
  if(key==='processing'){s.gaze=[0,0,1,1,1,0,-1,-1,-1,0][f%10];s.expression=f===9?'blink':'normal';}
  if(key==='question'){s.gaze=f<5?1:0;s.shape=f>=3&&f<6?'high':'neutral';}
  if(key==='result'){s.expression='happy';s.shape=f===1?'low':f===3?'high':'neutral';}
  if(key==='error'){s.expression='concerned';s.gaze=f<3?-1:f<6?1:0;}
  k.orb(c,s);
  if(key==='processing')for(let i=0;i<3;i++)k.pixel(c,43+i*4,47-(Math.floor(f/3)%3===i?1:0),2,2,p.accent);
  if(key==='question'){const rows=['.xxx.','x...x','....x','..xx.','..x..','.....','..x..'];rows.forEach((row,y)=>[...row].forEach((v,x)=>{if(v==='x')k.pixel(c,64+x,50+y,1,1,p.ink);}));}
  if(key==='result'){k.pixel(c,64,66,5,7,p.edge);k.pixel(c,65,67,3,5,p.body);k.pixel(c,65,68,2,1,p.shade);k.pixel(c,65,70,2,1,p.shade);}
 };}return defs;
}
