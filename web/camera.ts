export type CameraControls={stop():void};
type Start=(receive:(text:string,controls:CameraControls)=>void)=>Promise<CameraControls>;

/** A pending permission prompt or old frame must never scan a newly selected task. */
export class OneShotCamera {
  private generation=0;
  private controls:CameraControls|undefined;
  stop(){this.generation++;const controls=this.controls;this.controls=undefined;controls?.stop();}
  async read(taskId:string,start:Start,accept:(taskId:string,text:string)=>void,ended:()=>void){
    this.stop();const generation=this.generation;let consumed=false;
    try{
      const controls=await start((text,stream)=>{
        if(generation!==this.generation||consumed){stream.stop();return;}
        consumed=true;stream.stop();this.controls=undefined;ended();accept(taskId,text);
      });
      if(generation!==this.generation||consumed){controls.stop();return;}
      this.controls=controls;
    }catch(error){if(generation===this.generation&&!consumed)throw error;}
  }
}
