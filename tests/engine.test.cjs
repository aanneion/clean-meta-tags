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

/* ---------------- AVIF / HEIC (ISO BMFF) ---------------- */
// A minimal but structurally real BMFF container: ftyp, a FullBox `meta` holding an item
// table, an optional C2PA `uuid` box, then mdat with the item payloads.
function makeBMFF({brand='avif',exif=true,xmp=false,c2pa=false}={}){
  const box=(type,payload)=>{
    const b=new Uint8Array(8+payload.length);
    b[0]=(b.length>>>24)&255;b[1]=(b.length>>>16)&255;b[2]=(b.length>>>8)&255;b[3]=b.length&255;
    for(let i=0;i<4;i++)b[4+i]=type.charCodeAt(i);
    b.set(payload,8);
    return b;
  };
  const cat=(list)=>get('concat')(list);
  const be=(v)=>Uint8Array.of((v>>>24)&255,(v>>>16)&255,(v>>>8)&255,v&255);
  const be16=(v)=>Uint8Array.of((v>>8)&255,v&255);
  const ascii=s=>Uint8Array.from([...enc.encode(s)]);
  const imageData=Uint8Array.from({length:64},(_,i)=>(i*37)&255);
  // An Exif item starts with a 4-byte offset to its TIFF header, measured from the end of
  // that field; 6 skips the following "Exif\0\0".
  const exifData=cat([be(6),ascii('Exif\0\0'),
    Uint8Array.from([0x4D,0x4D,0,42,0,0,0,8]),               // big-endian TIFF stub
    Uint8Array.from([0,1]),                                   // 1 entry
    Uint8Array.from([0x01,0x0F,0,2,0,0,0,10,0,0,0,26]),       // Make, ASCII, offset 26
    Uint8Array.from([0,0,0,0]),                               // next IFD
    ascii('SECRETCAM\0')]);
  const xmpData=ascii('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF/></x:xmpmeta>');
  // item ids: 1 = primary image, 2 = Exif, 3 = XMP
  const items=[{id:1,type:'av01',name:'Color\0',data:imageData}];
  if(exif)items.push({id:2,type:'Exif',name:'\0',data:exifData});
  if(xmp)items.push({id:3,type:'mime',name:'XMP\0application/rdf+xml\0',data:xmpData});
  const infe=it=>{
    const nameBytes=ascii(it.name);
    const p=cat([Uint8Array.from([2,0,0,0]),be16(it.id),be16(0),ascii(it.type),nameBytes]);
    return box('infe',p);
  };
  const iinfBodies=items.map(infe);
  const iinfPayload=cat([Uint8Array.from([0,0,0,0]),be16(items.length),...iinfBodies]);
  const iinf=box('iinf',iinfPayload);
  const pitm=box('pitm',cat([Uint8Array.from([0,0,0,0]),be16(1)]));
  const hdlr=box('hdlr',cat([Uint8Array.from([0,0,0,0,0,0,0,0]),ascii('pict'),Uint8Array.from([0,0,0,0,0,0,0,0,0])]));
  const ispe=box('ispe',cat([Uint8Array.from([0,0,0,0]),be(4),be(2)]));
  const ipco=box('ipco',ispe);
  const ipma=box('ipma',cat([Uint8Array.from([0,0,0,0]),be(1),be16(1),Uint8Array.from([1,0x81])]));
  const iprp=box('iprp',cat([ipco,ipma]));
  // iloc: v0, offset_size=4, length_size=4, base=0. Offsets are absolute, so they are
  // patched once the mdat position is known.
  const ilocEntryCount=items.length;
  const ilocSize=8+4+2+2+items.length*(2+2+2+8);
  const iloc=new Uint8Array(ilocSize);
  let p=0;
  iloc.set(be(ilocSize),p);p+=4;iloc.set(ascii('iloc'),p);p+=4;
  iloc.set([0,0,0,0],p);p+=4;
  iloc[p++]=0x44;iloc[p++]=0x00;                              // offset_size=4 len_size=4
  iloc[p++]=ilocEntryCount>>8;iloc[p++]=ilocEntryCount&255;p+=0;
  for(const it of items){
    iloc[p++]=it.id>>8;iloc[p++]=it.id&255;
    iloc[p++]=0;iloc[p++]=0;                                  // data_reference_index
    iloc[p++]=0;iloc[p++]=1;                                  // one extent
    p+=8;                                                     // offset+length, patched below
  }
  const metaChildren=cat([hdlr,pitm,iloc,iinf,iprp]);
  const meta=box('meta',cat([Uint8Array.from([0,0,0,0]),metaChildren]));
  const ftyp=box('ftyp',cat([ascii(brand),be(0),ascii('mif1'),ascii('miaf')]));
  const uuidPayload=cat([Uint8Array.from(get('BMFF_C2PA_UUID')),Uint8Array.from([0]),ascii('C2PA-UUID-MARKER')]);
  const uuidBox=c2pa?box('uuid',uuidPayload):new Uint8Array(0);
  const ftypLen=ftyp.length,metaLen=meta.length;
  const mdatStart=ftypLen+metaLen+uuidBox.length+8;
  // Patch iloc offsets now that mdat's payload position is known. The entry list starts
  // after the 8-byte box header, the 4-byte version/flags, the 2 width bytes and the
  // 2-byte entry count.
  let ip=8+4+2+2;
  let cursor=mdatStart;
  for(const it of items){
    ip+=4;                                                    // skip id + data_ref
    ip+=2;                                                    // skip extent_count
    iloc[ip]=(cursor>>>24)&255;iloc[ip+1]=(cursor>>>16)&255;iloc[ip+2]=(cursor>>>8)&255;iloc[ip+3]=cursor&255;
    iloc[ip+4]=(it.data.length>>>24)&255;iloc[ip+5]=(it.data.length>>>16)&255;
    iloc[ip+6]=(it.data.length>>>8)&255;iloc[ip+7]=it.data.length&255;
    ip+=8;cursor+=it.data.length;
  }
  const meta2=box('meta',cat([Uint8Array.from([0,0,0,0]),cat([hdlr,pitm,iloc,iinf,iprp])]));
  const mdat=box('mdat',cat(items.map(i=>i.data)));
  const all=cat([ftyp,meta2,uuidBox,mdat]);
  return{bytes:all,imageData,exifData,mdatStart,items};
}

