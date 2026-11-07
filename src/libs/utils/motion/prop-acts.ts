import type { Act, DrawTarget, Kit } from './types.ts';

/* Port of compact-prop-acts.js. Compact v006 accents. All anatomy, face proportions and body pixels come from
   the shared minimal kit. Two short acts; no articulated limbs or costumes. */
export type PropActKey = 'moonwalk' | 'hero';

export function createCompactPropActs({ kit }: { kit: Kit }): Record<PropActKey, Act> {
 const P=kit.palette;
 const clamp=(f: number,count: number)=>Number.isFinite(f)?Math.max(0,Math.min(count-1,Math.floor(f))):0;
 type MoonRow=[number,number,string,string,string,number,number];
 const moonwalk: MoonRow[]=[
  [48,80,'neutral','front','normal',0,0],
  [48,80,'low','front','blink',1,0],
  [48,80,'neutral','front','blink',2,0],
  [48,80,'neutral','quarter','normal',3,0],
  [48,79,'neutral','profile','normal',3,1],
  [48,79,'neutral','profile','normal',3,2],
  [47,79,'neutral','profile','normal',3,2],
  [46,79,'neutral','profile','normal',3,1],
  [45,79,'neutral','profile','normal',3,1],
  [44,79,'neutral','profile','normal',3,2],
  [44,79,'neutral','profile','normal',3,2],
  [43,79,'neutral','profile','normal',3,1],
  [42,79,'neutral','profile','normal',3,1],
  [41,79,'neutral','profile','normal',3,2],
  [40,79,'neutral','profile','normal',3,2],
  [40,79,'neutral','profile','normal',3,1],
  [40,79,'neutral','profile','normal',3,1],
  [40,79,'neutral','quarter','normal',3,2],
  [40,80,'neutral','front','wink',3,0],
  [40,80,'low','front','pleased',3,0],
  [41,78,'high','front','pleased',3,0],
  [43,75,'neutral','front','pleased',3,0],
  [45,75,'neutral','front','pleased',3,0],
  [47,77,'neutral','front','pleased',3,0],
  [48,80,'low','front','blink',2,0],
  [48,80,'neutral','front','blink',1,0],
  [48,80,'neutral','front','normal',0,0],
  [48,80,'neutral','front','pleased',0,0],
  [48,80,'neutral','front','normal',0,0],
  [48,80,'neutral','front','normal',0,0],
  [48,80,'neutral','front','normal',0,0],
  [48,80,'neutral','front','normal',0,0]
 ];
 type HeroRow=[number,string,string,string,number,number];
 const hero: HeroRow[]=[
  [80,'neutral','front','normal',0,0],
  [80,'low','front','blink',1,0],
  [80,'crouch','front','effort',2,0],
  [78,'high','quarter','normal',2,0],
  [74,'stretch','quarter','normal',2,1],
  [70,'neutral','quarter','normal',2,1],
  [68,'neutral','quarter','normal',2,1],
  [69,'neutral','quarter','normal',2,1],
  [72,'neutral','quarter','normal',2,1],
  [76,'high','front','normal',2,1],
  [80,'crouch','front','blink',2,2],
  [80,'crouch','front','blink',2,2],
  [78,'low','front','pleased',2,1],
  [78,'high','front','pleased',2,0],
  [80,'neutral','front','pleased',2,0],
  [80,'neutral','front','wink',2,0],
  [80,'neutral','front','normal',1,0],
  [80,'neutral','front','normal',0,0],
  [80,'neutral','front','normal',0,0],
  [80,'neutral','front','normal',0,0],
  [80,'neutral','front','normal',0,0],
  [80,'neutral','front','normal',0,0],
  [80,'neutral','front','normal',0,0],
  [80,'neutral','front','normal',0,0]
 ];
 function hat(c: DrawTarget,x: number,top: number,level: number){
  if(!level)return;
  // The brim emerges from the top contour; no separate handling routine.
  kit.pixel(c,x-6,top-1,12,1,P.ink);
  if(level>=2)kit.pixel(c,x-3,top-3,6,2,P.ink);
  if(level>=3){kit.pixel(c,x-3,top-4,6,1,P.ink);kit.pixel(c,x-2,top-2,4,1,P.accent);}
 }
 function cape(c: DrawTarget,x: number,bottom: number,level: number,lag: number){
  if(!level)return;
  if(level===1){kit.pixel(c,x-15,bottom-18,2,5,P.accent);return;}
  const poses=[
   {x:-18,y:-20,rows:['....aa','..aaaa','.aaaaa','aaaaaa','aaaaaa','aaaaa.','aaaa..','aaa...','.a....']},
   {x:-21,y:-20,rows:['aaaaaa..','.aaaaaaa','..aaaaaa','...aaaa.','....aa..','.....a..']},
   {x:-19,y:-26,rows:['.aa...','aaaa..','.aaaa.','..aaaa','...aaa','...aaa','...aaa','....aa','.....a']}
  ];
  const a=poses[Math.max(0,Math.min(2,lag))]!;
  a.rows.forEach((row: string,yy: number)=>[...row].forEach((cell,xx)=>{if(cell==='a')kit.pixel(c,x+a.x+xx,bottom+a.y+yy,1,1,P.accent);}));
 }
 function renderMoonwalk(c: DrawTarget,frame: number){
  const f=clamp(frame,moonwalk.length),[x,bottom,shape,view,expression,hatLevel,step]=moonwalk[f];
  kit.clear(c);kit.shadow(c,{x,y:82,width:bottom<78?24:26});
  const feet=step?[{side:-1,lift:step===1?1:0},{side:1,lift:step===2?1:0}]:[];
  const bounds=kit.orb(c,{x,bottom,shape,view,expression,feet});
  hat(c,x,bounds.top,hatLevel);
 }
 function renderHero(c: DrawTarget,frame: number){
  const f=clamp(frame,hero.length),[bottom,shape,view,expression,capeLevel,lag]=hero[f];
  kit.clear(c);kit.shadow(c,{x:48,y:82,width:bottom<74?22:26});
  cape(c,48,bottom,capeLevel,lag);
  kit.orb(c,{x:48,bottom,shape,view,expression});
 }
 return {
  moonwalk:{label:'Hat moonwalk',fps:16,frames:moonwalk.length,stillFrame:12,beats:[{frame:0,label:'Rest'},{frame:3,label:'A little hat'},{frame:6,label:'Glide back'},{frame:12,label:'Change weight'},{frame:18,label:'A glance'},{frame:24,label:'Settle'}],render:renderMoonwalk},
  hero:{label:'Tiny cape hop',fps:16,frames:hero.length,stillFrame:14,beats:[{frame:0,label:'Rest'},{frame:2,label:'Crouch'},{frame:6,label:'A small flight'},{frame:10,label:'Soft landing'},{frame:12,label:'Cape catches up'},{frame:15,label:'Pleased'}],render:renderHero}
 };
}
