// Diagnostic only: never creates a scan, event, ACK, or business effect.
// Requires existing ffmpeg/ffprobe; --capture also requires fswebcam (no auto-install).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import zxing from '@zxing/library';

process.umask(0o077);
const args=process.argv.slice(2), options={};
for(let i=0;i<args.length;i++){
  if(args[i]==='--capture'){options.capture=true;continue;}
  if(!['--image','--device','--db','--task-id','--output'].includes(args[i])||!args[i+1])
    throw Error('Usage: --capture | --image PATH [--device /dev/video0] [--db PATH --task-id UUID] [--output PATH]');
  options[args[i].slice(2)]=args[++i];
}
if(Boolean(options.capture)===Boolean(options.image))throw Error('Choose exactly one: --capture or --image');
if(Boolean(options.db)!==Boolean(options['task-id']))throw Error('--db and --task-id must be provided together');
let image=options.image;
if(options.capture){
  mkdirSync('var/camera-photos',{recursive:true,mode:0o700});
  image=mkdtempSync('var/camera-photos/c270-')+'/frame.jpg';
  execFileSync('fswebcam',['-d',options.device||'/dev/video0','-r','1280x720','--no-banner','-S','10',image],
    {stdio:['ignore','ignore','pipe'],timeout:20000});
  chmodSync(image,0o600);
}
const metadata=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0',
  '-show_entries','stream=width,height','-of','json',image],{encoding:'utf8',timeout:10000}));
const {width,height}=metadata.streams[0]||{};
if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>16777216)
  throw Error('Unsupported image dimensions');
const gray=execFileSync('ffmpeg',['-v','error','-i',image,'-frames:v','1','-f','rawvideo','-pix_fmt','gray','pipe:1'],
  {maxBuffer:16777216,timeout:10000});
if(gray.length!==width*height)throw Error('Incomplete grayscale frame');
const bytes=readFileSync(image), report={
  observedAt:new Date().toISOString(), input:options.capture?'ACTUAL_V4L2_CAPTURE':'SAVED_IMAGE',
  imagePath:relative(process.cwd(),resolve(image)), width,height,bytes:bytes.length,
  sha256:createHash('sha256').update(bytes).digest('hex'),
  decode:'FAIL',businessEventsCreated:0,scope:'Photo diagnostic; not a live browser camera acceptance test'
};
const {QRCodeReader,BinaryBitmap,HybridBinarizer,RGBLuminanceSource}=zxing;
try{
  const text=new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(
    new RGBLuminanceSource(new Uint8ClampedArray(gray),width,height)))).getText();
  report.decode='PASS';
  report.projectProductQR=/^LOPS1:PRODUCT:[a-f0-9]{32}$/.test(text);
  if(options.db){
    const db=new DatabaseSync(options.db,{readOnly:true});
    try{
      const row=db.prepare('SELECT state FROM local_task_state WHERE task_id=?').get(options['task-id']);
      if(!row)throw Error('Selected local task not found');
      const state=JSON.parse(row.state);
      report.matchesSelectedProduct=state.items.some(item=>text==='LOPS1:PRODUCT:'+item.productId);
    }finally{db.close();}
  }
}catch(error){
  if(!['NotFoundException','ChecksumException','FormatException'].includes(error.constructor.name))throw error;
  report.decodeError=error.constructor.name;
}
const json=JSON.stringify(report,null,2)+'\n';
if(options.output)writeFileSync(options.output,json,{flag:'wx',mode:0o600});
console.log(json);
if(report.decode!=='PASS'||report.matchesSelectedProduct===false)process.exitCode=1;