// 1. AVIF: Exif item removed, image bytes untouched, table rebuilt, length unchanged.
{
  const {bytes,imageData}=makeBMFF({exif:true});
  const scan=get('scanBMFFFile')(bytes);
  assert.equal(scan.err,undefined,'a well-formed AVIF must scan cleanly');
  assert.equal(scan.brand,'avif');
  assert.equal(scan.w,4);assert.equal(scan.h,2);
  assert.deepEqual(Array.from(scan.iinf.items.map(i=>i.type)),['av01','Exif'],'both items must be listed');
  const A=get('analyze')(bytes,'image/avif','p.avif');
  assert.equal(A.format,'AVIF');
  assert.ok(A.flags.exif,'the Exif item must be reported');
  assert.ok(A.exifTags.some(t=>t.name==='Make'),'Exif fields must be parsed out of the item');
  const {bytes:out,log}=get('cleanBMFF')(bytes,opts);
  const after=get('scanBMFFFile')(out);
  assert.equal(after.err,undefined,'cleaned AVIF must still parse');
  assert.deepEqual(Array.from(after.iinf.items.map(i=>i.type)),['av01'],'only the image item may remain');
  assert.equal(after.iloc.entries.length,1,'the location table must drop the removed item too');
  assert.equal(out.length,bytes.length,'lossless BMFF cleaning must not change the file length');
  // the encoded image payload is untouched, byte for byte
  const imgRange=get('bmItemRanges')(out,after.iloc,after.idat,1);
  assert.equal(imgRange.length,1);
  assert.deepEqual(Array.from(out.subarray(imgRange[0][0],imgRange[0][1])),Array.from(imageData),
    'the compressed image item must be byte-identical');
  assert.equal(Buffer.from(out).includes(Buffer.from('SECRETCAM')),false,'Exif payload must be erased');
  assert.ok(log.some(l=>l.kind==='exif'),'the removed Exif item must be logged');
  const A2=get('analyze')(out,'image/avif','p.avif');
  assert.equal(A2.exifTags.length,0,'no Exif may survive into the verify gate');
  assert.equal(!!(A2.flags.c2pa||A2.flags.xmp||A2.aiHints.length),false,'no provenance signal may survive');
}

