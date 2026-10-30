// Run with: node tests/engine.test.cjs
// Isolated tests of the self-contained browser byte engine (no browser or network needed).
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(new URL('../index.html', `file://${__filename}`), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1].split('/* ============================== UI ============================== */')[0];
const c = vm.createContext({TextEncoder, TextDecoder, Uint8Array, Uint32Array, DataView, ArrayBuffer, Blob, performance});
vm.runInContext(source, c);
function get(code){return vm.runInContext(code, c);}
const opts = get('({...S.opts})');
const enc = new TextEncoder();
const entry=(tag,type,count,data)=>({tag,type,count,data});
const gps=[entry(1,2,2,enc.encode('N\0')),entry(2,5,1,Uint8Array.of(23,0,0,0,1,0,0,0))];
const exif=[entry(0x8827,3,1,Uint8Array.of(100,0))];
const tiff=get('buildTIFF')(true,[
  entry(0x010f,2,6,enc.encode('Canon\0')),
  {...entry(0x8769,4,1,new Uint8Array(4)),sub:exif,subName:'exif'},
  {...entry(0x8825,4,1,new Uint8Array(4)),sub:gps,subName:'gps'}
],null,null);
assert.ok(get('parseTIFF')(tiff).gps.length > 0);
const stripped = get('filterExif')(get('parseTIFF')(tiff), opts);
assert.equal(stripped.ifd0.length, 0, 'default should remove all EXIF fields');
const keep = {...opts, gps:false, camera:false, time:false, author:false, thumb:false};
const re = get('buildTIFF')(true, get('filterExif')(get('parseTIFF')(tiff), keep).ifd0, null, null);
assert.ok(get('parseTIFF')(re).gps.length, 'selective cleaning must retain GPS when toggled off');
const exifSeg = get('exifSeg')(tiff);
function marker(m,data){const b = new Uint8Array(4+data.length);b.set([255,m,(data.length+2)>>8,(data.length+2)&255]);b.set(data,4);return b;}
const jpeg = get('concat')([
  Uint8Array.from([255,216]), exifSeg,
  marker(0xEB, enc.encode('JP\0C2PA demo')),
  marker(0xE2, enc.encode('ICC_PROFILE\0hidden profile')),
  marker(0xE1, enc.encode('http://ns.adobe.com/xap/1.0/\0<xmp/>')),
  marker(0xDA,Uint8Array.from([1,1,0,0,63,0])),
  Uint8Array.from([1,2,3,255,0,4,255,217]), enc.encode('GPS SECRET TRAILING')
]);
const scanned = get('scanJPEG')(jpeg);
assert.ok(scanned.segs.some(x=>x.kind==='trailing'));
const cleanJ = get('cleanJPEG')(jpeg,opts);
assert.equal(get('scanJPEG')(cleanJ.bytes).segs.some(x=>x.kind==='trailing'), false);
assert.equal(get('scanJPEG')(cleanJ.bytes).segs.some(x=>['exif','xmp','c2pa','icc'].includes(x.kind)), false);
assert.deepEqual(Array.from(cleanJ.bytes.slice(-8)), [1,2,3,255,0,4,255,217], 'compressed scan and EOI remain untouched');
const iccJ = get('cleanJPEG')(jpeg, {...opts, ai:false});
assert.equal(get('scanJPEG')(iccJ.bytes).segs.some(x=>x.kind==='c2pa'), false, 'C2PA removal cannot be disabled');
const multiScan=get('concat')([
  Uint8Array.from([255,216]),marker(0xDA,Uint8Array.from([1,1,0,0,63,0])),
  Uint8Array.from([11,255,0,12,255,0xD0,13]),
  marker(0xEB,enc.encode('JP\0hidden inter-scan C2PA')),
  marker(0xFE,enc.encode('inter-scan comment')),
  marker(0xDA,Uint8Array.from([1,1,0,0,63,0])),
  Uint8Array.from([21,22,255,217])
]);
const multiClean=get('cleanJPEG')(multiScan,opts);
assert.equal(get('scanJPEG')(multiClean.bytes).segs.filter(s=>s.m===-1).length,2,'both compressed scans retained');
assert.equal(get('scanJPEG')(multiClean.bytes).segs.some(s=>s.kind==='c2pa'||s.kind==='com'),false,'metadata between scans removed');
const png = get('concat')([Uint8Array.from([137,80,78,71,13,10,26,10]),
  get('pngChunk')('IHDR',Uint8Array.from([0,0,0,1,0,0,0,1,8,6,0,0,0])),
  get('pngChunk')('tEXt',enc.encode('Author\0secret')),
  get('pngChunk')('pHYs',Uint8Array.from([0,0,1,0,0,0,1,0,1])),
  get('pngChunk')('iCCP',enc.encode('Hidden color profile')),
  get('pngChunk')('caBX',enc.encode('JUMBF demo')),
  get('pngChunk')('eXIf',tiff),
  get('pngChunk')('IDAT',Uint8Array.from([1,2,3])),
  get('pngChunk')('IEND',new Uint8Array())]);
