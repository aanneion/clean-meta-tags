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
// Regression: a Graphic Control Extension is a fixed 8-byte block (21 F9 04, four
// data bytes, then a 00 terminator). The scanner used to start walking sub-blocks
// one byte past that terminator, so it read the next block's introducer (0x2C, i.e.
// 44) as a sub-block length and swallowed every frame. Any GIF carrying a GCE --
// nearly all animated GIFs, plus static GIFs with transparency -- failed to clean.
const gifFrame=plainGif.subarray(gifStart,plainGif.length-1);          // descriptor + LZW data
const gifTail=plainGif.subarray(plainGif.length-1);                    // 0x3B trailer
const gifGce=Uint8Array.of(0x21,0xF9,0x04,0x04,0x0A,0x00,0x00,0x00);  // frame delay + transparency index
const gifLoop=get('concat')([Uint8Array.of(0x21,0xFF,0x0B),enc.encode('NETSCAPE2.0'),Uint8Array.of(0x03,0x01,0x00,0x00),Uint8Array.of(0x00)]);
const com=t=>Uint8Array.from([0x21,0xFE,t.length,...enc.encode(t),0]);
const animated=get('concat')([plainGif.subarray(0,gifStart),gifLoop,gifGce,gifFrame,gifGce,gifFrame,gifTail]);
const animNames=get('scanGIF')(animated).bl.map(s=>s.name);
assert.equal(get('scanGIF')(animated).err,undefined,'animated GIF must parse without error');
assert.equal(animNames.filter(n=>n==='Image frame').length,2,'both animation frames must be found');
assert.equal(animNames.filter(n=>n==='GCE').length,2,'each graphic control extension is its own block');
assert.equal(animNames.filter(n=>n==='Trailer').length,1,'trailer must be found after the last frame');
assert.equal(animNames.filter(n=>n==='NETSCAPE loop').length,1,'animation loop extension must be found');
assert.equal(get('scanGIF')(animated).bl.reduce((a,s)=>a+s.total,0),animated.length,'blocks must tile the file exactly with no overrun');
const animatedComment=get('concat')([plainGif.subarray(0,gifStart),gifLoop,com('secret'),gifGce,gifFrame,gifGce,gifFrame,gifTail]);
assert.deepEqual(Array.from(get('cleanGIF')(animatedComment,opts).bytes),Array.from(animated),'comment stripped from an animated GIF without touching frames, GCEs or loop');
const staticTransparent=get('concat')([plainGif.subarray(0,gifStart),gifGce,gifFrame,gifTail]);
assert.deepEqual(Array.from(get('cleanGIF')(get('concat')([plainGif.subarray(0,gifStart),gifGce,gifFrame,com('hi'),gifTail]),opts).bytes),Array.from(staticTransparent),'static GIF with transparency keeps its GCE and pixel data');
/* ---------------- standalone TIFF / DNG ---------------- */
// Fixtures are written by a small classic-TIFF writer rather than buildTIFF, because a
// photo TIFF has to look like the real thing: image structure and metadata sharing one
// directory, with strip data addressed by absolute offset -- exactly the layout the
// in-place cleaner must leave undisturbed.
function makeTIFF({le=true,meta=[],thumb=false,c2paIFD=false}={}){
  const chunks=[];let len=8;
  const put=(u8)=>{const at=len;chunks.push(u8.slice());len+=u8.length;return at;};
  const u16b=(v)=>le?Uint8Array.of(v&255,v>>8&255):Uint8Array.of(v>>8&255,v&255);
  const u32b=(v)=>{const a=new Uint8Array(4);const q=le?[0,8,16,24]:[24,16,8,0];q.forEach((s,i)=>a[i]=(v>>>s)&255);return a;};
  const a16=(s)=>Uint8Array.from([...enc.encode(s),0]);
  const px=Uint8Array.from([10,20,30,40,50,60,70,80,90,100,110,120,130,140,150,160,170,180,190,200,210,220,230,240]);
  const pxAt=put(px);
  const writeIFD=(tags)=>{
    const prep=tags.map(t=>{
      const bytes=t.raw?t.raw:(t.type===4?u32b(t.vals[0]):t.type===3?Uint8Array.from(t.vals.flatMap(v=>Array.from(u16b(v)))):Uint8Array.from(t.vals));
      const count=t.raw?t.raw.length:t.vals.length;
      return{tag:t.tag,type:t.type,bytes,count,inline:bytes.length<=4};
    });
    for(const t of prep)if(!t.inline){t.at=put(t.bytes);}
    const off=put(new Uint8Array(2+prep.length*12+4));
    const buf=chunks[chunks.length-1];
    buf.set(u16b(prep.length),0);
    prep.forEach((t,i)=>{
      const p=2+i*12;
      buf.set(u16b(t.tag),p);buf.set(u16b(t.type),p+2);buf.set(u32b(t.count),p+4);
      if(t.inline)buf.set(t.bytes,p+8);else buf.set(u32b(t.at),p+8);
    });
    return off;
  };
  const strip=[[0x0100,4,[4]],[0x0101,4,[2]],[0x0102,3,[8,8,8]],[0x0103,3,[1]],
    [0x0106,3,[2]],[0x0111,4,[pxAt]],[0x0116,4,[2]],[0x0117,4,[px.length]],[0x0115,3,[3]]];
  const flat=tags=>tags.map(t=>Array.isArray(t)?{tag:t[0],type:t[1],vals:t[2]}:t);
  const ifd0At=writeIFD(flat([...strip,...meta]));
  let ifd1At=0,c2paAt=0;
  if(thumb){
    const tpx=Uint8Array.from([1,2,3,4,5,6,7,8,9,10,11,12]);
    const tpxAt=put(tpx);
    ifd1At=writeIFD(flat([[0x00FE,4,[1]],[0x0100,4,[2]],[0x0101,4,[2]],[0x0102,3,[8,8,8]],
      [0x0103,3,[1]],[0x0106,3,[2]],[0x0111,4,[tpxAt]],[0x0116,4,[2]],[0x0117,4,[tpx.length]],
      {tag:0x0131,type:2,raw:a16('THUMB-SECRET')}]));
  }
  if(c2paIFD){
    c2paAt=writeIFD(flat([{tag:0xCD41,type:7,raw:Uint8Array.from([...enc.encode('C2PA-LAST-IFD'),0,0,0,0])}]));
  }
  const head=new Uint8Array(8);
  head[0]=head[1]=le?0x49:0x4D;
  head.set(u16b(42),2);head.set(u32b(ifd0At),4);
  const out=new Uint8Array(len);
  out.set(head,0);
  let p=8;for(const c of chunks){out.set(c,p);p+=c.length;}
  const n0=le?out[ifd0At]|out[ifd0At+1]<<8:out[ifd0At]<<8|out[ifd0At+1];
  const nextSlot=ifd0At+2+n0*12;
  if(ifd1At){out.set(u32b(ifd1At),nextSlot);if(c2paAt){const n1=le?out[ifd1At]|out[ifd1At+1]<<8:out[ifd1At]<<8|out[ifd1At+1];out.set(u32b(c2paAt),ifd1At+2+n1*12);}}
  else if(c2paAt)out.set(u32b(c2paAt),nextSlot);
  return{bytes:out,pxAt,px};
}
const A16=s=>({tag:0,type:2,raw:Uint8Array.from([...enc.encode(s),0])});
const META=[
  {...A16('SECRET-DESC'),tag:0x010E},
  {...A16('SECRETCAM'),tag:0x010F},
  {...A16('SECRET-SOFTWARE'),tag:0x0131},
  {...A16('SECRET-ARTIST'),tag:0x013B},
  {...A16('2026:01:02 03:04:05'),tag:0x0132},
  {tag:0x02BC,type:1,raw:Uint8Array.from([...enc.encode('XMP-MARKER trainedAlgorithmicMedia'),0])},
  {tag:0x83BB,type:1,raw:Uint8Array.from([...enc.encode('IPTC-MARKER'),0])},
  {tag:0xCD41,type:7,raw:Uint8Array.from([...enc.encode('C2PA-MARKER-BLOCK'),0])}
];
const has=(u8,s)=>Buffer.from(u8).includes(Buffer.from(s));