// 2. XMP mime item removed.
{
  const {bytes}=makeBMFF({exif:false,xmp:true});
  const scan=get('scanBMFFFile')(bytes);
  assert.deepEqual(Array.from(scan.iinf.items.map(i=>i.type)),['av01','mime']);
  const A=get('analyze')(bytes,'image/avif','p.avif');
  assert.ok(A.flags.xmp,'the XMP mime item must be reported');
  const {bytes:out}=get('cleanBMFF')(bytes,opts);
  assert.deepEqual(Array.from(get('scanBMFFFile')(out).iinf.items.map(i=>i.type)),['av01'],'only the image item may remain');
  assert.equal(out.length,bytes.length);
}

// 3. C2PA uuid box is replaced by an equally sized `free` box, so nothing moves.
{
  const {bytes}=makeBMFF({exif:true,c2pa:true});
  const scan=get('scanBMFFFile')(bytes);
  assert.equal(scan.uuids.length,1,'the C2PA uuid box must be recognised');
  assert.equal(scan.uuids[0].kind,'c2pa');
  const A=get('analyze')(bytes,'image/avif','p.avif');
  assert.ok(A.flags.c2pa,'C2PA must be reported');
  assert.ok(A.aiHints.length,'C2PA must raise an AI/provenance hint');
  const {bytes:out}=get('cleanBMFF')(bytes,opts);
  const after=get('scanBMFFFile')(out);
  assert.equal(after.uuids.length,0,'no C2PA box may survive');
  const wasFree=bmFindTop(out,'free');
  assert.ok(wasFree,'the C2PA box must be replaced by a free box');
  assert.equal(wasFree.size,scan.uuids[0].box.size,'the free box must be exactly the same size');
  assert.equal(after.meta.start,scan.meta.start,'meta must not move');
  const mdatBefore=bmFindTop(bytes,'mdat'),mdatAfter=bmFindTop(out,'mdat');
  assert.equal(mdatAfter.start,mdatBefore.start,'mdat must not move, so item offsets stay valid');
  assert.equal(out.length,bytes.length);
  assert.equal(Buffer.from(out).includes(Buffer.from('C2PA-UUID-MARKER')),false,'the manifest must be erased');
}
function bmFindTop(b,type){return get('bmBoxes')(b,0,b.length).find(x=>x.type===type);}

// 4. HEIC uses the same item table.
{
  const {bytes}=makeBMFF({brand:'heic',exif:true});
  assert.equal(get('detectFormat')(bytes,'','x.heic'),'HEIC');
  assert.equal(get('scanBMFFFile')(bytes).brand,'heic');
  const {bytes:out}=get('cleanBMFF')(bytes,opts);
  assert.deepEqual(Array.from(get('scanBMFFFile')(out).iinf.items.map(i=>i.type)),['av01']);
  assert.equal(out.length,bytes.length);
}

// 5. Refusals: a file with no usable item table is left alone, not mangled.
{
  assert.throws(()=>get('cleanBMFF')(Uint8Array.from([0,0,0,8,0x66,0x74,0x79,0x70]),opts),/ftyp|too short|No meta/i);
  const {bytes}=makeBMFF({exif:true});
  const broken=bytes.slice(0,60);                            // truncate inside meta
  assert.throws(()=>get('cleanBMFF')(broken,opts),/left untouched|No meta|item table|too short/i,
    'a truncated BMFF must be refused rather than rewritten');
}