const cleanP = get('cleanPNG')(png,opts);
assert.deepEqual(Array.from(get('scanPNG')(cleanP.bytes).ch, c=>c.type), ['IHDR','IDAT','IEND']);
assert.equal(get('scanPNG')(get('cleanPNG')(png,{...opts,ai:false}).bytes).ch.some(c=>c.type==='caBX'),false, 'PNG C2PA cannot be retained');
assert.throws(()=>get('cleanPNG')(png.slice(0,-5),opts),/PNG/);
const badCRC=png.slice();badCRC[29]^=1;
assert.throws(()=>get('cleanPNG')(badCRC,opts),/checksum/,'corrupt PNG must not be marked clean');
const webp= get('concat')([enc.encode('RIFF'), Uint8Array.from([0,0,0,0]),enc.encode('WEBP'),
  enc.encode('VP8L'), Uint8Array.from([5,0,0,0,47,0,0,0,0,0]),
  enc.encode('JUMB'),Uint8Array.from([4,0,0,0,1,2,3,4]),
  enc.encode('C2PA'),Uint8Array.from([4,0,0,0,9,8,7,6]),
  enc.encode('ICCP'),Uint8Array.from([4,0,0,0,1,2,3,4]),
  enc.encode('VEND'),Uint8Array.from([4,0,0,0,5,6,7,8]),
  enc.encode('EXIF'), Uint8Array.from([tiff.length,0,0,0]), tiff, Uint8Array.from(tiff.length%2?[0]:[])]);
new DataView(webp.buffer).setUint32(4,webp.length-8,true);
const cleanW=get('cleanWEBP')(webp,opts);
assert.equal(get('scanWEBP')(cleanW.bytes).ch.some(c=>['exif','c2pa','otherapp','icc'].includes(c.kind)),false);
assert.equal(get('scanWEBP')(get('cleanWEBP')(webp,{...opts,ai:false}).bytes).ch.some(c=>c.kind==='c2pa'),false, 'WebP C2PA cannot be retained');
assert.equal(new DataView(cleanW.bytes.buffer).getUint32(4,true), cleanW.bytes.length-8);
const plainGif=Uint8Array.from(Buffer.from('R0lGODdhAQABAIEAAP8AAAAAAAAAAAAAACwAAAAAAQABAAAIBAABBAQAOw==','base64'));
const gifStart=get('scanGIF')(plainGif).bl[0].total;
const withComment=get('concat')([plainGif.subarray(0,gifStart),Uint8Array.from([0x21,0xFE,6,...enc.encode('AI tag'),0]),plainGif.subarray(gifStart)]);
assert.deepEqual(Array.from(get('cleanGIF')(withComment,opts).bytes),Array.from(plainGif),'GIF comment removed without altering frames');
const z=get('buildZip')([{name:'clean.jpg',data:cleanJ.bytes},{name:'clean.png',data:cleanP.bytes}]);
assert.ok(z.size>0);
(async()=>{
  const item={bytes:jpeg,mime:'image/jpeg',name:'sample.jpg',analysis:get('analyze')(jpeg,'image/jpeg','sample.jpg')};
  const result=await get('cleanItem')(item);
  assert.equal(result.verify.aiLeft,false,'cleaning pipeline must re-scan and reject remaining AI metadata');
  assert.equal(get('scanJPEG')(result.bytes).segs.some(x=>x.kind==='c2pa'),false);
  console.log('Engine tests passed: EXIF, JPEG, PNG, WebP, GIF, mandatory AI-tag removal, ZIP.');
})().catch(e=>{console.error(e);process.exitCode=1;});
