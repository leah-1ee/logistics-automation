import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QRCodeWriter,BarcodeFormat,RGBLuminanceSource,BinaryBitmap,HybridBinarizer,QRCodeReader } from '@zxing/library';
test('T08 software QR encode/decode round trip; physical webcam not covered',()=>{
  const text='LOPS1:PRODUCT:'+'a'.repeat(32),matrix=new QRCodeWriter().encode(text,BarcodeFormat.QR_CODE,240,240,new Map());
  const width=matrix.getWidth(),height=matrix.getHeight(),pixels=new Int32Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixels[y*width+x]=matrix.get(x,y)?0xff000000:0xffffffff;
  const source=new RGBLuminanceSource(pixels,width,height);const result=new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(source)));
  assert.equal(result.getText(),text);
});