/* ---------------- JPEG XL ---------------- */
// Per ISO 18181-2: a 12-byte "JXL " signature box first, "ftyp" second, then the
// codestream and any metadata boxes. A "brob" box holds the type it wraps in its first
// 4 uncompressed bytes, which is how Brotli-wrapped Exif is recognised without inflating.
function makeJXL({exif=true,xmp=true,c2pa=true,brob=false}={}){
  const box=(type,payload)=>{
    const b=new Uint8Array(8+payload.length);
    b[0]=(b.length>>>24)&255;b[1]=(b.length>>>16)&255;b[2]=(b.length>>>8)&255;b[3]=b.length&255;
    for(let i=0;i<4;i++)b[4+i]=type.charCodeAt(i);
    b.set(payload,8);
    return b;
  };
  const cat=list=>get('concat')(list);
  const ascii=s=>Uint8Array.from([...enc.encode(s)]);
  const sig=Uint8Array.from([0,0,0,12,...ascii('JXL '),0x0D,0x0A,0x87,0x0A]);
  const ftyp=box('ftyp',cat([ascii('jxl '),Uint8Array.from([0,0,0,0]),ascii('jxl ')]));
  const codestream=Uint8Array.from({length:120},(_,i)=>(i*13)&255);
  const jxlc=box('jxlc',codestream);
  const parts=[sig,ftyp,jxlc];
  const exifPayload=cat([Uint8Array.from([0,0,0,0]),ascii('Exif\0\0'),Uint8Array.from([0x4D,0x4D,0,42])]);
  if(exif)parts.push(brob?box('brob',cat([ascii('Exif'),Uint8Array.from([0x1b,0x06,0x00,0x00,0x99])])):box('Exif',exifPayload));
  if(xmp)parts.push(box('xml ',ascii('<x:xmpmeta><rdf:RDF/></x:xmpmeta>')));
  if(c2pa)parts.push(box('jumb',cat([ascii('jumbf'),Uint8Array.from([0,1,0,2])])));
  return{bytes:cat(parts),codestream,jxlc};
}

// 1. Every metadata box is removed; signature and codestream are untouched.
{
  const {bytes,codestream}=makeJXL({exif:true,xmp:true,c2pa:true});
  const scan=get('scanJXLFile')(bytes);
  assert.equal(scan.err,undefined,'a well-formed JXL must scan cleanly');
  assert.deepEqual(Array.from(scan.boxes.map(x=>x.type)),['JXL ','ftyp','jxlc','Exif','xml ','jumb'],
    'all boxes must be found in order');
  assert.deepEqual(Array.from(scan.meta.map(m=>m.kind)),['exif','xmp','c2pa']);
  const A=get('analyze')(bytes,'image/jxl','p.jxl');
  assert.equal(A.format,'JXL');
  assert.ok(A.flags.exif&&A.flags.xmp&&A.flags.c2pa,'Exif, XMP and C2PA must all be reported');
  assert.ok(A.aiHints.length,'JUMBF must raise an AI/provenance hint');
  const {bytes:out,log}=get('cleanJXL')(bytes,opts);
  const after=get('scanJXLFile')(out);
  assert.equal(after.err,undefined,'cleaned JXL must still parse');
  assert.equal(after.meta.length,0,'no metadata box may survive');
  assert.deepEqual(Array.from(after.boxes.map(x=>x.type)),['JXL ','ftyp','jxlc'],
    'only the signature, file type and codestream boxes may remain');
  assert.equal(after.boxes[0].type,'JXL ','the mandatory signature box must stay first');
  assert.equal(after.boxes[1].type,'ftyp','the mandatory file type box must stay second');
  assert.equal(after.boxes[0].size,12,'the signature box must stay exactly 12 bytes');
  // the codestream box is copied verbatim, including its header
  assert.equal(after.codestream[0].size,8+codestream.length);
  assert.deepEqual(Array.from(out.subarray(after.codestream[0].payload,after.codestream[0].end)),
    Array.from(codestream),'the JPEG XL codestream must be byte-identical');
  assert.equal(log.length,3,'all three removed carriers must be logged');
  const A2=get('analyze')(out,'image/jxl','p.jxl');
  assert.equal(!!(A2.flags.c2pa||A2.flags.exif||A2.flags.xmp||A2.aiHints.length),false,
    'no metadata may survive into the verify gate');
}

// 2. A Brotli-wrapped ("brob") Exif box is recognised and removed without inflating it.
{
  const {bytes}=makeJXL({exif:true,xmp:false,c2pa:false,brob:true});
  const scan=get('scanJXLFile')(bytes);
  assert.equal(scan.meta.length,1,'a brob box wrapping Exif must be recognised');
  assert.equal(scan.meta[0].kind,'exif');
  assert.equal(scan.meta[0].compressed,true);
  const {bytes:out}=get('cleanJXL')(bytes,opts);
  assert.equal(get('scanJXLFile')(out).meta.length,0,'the brob-wrapped Exif must be removed');
  assert.equal(Buffer.from(out).includes(Buffer.from('brob')),false,'the brob box must be gone entirely');
}

