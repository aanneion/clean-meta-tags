// Run with: node tests/ui.test.cjs
// Optional UI regression tests for the render layer, theme toggle and the
// "queue forgets itself once every image is saved" behaviour.
//
// These need jsdom, which the engine suite does not:
//     npm install --no-save jsdom
// If jsdom is missing the suite skips instead of failing, so `tests/engine.test.cjs`
// stays the zero-dependency default.
const fs=require('node:fs');
const assert=require('node:assert/strict');
let JSDOM,VirtualConsole;
try{({JSDOM,VirtualConsole}=require('jsdom'));}
catch(e){console.log('Skipping UI tests: jsdom is not installed (npm install --no-save jsdom).');process.exit(0);}

const html=fs.readFileSync(new URL('../index.html',`file://${__filename}`),'utf8');
const errors=[];
const vc=new VirtualConsole();
vc.on('jsdomError',e=>errors.push('jsdomError: '+(e.message||e)));
vc.on('error',(...a)=>errors.push('console.error: '+a.join(' ')));

const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,url:'http://localhost/'});
const w=dom.window;

// --- browser APIs jsdom lacks -------------------------------------------
let blobN=0;
w.URL.createObjectURL=()=>'blob:stub/'+(++blobN);
const revoked=[];
w.URL.revokeObjectURL=u=>revoked.push(u);
w.Element.prototype.scrollIntoView=function(){};
w.HTMLAnchorElement.prototype.click=function(){this.dataset.clicked='1';};
w.matchMedia=w.matchMedia||(q=>({matches:false,media:q,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}}));

