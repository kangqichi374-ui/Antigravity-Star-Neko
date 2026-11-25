const {EventEmitter}=require("node:events"),{spawn}=require("node:child_process"),fs=require("node:fs"),path=require("node:path");
const NATIVE_HELPER_PATH=path.join(__dirname,"../native/ForegroundHost.exe");
function hasNativeHelper(){return process.platform==="win32"&&fs.existsSync(NATIVE_HELPER_PATH);}
function validBounds(value){return value&&["x","y","width","height"].every(key=>Number.isSafeInteger(value[key])&&Math.abs(value[key])<100000)&&value.width>0&&value.height>0;}
function characterPlacement(area,size,dimensions,left,top){
 const gap=(dimensions.width-size)/2;
 const visualX=Math.max(area.x,Math.min(area.x+area.width-size,left));
 const x=Math.round(Math.max(area.x,Math.min(area.x+area.width-dimensions.width,visualX-gap)));
 const y=Math.round(Math.max(area.y,Math.min(area.y+area.height-dimensions.height,top)));
 return{bounds:{...dimensions,x,y},artShift:visualX-x-gap,visualX};
}
function snapToEdges(area,size,height,visualX,y){
 const left=visualX-area.x,right=area.x+area.width-visualX-size,bottom=area.y+area.height-y-height;
 if(bottom<=120&&Math.min(left,right)<=120)return{visualX:left<right?area.x:area.x+area.width-size,y:area.y+area.height-height};
 return{visualX:left<40?area.x:right<40?area.x+area.width-size:visualX,y:bottom<40?area.y+area.height-height:y};
}
function hostPlacement(state,scale,offsetX=18,offsetY=18,dock=""){
 if(!["host","self"].includes(state.kind)||!validBounds(state.bounds))return null;
 const area=state.bounds;
 const effectiveScale=Math.floor(Math.min(scale,area.width-80,(area.height-340)*1372/1146));
 if(effectiveScale<140||area.width<360)return null;
 const width=Math.max(360,effectiveScale+80),height=Math.round(effectiveScale*1146/1372+340);
 return{scale:effectiveScale,...characterPlacement(area,effectiveScale,{width,height},dock==="left"?area.x:dock==="right"?area.x+area.width-effectiveScale:area.x+area.width-effectiveScale-offsetX,area.y+area.height-height-offsetY)};
}
class ForegroundMonitor extends EventEmitter{
 constructor(){super();this.state={kind:"unknown",bounds:null};this.lastReport=0;}
 start(handle){
  if(this.child&&Date.now()-this.lastReport>5000)this.stop();
  if(this.child)return;
  this.lastReport=Date.now();
  if(!hasNativeHelper())return;
  const child=spawn(NATIVE_HELPER_PATH,[String(process.pid),...(handle?[handle.readBigUInt64LE().toString()]:[])],{windowsHide:true,stdio:["pipe","pipe","ignore"]});this.child=child;this.bound=!!handle;
  let pending="";
  child.stdout.on("data",chunk=>{
   if(this.child!==child)return;
   this.lastReport=Date.now();pending+=chunk.toString();let index;
   while((index=pending.indexOf("\n"))>=0){const line=pending.slice(0,index);pending=pending.slice(index+1);try{const state=JSON.parse(line);if(["host","self","other","unknown"].includes(state.kind)&&(!state.bounds||validBounds(state.bounds))){this.state=state;this.emit("change",state);}}catch{}}
   if(pending.length>8192)pending="";
  });
  const ended=()=>{if(this.child!==child)return;this.child=null;this.state={kind:"unknown",bounds:null};this.emit("change",this.state);};
  child.on("error",ended);child.on("exit",ended);
 }
 stop(){const child=this.child;this.child=null;if(child&&!this.bound){child.kill();return;}if(child){child.stdin.end("detach\n");const timer=setTimeout(()=>child.kill(),1000);timer.unref();}this.state={kind:"unknown",bounds:null};}
}
function contextMenuPlacement(area,menuSize,charRect,cursorPoint,opts={}){
 const w=menuSize?.width||264,h=menuSize?.height||472,pad=menuSize?.pad??12,gap=12;
 const minX=area.x-Math.max(0,pad-4),maxX=area.x+area.width-w+Math.max(0,pad-4);
 const minY=area.y-Math.max(0,pad-6),maxY=area.y+area.height-h+Math.max(0,pad-6);
 const clampX=vx=>Math.round(Math.max(minX,Math.min(maxX,vx)));
 const clampY=vy=>Math.round(Math.max(minY,Math.min(maxY,vy)));
 if(!opts.nearCursor&&charRect&&validBounds(charRect)){
  const leftX=charRect.x-w+pad-gap,rightX=charRect.x+charRect.width-pad+gap;
  const leftFits=leftX>=minX,rightFits=rightX<=maxX;
  let rawX=null;
  if(leftFits&&rightFits){
   const spaceL=charRect.x-area.x,spaceR=area.x+area.width-(charRect.x+charRect.width);
   if(opts.preferSide==="left")rawX=rightX;
   else if(opts.preferSide==="right")rawX=leftX;
   else rawX=spaceL>=spaceR?leftX:rightX;
  }else if(leftFits)rawX=leftX;
  else if(rightFits)rawX=rightX;
  if(rawX!==null){
   const rawY=charRect.y+charRect.height-h+pad-2;
   return{x:clampX(rawX),y:clampY(rawY)};
  }
  const aboveY=charRect.y-h+pad-gap,centerX=charRect.x+(charRect.width-w)/2;
  return{x:clampX(centerX),y:clampY(aboveY>=minY?aboveY:(cursorPoint?.y??area.y)-h+20)};
 }
 const px=cursorPoint?.x??(area.x+Math.round(area.width/2)),py=cursorPoint?.y??(area.y+Math.round(area.height/2));
 const rawX=(px+w>area.x+area.width)?(px-w+20):(px-12);
 const rawY=(py+h>area.y+area.height)?(py-h+20):(py-12);
 return{x:Math.round(Math.max(area.x+4,Math.min(area.x+area.width-w-4,rawX))),y:Math.round(Math.max(area.y+4,Math.min(area.y+area.height-h-4,rawY)))};
}
module.exports={ForegroundMonitor,hostPlacement,validBounds,characterPlacement,snapToEdges,contextMenuPlacement,hasNativeHelper};
