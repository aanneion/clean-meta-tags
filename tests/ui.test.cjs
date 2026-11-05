// Run with: node tests/ui.test.cjs
// Optional UI regression tests for the render layer and the transient queue:
// a file leaves the list the moment it is successfully downloaded.
//
// These need jsdom, which the engine suite does not:
//     npm install --no-save jsdom
// If jsdom is missing the suite skips instead of failing, so
// `tests/engine.test.cjs` stays the zero-dependency default.
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

const get=code=>w.eval(code);
const S=get('S'), $=s=>w.document.querySelector(s), $$=s=>[...w.document.querySelectorAll(s)];
const tick=ms=>new Promise(r=>setTimeout(r,ms));
const ignorable=e=>/Not implemented/.test(e);
const rows=()=>$$('.file');

(async()=>{
  await tick(60);
  assert.deepEqual(errors.filter(ignorable),[],'page must load with no script errors: '+errors.join(' | '));
  console.log('1. page loads clean, no script errors');

  // --- the original green design is intact -------------------------------
  for(const sel of ['.top','.brand','.hero','.eyebrow','.drop','.pick','.trust','#results','#list','#zip','#clear']){
    assert.ok($(sel),'expected the original UI element '+sel);
  }
  assert.equal($('#theme'),null,'dark-mode toggle must be gone (light green only)');
  assert.equal(w.document.documentElement.getAttribute('data-theme'),null,'no theme attribute applied');
  assert.match(html,/--mint:#177b4b/,'original green accent retained');
  assert.match(html,/--bg:#f5f9f2/,'original green background retained');
  console.log('2. original green UI restored; no dark theme toggle');

  // --- motion layer ------------------------------------------------------
  for(const kf of ['riseIn','rowIn','thumbIn','toastIn','pop','tickIn','flashOk','softPulse','floatY']){
    assert.match(html,new RegExp('@keyframes '+kf+'\\b'),'missing keyframes '+kf);
  }
  assert.match(html,/\.file\.enter\{animation:rowIn/,'rows animate in');
  assert.match(html,/\.file\.leaving\{/,'rows animate out');
  assert.match(html,/--ease:cubic-bezier/,'shared easing token defined');
  const rm=html.match(/@media\(prefers-reduced-motion:reduce\)\{[\s\S]*?\n\}/);
  assert.ok(rm,'reduced-motion block present');
  assert.match(rm[0],/animation-duration:\.01ms/,'reduced motion kills animation');
  assert.match(rm[0],/transition-duration:\.01ms/,'reduced motion kills transitions');
  assert.match(rm[0],/animation-iteration-count:1/,'reduced motion stops infinite loops');
  console.log('3. animation layer present and fully covered by prefers-reduced-motion');

  // --- build a real JPEG carrying GPS + C2PA + XMP + ICC ------------------
  const enc=new w.TextEncoder();
  const rat=(n,d)=>Uint8Array.of(n&255,(n>>8)&255,(n>>16)&255,(n>>>24)&255,d&255,(d>>8)&255,(d>>16)&255,(d>>>24)&255);
  const tiff=get('buildTIFF')(true,[
    {tag:0x010f,type:2,count:6,data:enc.encode('Canon\0')},
    {tag:0x8825,type:4,count:1,data:new Uint8Array(4),
     sub:[{tag:1,type:2,count:2,data:enc.encode('N\0')},
          {tag:2,type:5,count:3,data:get('concat')([rat(23,1),rat(12,1),rat(30,1)])},
          {tag:3,type:2,count:2,data:enc.encode('E\0')},
          {tag:4,type:5,count:3,data:get('concat')([rat(45,1),rat(30,1),rat(0,1)])}],subName:'gps'}
  ],null,null);
  const marker=(m,data)=>{const b=new Uint8Array(4+data.length);b.set([255,m,(data.length+2)>>8,(data.length+2)&255]);b.set(data,4);return b;};
  const jpeg=get('concat')([
    Uint8Array.from([255,216]), get('exifSeg')(tiff),
    marker(0xEB,enc.encode('JP\0C2PA demo manifest')),
    marker(0xE2,enc.encode('ICC_PROFILE\0hidden profile')),
    marker(0xE1,enc.encode('http://ns.adobe.com/xap/1.0/\0<xmp/>')),
    marker(0xFE,enc.encode('private comment')),
    marker(0xDA,Uint8Array.from([1,1,0,0,63,0])),
    Uint8Array.from([1,2,3,255,0,4,255,217])
  ]);
  const A=get('analyze')(jpeg,'image/jpeg','holiday.jpg');
  assert.ok(A.gps&&A.flags.c2pa,'fixture carries GPS and C2PA');
  const R=await get('cleanItem')({bytes:jpeg,mime:'image/jpeg',name:'holiday.jpg',analysis:A});
  assert.equal(R.verify.aiLeft,false,'output verified free of AI provenance');

  const mk=(id,ord,name)=>({id,ord,name,size:jpeg.length,bytes:jpeg,analysis:A,mime:'image/jpeg',
    url:w.URL.createObjectURL({}),status:'done',result:R,error:null,ack:false});

  // --- queueing ----------------------------------------------------------
  S.files=[mk('f1',1,'one.jpg'),mk('f2',2,'two.jpg'),mk('f3',3,'three.jpg')];
  S.seen.clear();S.lastCount=-1;
  get('render()');
  assert.equal($('#results').classList.contains('hidden'),false,'queue visible');
  assert.equal($('#count').textContent,'3','count badge');
  assert.equal(rows().length,3,'three rows');
  assert.ok(rows().every(r=>r.classList.contains('enter')),'new rows get the entrance animation');
  assert.deepEqual(rows().map(r=>r.style.getPropertyValue('--i')),['0','1','2'],'entrance is staggered');
  assert.ok(rows().every(r=>r.classList.contains('just-done')),'verified rows flash once');
  assert.equal($('#zip').classList.contains('hidden'),false,'ZIP offered for 2+ ready files');
  console.log('4. rows render with staggered entrance and a one-shot verified flash');

  // re-render must not replay the entrance or the flash
  get('render()');
  assert.equal(rows().filter(r=>r.classList.contains('enter')).length,0,'entrance not replayed on re-render');
  assert.equal(rows().filter(r=>r.classList.contains('just-done')).length,0,'flash not replayed on re-render');
  console.log('5. animations do not replay on unrelated re-renders');

  // --- THE headline behaviour: a successful download removes that file ----
  revoked.length=0;
  const target=rows()[1];                       // two.jpg, ord 2
  const dl=target.querySelector('.mini');
  assert.equal(dl.textContent,'Download','download button present');
  dl.focus(); dl.click();

  assert.equal(S.files.length,2,'file leaves the queue immediately after its download');
  assert.equal(S.files.some(f=>f.id==='f2'),false,'the downloaded file is gone from state');
  assert.equal(S.files.some(f=>f.id==='f1')&&S.files.some(f=>f.id==='f3'),true,'the other files stay');
  assert.ok(revoked.length>=1,'blob URL revoked for the downloaded file');
  assert.match($('#toasts').textContent,/removed from this page/,'user told it was removed');
  assert.ok(target.classList.contains('leaving'),'departing row animates out');
  assert.equal(target.style.maxHeight,'0px','height pinned for the collapse');
  console.log('6. a successful download removes that file from the list at once');

  await tick(700);
  assert.equal(rows().length,2,'departing row removed from the DOM after the animation');
  assert.equal($('#count').textContent,'2','count updated');
  assert.notEqual(w.document.activeElement,dl,'stale button no longer focused');
  assert.equal(w.document.activeElement.className,'mini','focus handed to the next Download button');
  console.log('7. DOM reconciles after the exit animation and focus moves on');

  // --- stable export names ----------------------------------------------
  assert.equal(get('outName')(S.files[0]),'cleanmetatags-01.jpg','first file keeps ordinal 01');
  assert.equal(get('outName')(S.files[1]),'cleanmetatags-03.jpg','third file keeps ordinal 03, not 02');
  const names=[get('outName')(S.files[0]),get('outName')(S.files[1]),'cleanmetatags-02.jpg'];
  assert.equal(new Set(names).size,3,'no export name can collide with an already-downloaded file');
  console.log('8. export ordinals stay stable so removals cannot cause name collisions');

  // --- ZIP clears every saved file --------------------------------------
  revoked.length=0;
  $('#zip').click();
  assert.equal(S.files.length,0,'ZIP download empties the queue');
  await tick(900);
  assert.equal(rows().length,0,'rows gone from the DOM');
  assert.equal($('#results').classList.contains('hidden'),true,'queue section hidden when empty');
  assert.ok(revoked.length>=2,'all blob URLs revoked');
  assert.match($('#toasts').textContent,/ZIP/,'ZIP removal reported');
  console.log('9. Download all as ZIP clears every saved file');

  // --- Clear button ------------------------------------------------------
  S.files=[mk('f4',4,'four.jpg')];S.seen.clear();get('render()');
  $('#clear').click();
  assert.equal(S.files.length,0,'Clear empties the queue');
  assert.match($('#toasts').textContent,/nothing retained/,'Clear states nothing is retained');
  await tick(700);
  assert.equal(rows().length,0,'Clear removes the rows');
  console.log('10. Clear empties the queue immediately');

  // --- failed files are not silently dropped ----------------------------
  const bad=mk('f5',5,'bad.heic');bad.status='error';bad.error='unsupported';
  const good=mk('f6',6,'good.jpg');
  S.files=[bad,good];S.seen.clear();get('render()');
  assert.match(rows()[0].querySelector('.status').textContent,/Could not clean/,'error surfaced on the row');
  assert.ok(rows()[0].querySelector('.status').classList.contains('error'),'error styling applied');
  assert.equal(rows()[0].querySelectorAll('.mini')[0].textContent,'Retry','retry offered');
  rows()[1].querySelector('.mini').click();
  assert.equal(S.files.length,1,'downloading the good file leaves the failed one for the user');
  assert.equal(S.files[0].id,'f5','failed file still present');
  console.log('11. failed files are reported and survive unrelated downloads');

  // --- whole-page drag and drop -----------------------------------------
  const drag=(type,files)=>{const e=new w.Event(type,{bubbles:true,cancelable:true});e.dataTransfer={types:['Files'],files:files||[]};return e;};
  w.document.dispatchEvent(drag('dragenter'));
  assert.ok($('#veil').classList.contains('on'),'veil shown while dragging files');
  assert.ok(w.document.body.classList.contains('dragging'),'drop zone highlighted');
  w.document.dispatchEvent(drag('dragenter'));
  w.document.dispatchEvent(drag('dragleave'));
  assert.ok($('#veil').classList.contains('on'),'veil survives nested dragenter/leave');
  w.document.dispatchEvent(drag('dragleave'));
  assert.equal($('#veil').classList.contains('on'),false,'veil hidden once the drag leaves');
  assert.equal(w.document.body.classList.contains('dragging'),false,'highlight cleared');
  const txt=new w.Event('dragenter',{bubbles:true,cancelable:true});
  txt.dataTransfer={types:['text/plain'],files:[]};
  w.document.dispatchEvent(txt);
  assert.equal($('#veil').classList.contains('on'),false,'plain-text drags ignored');
  console.log('12. whole-page drag and drop with depth-counted veil');

  // --- no history pollution ---------------------------------------------
  assert.equal(w.location.hash,'','no hash navigation added');
  assert.equal(w.history.length,1,'downloads add no entries to the session history');
  assert.equal(w.localStorage.length,0,'nothing written to localStorage');
  console.log('13. no history entries and no localStorage writes');

  assert.deepEqual(errors.filter(ignorable),[],'no script errors during the run: '+errors.join(' | '));
  console.log('\nUI tests passed.');
})().catch(e=>{console.error('FAIL:',e);console.error('collected errors:',errors);process.exitCode=1;});