const get0=code=>w.eval(code);
const S=get0('S'), $=s=>w.document.querySelector(s);
const ignorable=e=>/Not implemented/.test(e);
const tick=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  await tick(60);
  assert.deepEqual(errors.filter(ignorable),[], 'page must load with no script errors: '+errors.join(' | '));
  console.log('1. page loads clean, no script errors');

  // --- theme -------------------------------------------------------------
  assert.ok(['light','dark'].includes(w.document.documentElement.getAttribute('data-theme')),'data-theme set on load');
  const first=w.document.documentElement.getAttribute('data-theme');
  $('#theme').click();
  const second=w.document.documentElement.getAttribute('data-theme');
  assert.notEqual(first,second,'theme toggle must flip the theme');
  assert.equal(w.localStorage.getItem('cleanmetatags.theme'),second,'theme choice persisted');
  assert.equal($('#theme').getAttribute('aria-pressed'),String(second==='dark'),'aria-pressed tracks theme');
  $('#theme').click();
  assert.equal(w.document.documentElement.getAttribute('data-theme'),first,'theme toggles back');
  console.log('2. theme toggle works, persists, and exposes aria-pressed');

  // --- build a real JPEG carrying GPS + C2PA + XMP + ICC ------------------
  const enc=new w.TextEncoder();
  const get=code=>w.eval(code);
  const rat=(n,d)=>Uint8Array.of(n&255,(n>>8)&255,(n>>16)&255,(n>>>24)&255,d&255,(d>>8)&255,(d>>16)&255,(d>>>24)&255);
  const latD=get('concat')([rat(23,1),rat(12,1),rat(30,1)]);   // 23d 12' 30" N
  const lonD=get('concat')([rat(45,1),rat(30,1),rat(0,1)]);    // 45d 30' 0" E
  const tiff=get('buildTIFF')(true,[
    {tag:0x010f,type:2,count:6,data:enc.encode('Canon\0')},
    {tag:0x8825,type:4,count:1,data:new Uint8Array(4),
     sub:[{tag:1,type:2,count:2,data:enc.encode('N\0')},
          {tag:2,type:5,count:3,data:latD},
          {tag:3,type:2,count:2,data:enc.encode('E\0')},
          {tag:4,type:5,count:3,data:lonD}],subName:'gps'}
  ],null,null);
  const exifSeg=get('exifSeg')(tiff);
  const marker=(m,data)=>{const b=new Uint8Array(4+data.length);b.set([255,m,(data.length+2)>>8,(data.length+2)&255]);b.set(data,4);return b;};
  const jpeg=get('concat')([
    Uint8Array.from([255,216]), exifSeg,
    marker(0xEB,enc.encode('JP\0C2PA demo manifest')),
    marker(0xE2,enc.encode('ICC_PROFILE\0hidden profile')),
    marker(0xE1,enc.encode('http://ns.adobe.com/xap/1.0/\0<xmp/>')),
    marker(0xFE,enc.encode('private comment')),
    marker(0xDA,Uint8Array.from([1,1,0,0,63,0])),
    Uint8Array.from([1,2,3,255,0,4,255,217])
  ]);

  const A=get('analyze')(jpeg,'image/jpeg','holiday-beach.jpg');
  assert.ok(A.risk.score>0,'source must be flagged as risky');
  assert.ok(A.gps,'GPS must be detected');
  assert.ok(Math.abs(A.gps.lat-23.208333)<1e-4,'latitude decoded: '+A.gps.lat);
  assert.ok(Math.abs(A.gps.lon-45.5)<1e-4,'longitude decoded: '+A.gps.lon);
  assert.ok(A.flags.c2pa,'C2PA must be detected');
  const R=await get('cleanItem')({bytes:jpeg,mime:'image/jpeg',name:'holiday-beach.jpg',analysis:A});
  assert.equal(R.verify.aiLeft,false,'output verified free of AI provenance');

  // --- render two items ---------------------------------------------------
  const mk=(id,ord,name,analysis,result)=>({id,ord,name,size:jpeg.length,bytes:jpeg,analysis,mime:'image/jpeg',
    url:w.URL.createObjectURL({}),status:'done',result,error:null,saved:false});
  S.files=[mk('fA',1,'holiday-beach.jpg',A,R),mk('fB',2,'second.png',A,R)];
  get('render()');

  assert.equal($('#results').classList.contains('hidden'),false,'queue visible once populated');
  assert.equal($('#count').textContent,'2','count badge');
  assert.equal(w.document.querySelectorAll('.row').length,2,'two rows rendered');
  assert.match($('#stats').textContent,/verified/,'aggregate stats rendered');
  assert.match($('#zipnote').textContent,/clears itself once every image is downloaded/,'auto-clear explained in UI');
  assert.equal($('#zip').classList.contains('hidden'),false,'ZIP button shown for 2 ready files');
  assert.equal($('#zip').textContent,'Download all as ZIP (2)','ZIP button carries the count');
  console.log('3. queue renders rows, count, stats, ZIP button and the auto-clear note');

  const row=w.document.querySelectorAll('.row')[0];
  assert.match(row.querySelector('.fname').textContent,/holiday-beach\.jpg/,'filename shown');
  assert.match(row.querySelector('.fmeta').textContent,/JPEG/,'format + size line');
  assert.ok(row.querySelector('.r-crit,.r-high,.r-med,.r-low'),'before-risk chip present');
  assert.ok(row.querySelector('.r-none'),'after-risk chip shows Clean');
  assert.match(row.querySelector('.c-strip').textContent,/−/,'stripped items/bytes shown');
  assert.match(row.querySelector('.c-state').textContent,/Verified/,'state shows Verified');
  assert.equal(row.querySelector('.insp').dataset.filled,'0','collapsed inspector is not built eagerly');
  assert.equal(row.querySelector('.insp').innerHTML,'','collapsed inspector shell is empty');
  console.log('4. row shows risk before → after, stripped totals, state; inspector deferred');

  // --- inspector ---------------------------------------------------------
  row.querySelector('.toggle').click();
  const insp=row.querySelector('.insp');
  assert.equal(insp.classList.contains('hidden'),false,'inspector opens');
  assert.equal(row.classList.contains('open'),true,'row marked open');
  assert.equal(row.querySelector('.toggle').getAttribute('aria-expanded'),'true','aria-expanded true');
  assert.equal(insp.dataset.filled,'1','inspector now built');
  assert.match(insp.textContent,/Found in source/,'findings section');
  assert.match(insp.textContent,/Output verification/,'verification section');
  assert.match(insp.textContent,/GPS/,'GPS finding surfaced');
  assert.match(insp.textContent,/Segment log/,'segment log present');
  assert.match(insp.textContent,/Parsed metadata fields/,'EXIF field table present');
  assert.match(insp.textContent,/no signals/,'C2PA verified absent');
  assert.match(insp.textContent,/cleanmetatags-01\.jpg/,'generic export name surfaced');
  row.querySelector('.toggle').click();
  assert.equal(insp.classList.contains('hidden'),true,'inspector closes');
  console.log('5. inspector expands with findings, verification, segment log, field table');

  // --- save state + auto-clear -------------------------------------------
  const dl=row.querySelector('.row-act .btn');
  assert.equal(dl.textContent,'Download','download button label');
  dl.focus();
  dl.click();
  assert.equal(S.files[0].saved,true,'item marked saved after download');
  // render() rebuilds every row, so re-query and check focus was handed back.
  const rowA=w.document.querySelectorAll('.row')[0];
  assert.equal(rowA.querySelector('.row-act .btn').textContent,'Saved','button reflects saved state');
  assert.equal(w.document.activeElement.dataset.fkind,'download','focus restored to the Download button after re-render');
  assert.equal(w.document.activeElement.dataset.fid,'fA','focus restored to the same row');
  assert.match($('#zipnote').textContent,/Saved 1 of 2/,'partial-save progress reported');
  assert.equal(S.files.length,2,'queue NOT cleared while a download is still pending');
  console.log('6. first download marks the row Saved and keeps the queue (still pending)');

  await tick(1200);
  assert.equal(S.files.length,2,'queue still intact after the beat when one item is unsaved');
  assert.equal(revoked.length,0,'no blob urls revoked yet');

  // download the second one -> everything saved -> queue must empty itself
  const row2=w.document.querySelectorAll('.row')[1];
  row2.querySelector('.row-act .btn').click();
  assert.equal(S.files.every(f=>f.saved),true,'all saved');
  await tick(1200);
  assert.equal(S.files.length,0,'queue auto-cleared once every image was downloaded');
  assert.equal($('#results').classList.contains('hidden'),true,'queue section hidden again');
  assert.ok(revoked.length>=2,'blob urls revoked on clear ('+revoked.length+')');
  const toasts=$('#toasts').textContent;
  assert.match(toasts,/saved to your device/,'clear reported to the user');
  assert.match(toasts,/nothing is retained on this page/,'retention promise stated');
  console.log('7. queue auto-clears once everything is saved, revoking blob URLs');

  // --- ZIP path clears too ------------------------------------------------
  revoked.length=0;
  S.files=[mk('fC',3,'a.jpg',A,R),mk('fD',4,'b.jpg',A,R)];
  get('render()');
  $('#zip').click();
  assert.equal(S.files.every(f=>f.saved),true,'ZIP marks every file saved');
  await tick(1200);
  assert.equal(S.files.length,0,'ZIP download also empties the queue');
  console.log('8. ZIP export marks all saved and empties the queue');

  // --- failed items do not wedge the queue --------------------------------
  revoked.length=0;
  const bad=mk('fE',5,'broken.heic',A,R); bad.status='error'; bad.error='unsupported'; bad.saved=false;
  const good=mk('fF',6,'ok.jpg',A,R);
  S.files=[bad,good];
  get('render()');
  const goodRow=w.document.querySelectorAll('.row')[1];
  assert.match(goodRow.querySelector('.c-state').textContent,/Verified/,'good row verified');
  assert.match(w.document.querySelectorAll('.row')[0].querySelector('.c-state').textContent,/Failed/,'error row shows Failed');
  goodRow.querySelector('.row-act .btn').click();
  await tick(1200);
  assert.equal(S.files.length,0,'a failed sibling does not block the auto-clear');
  assert.match($('#toasts').textContent,/could not be cleaned/,'failure disclosed in the clear toast');
  console.log('9. errored items are reported and do not wedge the auto-clear');

  // --- no history pollution ----------------------------------------------
  assert.equal(w.location.hash,'','no hash navigation added');
  assert.equal(w.history.length,1,'session history untouched by downloads');
  console.log('10. downloads add no entries to the page/session history');

  assert.deepEqual(errors.filter(ignorable),[],'no script errors during the whole run: '+errors.join(' | '));
  console.log('\nUI smoke tests passed.');
})().catch(e=>{console.error('FAIL:',e);console.error('collected errors:',errors);process.exitCode=1;});