// 1. Every carrier is erased, structure and pixels are untouched, verify gate stays open.
for(const le of [true,false]){
  const {bytes,pxAt,px}=makeTIFF({le,meta:META});
  assert.equal(get('scanTIFFFile')(bytes).err,undefined,'well-formed TIFF must scan cleanly');
  const A=get('analyze')(bytes,'image/tiff','p.tiff');
  assert.equal(A.format,'TIFF');assert.equal(A.w,4);assert.equal(A.h,2);
  assert.ok(A.flags.c2pa,'C2PA tag 0xCD41 must be reported');
  assert.ok(A.flags.xmp,'XMP tag must be reported');
  assert.ok(A.flags.iptc,'IPTC tag must be reported');
  assert.ok(A.aiHints.length,'the C2PA store must raise an AI/provenance hint');
  // structural tags must not be reported as personal data, or every download is blocked
  assert.equal(A.exifTags.filter(t=>t.cat!=='sys'&&t.cat!=='orient').length,8,
    'only the eight real metadata tags may count; image structure must classify as sys');
  const {bytes:out,log}=get('cleanTIFF')(bytes,opts);
  for(const s of ['SECRET-DESC','SECRETCAM','SECRET-SOFTWARE','SECRET-ARTIST','2026:01:02','XMP-MARKER','IPTC-MARKER','C2PA-MARKER-BLOCK'])
    assert.equal(has(out,s),false,'TIFF carrier must be erased, not merely unreferenced: '+s);
  assert.equal(out.length,bytes.length,'lossless TIFF cleaning must not change the file length');
  const after=get('scanTIFFFile')(out);
  assert.equal(after.err,undefined,'cleaned TIFF must still parse');
  assert.equal(after.ifds.length,1,'the single image directory must survive');
  const so=after.ifds[0].entries.find(e=>e.tag===0x0111);
  assert.ok(so,'StripOffsets must survive');
  assert.equal(get('tifVals')(out,le,so)[0],pxAt,'StripOffsets must still point at the original pixel data');
  assert.deepEqual(Array.from(out.subarray(pxAt,pxAt+px.length)),Array.from(px),'TIFF pixel data must be byte-identical');
  // the verify gate re-analyzes the output: nothing may be left to block the download
  const A2=get('analyze')(out,'image/tiff','p.tiff');
  assert.equal(A2.exifTags.filter(t=>t.cat!=='sys'&&t.cat!=='orient').length,0,'no removable tag may survive into the verify gate');
  assert.equal(!!(A2.flags.c2pa||A2.flags.xmp||A2.aiHints.length),false,'no provenance signal may survive');
  assert.ok(log.some(l=>l.kind==='c2pa'),'the removed C2PA store must be logged');
  assert.ok(log.some(l=>l.kind==='gps'||l.kind==='time'||l.kind==='author'),'removed tags must be logged by kind');
}