// 3. A bare codestream has no container, so it is returned untouched rather than rebuilt.
{
  const bare=Uint8Array.from([0xFF,0x0A,0x04,0x20,0x08,0x4C,0x50,0x00]);
  assert.equal(get('detectFormat')(bare,'','x.jxl'),'JXL','a bare codestream must be recognised');
  const r=get('cleanJXL')(bare,opts);
  assert.deepEqual(Array.from(r.bytes),Array.from(bare),'a bare codestream must be returned unchanged');
  assert.ok(r.notes.length,'the reason must be explained');
}

// 4. Refusals: broken framing is never rebuilt.
{
  const {bytes}=makeJXL({});
  assert.throws(()=>get('cleanJXL')(Uint8Array.from([0,0,0,12,0x4A,0x58,0x4C,0x20,0,0,0,0]),opts),
    /signature|file type|codestream|left untouched/i,'a bad signature must be refused');
  const noFtyp=bytes.slice(0,12);
  assert.throws(()=>get('cleanJXL')(noFtyp,opts),/file type|codestream|framing|left untouched/i,
    'a container without ftyp must be refused');
  // a box size that runs past the end of the file must not be trusted
  const overrun=bytes.slice();
  overrun[32]=(0xFF);
  assert.throws(()=>get('cleanJXL')(overrun,opts),/framing|codestream|left untouched/i,
    'a box overrunning the file must be refused');
}

/* ---------------- BMP (embedded ICC in the V5 header) ---------------- */
// A bitmap has no metadata chunks; the only removable carrier is the colour profile blob
// that the V5 header points at. Building one exercises the offset/size pair exactly.
function makeBMPV5({profile=true,iccLen=256}={}){
  const le=(v,n)=>{const a=new Uint8Array(n);for(let i=0;i<n;i++)a[i]=(v>>>(i*8))&255;return a;};
  const cat=list=>get('concat')(list);
  const w=4,h=2,rowbytes=((w*3+3)>>2)*4;
  const px=[];
  for(let y=0;y<h;y++){
    const row=[];
    for(let x=0;x<w;x++)row.push((x*30)&255,(y*60)&255,(x*y*7)&255);
    while(row.length<rowbytes)row.push(0);
    px.push(...row);
  }
  const profileBytes=[];
  // A stand-in profile with the real 'acsp' signature at offset 36.
  for(let i=0;i<iccLen;i++)profileBytes.push(i>=36&&i<40?"acsp".charCodeAt(i-36):(i*7)&255);
  const profileOff=14+124;
  const pxOff=profileOff+(profile?iccLen:0);
  const fileSize=pxOff+px.length;
  const head=cat([
    enc.encode('BM'),le(fileSize,4),le(0,4),le(pxOff,4),
    le(124,4),le(w,4),le(h,4),le(1,2),le(24,2),le(0,4),le(px.length,4),
    le(2835,4),le(2835,4),le(0,4),le(0,4),
    le(0x00FF0000,4),le(0x0000FF00,4),le(0x000000FF,4),le(0xFF000000,4),
    le(0x73524742,4),new Uint8Array(36),le(0,4),le(0,4),le(0,4),
    le(0,4),le(profile?profileOff:0,4),le(profile?iccLen:0,4),le(0,4)
  ]);
  return{bytes:cat([head,profile?Uint8Array.from(profileBytes):new Uint8Array(0),Uint8Array.from(px)]),
    px:Uint8Array.from(px),iccLen};
}

