function createMinimalKit(){
 const palette={body:'#ffffff',edge:'#b8c5cf',shade:'#e4edf2',nub:'#d5e0e7',ink:'#243542',cheek:'#f2a5b7',shadow:'#edf1f3',accent:'#a4bbc9',star:'#dcc98f'};
 const shapes={
  neutral:[8,16,16,22,22,22,26,26,26,26,28,28,28,28,28,28,28,28,26,26,26,26,22,22,22,16,16,8],
  low:[8,16,16,22,22,22,26,26,26,28,28,28,28,28,28,28,28,28,26,26,26,22,22,22,16,16,8],
  high:[8,16,16,22,22,22,26,26,26,26,28,28,28,28,28,28,28,28,28,26,26,26,26,22,22,20,16,16,8],
  crouch:[10,18,24,28,30,30,32,32,32,32,32,32,32,32,32,30,30,28,24,18,10],
  deep:[12,22,28,32,34,36,36,36,36,36,36,34,32,28,22,12],
  stretch:[6,12,16,18,20,22,22,24,24,24,26,26,26,26,26,26,26,26,26,26,26,26,24,24,24,22,22,20,18,16,12,6],
  tuck:[8,14,18,22,24,24,26,26,26,26,26,26,26,26,26,26,26,24,24,22,18,14,8]
 };
 const n=v=>Math.round(Number.isFinite(v)?v:0);
 function pixel(c,x,y,w,h,color){c.fillStyle=color;c.fillRect(n(x),n(y),Math.max(0,n(w)),Math.max(0,n(h)));}
 function clear(c){c.clearRect(0,0,96,96);pixel(c,0,0,96,96,palette.body);}
 function line(c,points,color=palette.accent){for(let i=1;i<points.length;i++){let x=n(points[i-1][0]),y=n(points[i-1][1]),ex=n(points[i][0]),ey=n(points[i][1]),dx=Math.abs(ex-x),sx=x<ex?1:-1,dy=-Math.abs(ey-y),sy=y<ey?1:-1,e=dx+dy;for(;;){pixel(c,x,y,1,1,color);if(x===ex&&y===ey)break;const e2=e*2;if(e2>=dy){e+=dy;x+=sx;}if(e2<=dx){e+=dx;y+=sy;}}}}
 function shadow(c,{x=48,y=82,width=26}={}){x=n(x);y=n(y);width=n(width);pixel(c,x-Math.floor(width/2)+3,y-1,width-6,1,palette.shadow);pixel(c,x-Math.floor(width/2),y,width,1,palette.shadow);pixel(c,x-Math.floor(width/2)+3,y+1,width-6,1,palette.shadow);}
 function star(c,x,y,color=palette.star){pixel(c,x+1,y,1,3,color);pixel(c,x,y+1,3,1,color);}
 function drawFace(c,{x,bottom,rows,expression,gaze,view,turn}){
  const cy=bottom-Math.floor(rows.length/2),ey=bottom-rows.length+Math.max(4,Math.round(rows.length*.40));
  if(view==='back'||expression==='hidden')return;
  if(turn){
   const poses=[null,{eyes:[[-5,1],[1,-5]],cheeks:[[-3,5],[5,-3]],mouth:[[2,1],[3,2],[2,3]]},{eyes:[[-4,-4],[-4,4]],cheeks:[[0,-8],[0,7]],mouth:[[2,-1],[3,0],[2,1]]},{eyes:[[-5,-1],[1,5]],cheeks:[[-3,-5],[5,3]],mouth:[[1,-2],[2,-3],[3,-2]]},{eyes:[[-5,4],[5,4]],cheeks:[[-9,0],[7,0]],mouth:[[-1,-2],[0,-3],[1,-2]]},{eyes:[[-1,5],[5,-1]],cheeks:[[-5,3],[3,-5]],mouth:[[-3,-2],[-2,-3],[-1,-2]]},{eyes:[[4,4],[4,-4]],cheeks:[[0,7],[0,-8]],mouth:[[-2,-1],[-3,0],[-2,1]]},{eyes:[[-1,-5],[5,1]],cheeks:[[-5,-3],[3,5]],mouth:[[-3,2],[-2,3],[-1,2]]}];
   const p=poses[Math.max(1,Math.min(7,n(turn)))];p.cheeks.forEach(([a,b])=>pixel(c,x+a,cy+b,3,2,palette.cheek));p.eyes.forEach(([a,b])=>pixel(c,x+a,cy+b,2,2,palette.ink));p.mouth.forEach(([a,b])=>pixel(c,x+a,cy+b,1,1,palette.ink));return;
  }
  const faceX=x+(view==='profile'?6:view==='quarter'?2:0),look=Math.max(-1,Math.min(1,n(gaze)));
  if(view==='profile'){
   pixel(c,x+6,ey+5,3,2,palette.cheek);pixel(c,faceX+look,ey,2,expression==='blink'||expression==='effort'?1:3,palette.ink);pixel(c,x+7,ey+7,3,1,palette.ink);return;
  }
  pixel(c,faceX-9,ey+4,4,2,palette.cheek);pixel(c,faceX+5,ey+4,4,2,palette.cheek);
  for(const side of [-1,1]){const ex=faceX-1+side*5+look;
   if(expression==='happy'||expression==='pleased'){pixel(c,ex-1,ey+1,1,1,palette.ink);pixel(c,ex,ey,1,1,palette.ink);pixel(c,ex+1,ey+1,1,1,palette.ink);}
   else if(expression==='blink'||expression==='effort'||expression==='wink'&&side===-1)pixel(c,ex-1,ey+1,3,1,palette.ink);
   else pixel(c,ex,ey,view==='quarter'&&side===-1?1:2,3,palette.ink);
  }
  if(expression==='surprised'||expression==='yawn'){pixel(c,faceX-1,ey+6,3,3,palette.ink);pixel(c,faceX,ey+7,1,1,palette.body);}
  else if(expression==='concerned'||expression==='sheepish'){pixel(c,faceX-2,ey+7,4,1,palette.ink);pixel(c,faceX-6,ey-2,2,1,palette.ink);}
  else{pixel(c,faceX-2,ey+5,1,1,palette.ink);pixel(c,faceX+1,ey+5,1,1,palette.ink);pixel(c,faceX-2,ey+6,4,1,palette.ink);}
 }
 function orb(c,{x=48,bottom=80,shape='neutral',expression='normal',gaze=0,view='front',turn=0,hands=[],feet=[]}={}){
  x=n(x);bottom=n(bottom);const rows=shapes[shape]||shapes.neutral,top=bottom-rows.length,mask=new Set(),key=(a,b)=>a+','+b;
  for(const foot of feet){const side=typeof foot==='number'?foot:foot.side;const lift=typeof foot==='object'?n(foot.lift||0):0;pixel(c,x+side*5-1,bottom-1-lift,3,2,palette.nub);}
  for(const hand of hands){const side=hand.side<0?-1:1,row=Math.max(2,Math.min(rows.length-3,n((hand.level??.60)*(rows.length-1)))),edge=x+side*Math.floor(rows[row]/2),yy=top+row;
   if(side>0){pixel(c,edge-1,yy,4,3,palette.nub);pixel(c,edge+1,yy+(hand.pose==='wave'?-1:1),2,2,palette.nub);}
   else{pixel(c,edge-3,yy,4,3,palette.nub);pixel(c,edge-3,yy+(hand.pose==='wave'?-1:1),2,2,palette.nub);}
  }
  rows.forEach((w,y)=>{for(let xx=0;xx<w;xx++)mask.add(key(x-Math.floor(w/2)+xx,top+y));});
  for(const p of mask){const [xx,yy]=p.split(',').map(Number),edge=!mask.has(key(xx-1,yy))||!mask.has(key(xx+1,yy))||!mask.has(key(xx,yy-1))||!mask.has(key(xx,yy+1));pixel(c,xx,yy,1,1,edge?palette.edge:!mask.has(key(xx,yy+3))?palette.shade:palette.body);}
  drawFace(c,{x,bottom,rows,expression,gaze,view,turn});
  return {left:x-Math.floor(Math.max(...rows)/2),right:x+Math.ceil(Math.max(...rows)/2)-1,top,bottom:bottom-1};
 }
 return {palette,shapes,clear,shadow,orb,pixel,line,star};
}