// 2. A metadata-only trailing directory (what c2patool appends) is dropped whole.
{
  const {bytes}=makeTIFF({meta:META,c2paIFD:true});
  assert.equal(get('scanTIFFFile')(bytes).ifds.length,2,'fixture must have two directories');
  const {bytes:out}=get('cleanTIFF')(bytes,opts);
  assert.equal(get('scanTIFFFile')(out).ifds.length,1,'a metadata-only directory must be unlinked from the chain');
  assert.equal(has(out,'C2PA-LAST-IFD'),false,'the trailing C2PA payload must be erased');
}

// 3. A thumbnail directory is dropped when thumbnails are on, and kept but stripped when off.
{
  const {bytes}=makeTIFF({meta:META,thumb:true});
  assert.equal(get('scanTIFFFile')(bytes).thumbs,1,'the reduced-resolution directory must be recognised as a thumbnail');
  const on=get('cleanTIFF')(bytes,opts);
  assert.equal(get('scanTIFFFile')(on.bytes).ifds.length,1,'thumbnail directory removed when thumb removal is on');
  assert.equal(has(on.bytes,'THUMB-SECRET'),false,'thumbnail metadata must be erased with its directory');
  const off=get('cleanTIFF')(bytes,{...opts,thumb:false});
  assert.equal(get('scanTIFFFile')(off.bytes).ifds.length,2,'thumbnail directory kept when thumb removal is off');
  assert.equal(has(off.bytes,'THUMB-SECRET'),false,'kept thumbnail must still lose its metadata');
  assert.equal(has(off.bytes,'SECRET-ARTIST'),false,'primary metadata still removed in that mode');
}

// 4. Unsafe or unsupported inputs are refused by name rather than mangled.
{
  const big=makeTIFF({meta:META}).bytes.slice(0,40);
  big[2]=43;                                                       // BigTIFF magic
  assert.throws(()=>get('cleanTIFF')(big,opts),/BigTIFF/,'BigTIFF must be refused, not rewritten');
  assert.throws(()=>get('cleanTIFF')(Uint8Array.of(1,2,3),opts),/Too short|TIFF/,'a runt file must be refused');
  const loop=makeTIFF({meta:[]}).bytes.slice();
  // point IFD0's next pointer back at IFD0 itself
  const i0=loop[4]|loop[5]<<8|loop[6]<<16|loop[7]<<24;    // little-endian header
  const n0=loop[i0]|loop[i0+1]<<8;
  loop.set(Uint8Array.of(i0&255,i0>>8&255,i0>>16&255,i0>>24&255),i0+2+n0*12);
  assert.throws(()=>get('cleanTIFF')(loop,opts),/loops back/,'a cyclic directory chain must be refused');
}

const z=get('buildZip')([{name:'clean.jpg',data:cleanJ.bytes},{name:'clean.png',data:cleanP.bytes}]);
assert.ok(z.size>0);
(async()=>{
  const item={bytes:jpeg,mime:'image/jpeg',name:'sample.jpg',analysis:get('analyze')(jpeg,'image/jpeg','sample.jpg')};
  const result=await get('cleanItem')(item);
  assert.equal(result.verify.aiLeft,false,'cleaning pipeline must re-scan and reject remaining AI metadata');
  assert.equal(get('scanJPEG')(result.bytes).segs.some(x=>x.kind==='c2pa'),false);
  console.log('Engine tests passed: EXIF, JPEG, PNG, WebP, GIF, mandatory AI-tag removal, ZIP.');
})().catch(e=>{console.error(e);process.exitCode=1;});