// 1. The profile is removed, both offsets corrected, pixels preserved.
{
  const {bytes,px,iccLen}=makeBMPV5({profile:true});
  const scan=get('scanBMPFile')(bytes);
  assert.equal(scan.err,undefined,'a well-formed BMP must scan cleanly');
  assert.equal(scan.dib,124,'the V5 header must be recognised');
  assert.equal(scan.w,4);assert.equal(scan.h,2);assert.equal(scan.bpp,24);
  assert.ok(scan.profile,'the embedded profile must be found');
  assert.equal(scan.profile.size,iccLen);
  const A=get('analyze')(bytes,'image/bmp','p.bmp');
  assert.equal(A.format,'BMP');
  assert.ok(A.flags.icc,'the embedded profile must be reported');
  // A bitmap cannot carry EXIF/XMP/C2PA, so nothing else may be reported.
  assert.equal(!!(A.flags.exif||A.flags.xmp||A.flags.c2pa||A.aiHints.length),false,
    'a bitmap must not be reported as carrying EXIF, XMP or C2PA');
  const {bytes:out,log}=get('cleanBMP')(bytes,opts);
  assert.equal(out.length,bytes.length-iccLen,'the file must shrink by exactly the profile size');
  const after=get('scanBMPFile')(out);
  assert.equal(after.err,undefined,'cleaned BMP must still parse');
  assert.equal(after.profile,null,'the profile must be gone');
  assert.equal(after.pixelOffset,scan.pixelOffset-iccLen,'the pixel offset must be corrected');
  assert.equal(after.fileSize,out.length,'the file size field must be corrected');
  assert.equal(after.w,scan.w);assert.equal(after.h,scan.h);assert.equal(after.bpp,scan.bpp);
  assert.deepEqual(Array.from(out.subarray(after.pixelOffset)),Array.from(px),
    'every pixel byte must survive, just relocated');
  assert.equal(Buffer.from(out).includes(Buffer.from('acsp')),false,'the profile must be erased, not orphaned');
  assert.ok(log.some(l=>l.kind==='icc'),'the removed profile must be logged');
  // and it must pass the verify gate
  const A2=get('analyze')(out,'image/bmp','p.bmp');
  assert.equal(!!A2.flags.icc,false,'no colour profile may survive into the verify gate');
}

// 2. With the ICC toggle on, the bitmap is returned untouched.
{
  const {bytes}=makeBMPV5({profile:true});
  const r=get('cleanBMP')(bytes,{...opts,keepICC:true});
  assert.deepEqual(Array.from(r.bytes),Array.from(bytes),'keep-profile must leave the bitmap untouched');
  assert.equal(r.log.length,0);
}

// 3. A bitmap with no profile has nothing to remove and is returned untouched.
{
  const {bytes}=makeBMPV5({profile:false});
  const scan=get('scanBMPFile')(bytes);
  assert.equal(scan.profile,null);
  const A=get('analyze')(bytes,'image/bmp','p.bmp');
  assert.equal(!!A.flags.icc,false,'no profile means no ICC flag');
  const r=get('cleanBMP')(bytes,opts);
  assert.deepEqual(Array.from(r.bytes),Array.from(bytes),'nothing to remove means no change');
  assert.ok(r.notes.length,'the reason must be explained');
}

// 4. Refusals: a bogus profile pointer is not trusted.
{
  assert.throws(()=>get('cleanBMP')(Uint8Array.from([0,1,2,3]),opts),/Not a BMP|left untouched/i);
  const {bytes}=makeBMPV5({profile:true});
  const lying=bytes.slice();
  // claim a profile that runs past the end of the file
  const dv=new DataView(lying.buffer);
  dv.setUint32(14+116,0xFFFF,true);
  const scan=get('scanBMPFile')(lying);
  assert.equal(scan.profile,null,'an out-of-range profile pointer must be ignored, not followed');
  const r=get('cleanBMP')(lying,opts);
  assert.deepEqual(Array.from(r.bytes),Array.from(lying),'an untrustworthy profile pointer means no rewrite');
}

const z=get('buildZip')([{name:'clean.jpg',data:cleanJ.bytes},{name:'clean.png',data:cleanP.bytes}]);
assert.ok(z.size>0);
(async()=>{
  const item={bytes:jpeg,mime:'image/jpeg',name:'sample.jpg',analysis:get('analyze')(jpeg,'image/jpeg','sample.jpg')};
  const result=await get('cleanItem')(item);
  assert.equal(result.verify.aiLeft,false,'cleaning pipeline must re-scan and reject remaining AI metadata');
  assert.equal(get('scanJPEG')(result.bytes).segs.some(x=>x.kind==='c2pa'),false);
  console.log('Engine tests passed: EXIF, JPEG, PNG, WebP, GIF, TIFF/DNG, AVIF/HEIC, JPEG XL, BMP, mandatory AI-tag removal, ZIP.');
})().catch(e=>{console.error(e);process.exitCode=1;});
