/* oto2score mobile: browser-only audio -> approximate notes, MIDI, MusicXML. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const state = {mode:'voice', source:null, sourceName:'', previewURL:null, stream:null, recorder:null, chunks:[], recordingTimer:null, worker:null, notes:[], noteURLs:[], busy:false};
  const SR=11025, MAX_SECONDS=60, TICKS=480;
  const esc = value => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  const bpm=()=>Number($('bpm').value), grid=()=>Number($('grid').value);
  const stepTicks=()=>TICKS*4/grid();
  const snap=(seconds)=>Math.round(seconds*bpm()/60*TICKS/stepTicks())*stepTicks();
  const modeName=()=>state.mode==='voice'?'歌声':'ピアノ';
  function setStatus(text,error=false){const el=$('status');el.textContent=text;el.classList.toggle('error',error);}
  function setBusy(b){state.busy=b;$('analyze-btn').disabled=b||!state.source; $('record-btn').disabled=b; $('file-input').disabled=b;}
  function setMode(mode){state.mode=mode;for(const m of ['voice','piano'])$('mode-'+m).setAttribute('aria-pressed',String(m===mode));}
  function sourceFile(blob,name){
    if(!blob)return;
    stopScore();
    if(state.previewURL)URL.revokeObjectURL(state.previewURL);
    state.source=blob;state.sourceName=name||'録音';state.previewURL=URL.createObjectURL(blob);
    $('audio-player').src=state.previewURL;$('selected-title').textContent=state.sourceName;
    $('selected').classList.add('show');$('analyze-btn').disabled=false;
    setStatus('音声の準備ができました。「採譜する」を押してください。');
    $('result').classList.remove('show');
  }
  $('mode-voice').addEventListener('click',()=>setMode('voice'));
  $('mode-piano').addEventListener('click',()=>setMode('piano'));
  $('file-input').addEventListener('change',event=>{
    const f=event.target.files?.[0];if(!f)return;
    if(f.size>100*1024*1024){setStatus('ファイルが大きすぎます。60秒以下の音声を使ってください。',true);return;}
    sourceFile(f,f.name);
  });
  for(const id of ['bpm','sensitivity'])$(id).addEventListener('input',()=>{
    $('bpm-value').textContent=$('bpm').value;
    $('sensitivity-value').textContent=$('sensitivity').value;
  });
  function releaseMic(){
    if(state.recordingTimer){clearTimeout(state.recordingTimer);state.recordingTimer=null;}
    if(state.stream){state.stream.getTracks().forEach(t=>t.stop());state.stream=null;}
    state.recorder=null;$('record-btn').classList.remove('active');$('record-label').textContent='マイクで録音する';
  }
  async function recordToggle(){
    if(state.recorder&&state.recorder.state==='recording'){state.recorder.stop();return;}
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){
      setStatus('このブラウザでは録音を開始できません。HTTPSで開くか、音声ファイルを選んでください。',true);return;
    }
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
      state.stream=stream;
      const types=['audio/mp4','audio/webm;codecs=opus','audio/webm'];
      const type=types.find(t=>MediaRecorder.isTypeSupported(t));
      const recorder=new MediaRecorder(stream,type?{mimeType:type}:undefined);
      state.recorder=recorder;state.chunks=[];
      recorder.ondataavailable=event=>{if(event.data?.size)state.chunks.push(event.data);};
      recorder.onerror=()=>{setStatus('録音エラーが発生しました。ファイル読み込みをお試しください。',true);releaseMic();};
      recorder.onstop=()=>{
        const blob=new Blob(state.chunks,{type:recorder.mimeType||'audio/mp4'});
        releaseMic();
        if(blob.size>0)sourceFile(blob,'マイク録音 '+new Date().toLocaleTimeString('ja-JP'));
        else setStatus('録音データがありませんでした。もう一度試してください。',true);
      };
      recorder.start(300);$('record-btn').classList.add('active');$('record-label').textContent='■ 録音を停止する';
      setStatus('録音中。最大60秒で自動停止します。');
      state.recordingTimer=setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},MAX_SECONDS*1000);
    }catch(err){releaseMic();setStatus('マイクを利用できません。Safari/Chromeのマイク許可を確認してください。 '+(err?.message||''),true);}
  }
  $('record-btn').addEventListener('click',recordToggle);
  function makeDemoWav(mode){
    const sr=22050,length=sr*4,buffer=new Float32Array(length);
    const phrase=mode==='voice'?[60,62,64,67,69,67,64,62]:[48,52,55,50,53,57,52,55];
    for(let k=0;k<phrase.length;k++){
      const notes=mode==='voice'?[phrase[k]]:[phrase[k],phrase[k]+12,phrase[k]+16];
      const start=Math.floor(sr*(.15+k*.45)),dur=Math.floor(sr*.4);
      for(const p of notes){
        const freq=440*Math.pow(2,(p-69)/12);
        for(let i=0;i<dur && start+i<buffer.length;i++){
          const t=i/sr,e=mode==='voice'?Math.sin(Math.PI*i/dur):Math.exp(-5*t);
          const s=Math.sin(2*Math.PI*freq*t)+.28*Math.sin(4*Math.PI*freq*t);
          buffer[start+i]+=s*e/(notes.length*2.3);
        }
      }
    }
    const out=new ArrayBuffer(44+buffer.length*2),view=new DataView(out);
    const word=(at,text)=>{for(let i=0;i<text.length;i++)view.setUint8(at+i,text.charCodeAt(i));};
    word(0,'RIFF');view.setUint32(4,36+buffer.length*2,true);
    word(8,'WAVE');word(12,'fmt ');view.setUint32(16,16,true);
    view.setUint16(20,1,true);view.setUint16(22,1,true);
    view.setUint32(24,sr,true);view.setUint32(28,sr*2,true);
    view.setUint16(32,2,true);view.setUint16(34,16,true);
    word(36,'data');view.setUint32(40,buffer.length*2,true);
    for(let i=0;i<buffer.length;i++)view.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,buffer[i]))*32767),true);
    return new Blob([out],{type:'audio/wav'});
  }
  for(const mode of ['voice','piano'])$('demo-'+mode).addEventListener('click',()=>{
    if(state.busy)return;
    setMode(mode);
    sourceFile(makeDemoWav(mode),mode==='voice'?'歌声デモ.wav':'ピアノデモ.wav');
  });
  async function loadAudio(blob){
    const array=await blob.arrayBuffer();
    const audioCtx=new (window.AudioContext||window.webkitAudioContext)();
    try{
      const decoded=await audioCtx.decodeAudioData(array);
      if(decoded.duration>MAX_SECONDS+0.5)throw new Error('60秒以内の音声を選んでください。');
      if(decoded.duration<.2)throw new Error('0.2秒以上の音声を選んでください。');
      const frames=Math.ceil(decoded.duration*SR);
      const offline=new OfflineAudioContext(1,frames,SR);
      const source=offline.createBufferSource();source.buffer=decoded;
      source.connect(offline.destination);source.start();
      const buffer=await offline.startRendering();
      return new Float32Array(buffer.getChannelData(0));
    }finally{await audioCtx.close().catch(()=>{});}
  }
  async function analyze(){
    if(!state.source||state.busy)return;
    setBusy(true);$('progress').classList.add('show');$('progress').value=4;
    setStatus('音声を読み込んでいます…');
    try{
      const data=await loadAudio(state.source);
      setStatus('音高を解析しています…');$('progress').value=8;
      if(state.worker)state.worker.terminate();
      const worker=new Worker('./analyzer-worker.js');state.worker=worker;
      worker.onmessage=event=>{
        const data=event.data;
        if(data.type==='progress')$('progress').value=Math.max(8,Math.min(99,data.percent));
        else if(data.type==='error')finish(data.message);
        else if(data.type==='done'){
          const notes=data.notes.filter(n=>Number.isFinite(n.start)&&Number.isFinite(n.end)&&Number.isInteger(n.pitch)&&n.end>n.start).slice(0,700);
          state.notes=notes;
          if(!notes.length){finish('音符を検出できませんでした。周囲の雑音、音量、感度を確認してください。');return;}
          refreshScore(); $('result').classList.add('show');
          $('result').scrollIntoView({behavior:'smooth',block:'start'});
          finish(null,`${notes.length}音符を検出しました（${modeName()}・試作精度）。譜面を確認して修正できます。`);
        }
      };
      worker.onerror=event=>finish('解析エンジンでエラーが発生しました。 '+(event.message||''));
      worker.postMessage({audio:data,mode:state.mode,sensitivity:Number($('sensitivity').value)/100},[data.buffer]);
    }catch(e){finish(e?.message||String(e));}
  }
  function finish(error,message=''){
    $('progress').classList.remove('show');setBusy(false);
    setStatus(error||message,Boolean(error));
    if(state.worker){state.worker.terminate();state.worker=null;}
  }
  $('analyze-btn').addEventListener('click',analyze);
  function normalizeNotes(){
    return state.notes.map((n,i)=>({
      ...n,id:i,pitch:clamp(Math.round(n.pitch),21,108),
      start:Math.max(0,snap(n.start)),
      end:Math.max(snap(n.start)+stepTicks(),snap(n.end)),
      velocity:clamp(Math.round(n.velocity||85),1,127)
    })).sort((a,b)=>a.start-b.start||a.pitch-b.pitch);
  }
  const midiNames=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
  const pitchName=p=>midiNames[p%12]+(Math.floor(p/12)-1);
  const vlq=n=>{let a=[n&127];while((n>>=7)>0)a.unshift((n&127)|128);return a;};
  function midiData(notes){
    const events=[{tick:0,order:0,bytes:[0xff,0x51,3,...[Math.round(60000000/bpm())>>16&255,Math.round(60000000/bpm())>>8&255,Math.round(60000000/bpm())&255]]}];
    for(const n of notes){events.push({tick:n.start,order:2,bytes:[0x90,n.pitch,n.velocity]});events.push({tick:n.end,order:1,bytes:[0x80,n.pitch,0]});}
    events.sort((a,b)=>a.tick-b.tick||a.order-b.order);
    const data=[];let lastTick=0;
    for(const e of events){data.push(...vlq(e.tick-lastTick),...e.bytes);lastTick=e.tick;}
    data.push(0,0xff,0x2f,0);
    const u32=n=>[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255];
    return new Uint8Array([...Array.from('MThd').map(c=>c.charCodeAt(0)),...u32(6),0,0,0,1,1,224,...Array.from('MTrk').map(c=>c.charCodeAt(0)),...u32(data.length),...data]);
  }
  const xmlPitch=p=>{
    const names=['C','C','D','D','E','F','F','G','G','A','A','B'];
    const alters=[0,1,0,1,0,0,1,0,1,0,1,0];
    return `<pitch><step>${names[p%12]}</step>${alters[p%12]?'<alter>1</alter>':''}<octave>${Math.floor(p/12)-1}</octave></pitch>`;
  };
  const durationTypes=new Map([[1920,['whole',false]],[1440,['half',true]],[960,['half',false]],[720,['quarter',true]],[480,['quarter',false]],[360,['eighth',true]],[240,['eighth',false]],[180,['16th',true]],[120,['16th',false]],[60,['32nd',false]]]);
  const allowedDurations=[1920,1440,960,720,480,360,240,180,120,60];
  function divideDuration(ticks){
    const result=[];
    let remaining=ticks;
    for(const value of allowedDurations){
      while(remaining>=value){result.push(value);remaining-=value;}
    }
    return result;
  }
  function eventXML(pitchOrNull,duration,voice,staff,chord=false,tieStart=false,tieStop=false){
    const [type,dotted]=durationTypes.get(duration);
    const tieTags=pitchOrNull===null?'':`${tieStop?'<tie type="stop"/>':''}${tieStart?'<tie type="start"/>':''}`;
    const notations=pitchOrNull!==null&&(tieStop||tieStart)?`<notations>${tieStop?'<tied type="stop"/>':''}${tieStart?'<tied type="start"/>':''}</notations>`:'';
    return `<note>${chord?'<chord/>':''}${pitchOrNull===null?'<rest/>':xmlPitch(pitchOrNull)}<duration>${duration}</duration>${tieTags}<voice>${voice}</voice><type>${type}</type>${dotted?'<dot/>':''}<staff>${staff}</staff>${notations}</note>`;
  }
  // Partition each bar at note onsets/offsets, keeping rests and chords. This is a simplified score export.
  function scoreMeasure(notes,bar,staff,piano){
    const barStart=bar*1920,barEnd=barStart+1920;
    const clipped=notes.filter(n=>n.end>barStart&&n.start<barEnd&&(!piano||(staff===1?n.pitch>=60:n.pitch<60)));
    const edges=[barStart,barEnd];
    for(const n of clipped){edges.push(clamp(n.start,barStart,barEnd),clamp(n.end,barStart,barEnd));}
    edges.sort((a,b)=>a-b);const times=[...new Set(edges)];let xml='';
    for(let i=0;i<times.length-1;i++){
      const start=times[i],len=times[i+1]-start;
      const active=[...new Set(clipped.filter(n=>n.start<=start&&n.end>start).map(n=>n.pitch))].sort((a,b)=>a-b);
      const parts=divideDuration(len);
      for(let j=0;j<parts.length;j++){
        const length=parts[j];
        if(!active.length){xml+=eventXML(null,length,staff,staff);continue;}
        for(let k=0;k<active.length;k++)xml+=eventXML(active[k],length,staff,staff,k>0,j<parts.length-1,j>0);
      }
    }
    return xml;
  }
  function musicXML(notes){
    const maxTick=Math.max(1920,...notes.map(n=>n.end));
    const measures=Math.min(140,Math.ceil(maxTick/1920));
    const piano=state.mode==='piano';const voiceBass=!piano&&notes.length>0&&([...notes].sort((a,b)=>a.pitch-b.pitch)[Math.floor(notes.length/2)].pitch<60);const title=`oto2score - ${modeName()}`;
    let s=`<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE score-partwise  PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n<score-partwise version="4.0"><work><work-title>${esc(title)}</work-title></work><movement-title>${esc(title)}</movement-title><identification><creator type="software">oto2score mobile prototype</creator></identification><defaults/><part-list><score-part id="P1"><part-name>${piano?'Piano':'Voice'}</part-name><part-abbreviation>${piano?'Pno':'Vce'}</part-abbreviation><score-instrument id="I1"><instrument-name>${piano?'Piano':'Voice'}</instrument-name></score-instrument><midi-instrument id="I1"><midi-channel>1</midi-channel><midi-program>${piano?'1':'54'}</midi-program></midi-instrument></score-part></part-list><part id="P1">`;
    for(let bar=0;bar<measures;bar++){
      s+=`<measure implicit="no" number="${bar+1}">`;
      if(bar===0){s+=`<attributes><divisions>480</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>${piano?2:1}</staves><clef number="1"><sign>${voiceBass?'F':'G'}</sign><line>${voiceBass?4:2}</line></clef>${piano?'<clef number="2"><sign>F</sign><line>4</line></clef>':''}</attributes><direction placement="above"><direction-type><metronome parentheses="no"><beat-unit>quarter</beat-unit><per-minute>${bpm()}</per-minute></metronome></direction-type><sound tempo="${bpm()}"/></direction>`;}
      s+=scoreMeasure(notes,bar,1,piano);
      if(piano)s+=`<backup><duration>1920</duration></backup>`+scoreMeasure(notes,bar,2,piano);
      s+='</measure>';
    }
    s+='</part></score-partwise>';
    return s;
  }
  function diatonic(p){const steps=[0,0,1,1,2,3,3,4,4,5,5,6];return 7*(Math.floor(p/12)-1)+steps[p%12];}
  function drawScore(notes){
    const svg=$('score-svg');const piano=state.mode==='piano';
    const bottom=piano?325:184;
    svg.setAttribute('viewBox',`0 0 800 ${bottom}`);
    const x0=75,x1=770,step=(x1-x0)/16;
    const voiceBass=!piano&&notes.length>0&&([...notes].sort((a,b)=>a.pitch-b.pitch)[Math.floor(notes.length/2)].pitch<60);
    const baselines=piano?[[125,64,1],[284,43,2]]:[[125,voiceBass?43:64,1]];
    let output=`<rect width="800" height="${bottom}" fill="white"/>`;
    for(const [base,basePitch,staff] of baselines){
      for(let k=0;k<5;k++){const y=base-14*k;output+=`<line x1="59" y1="${y}" x2="775" y2="${y}" stroke="#34443e" stroke-width="1"/>`;}
      for(let b=0;b<=4;b++){const x=x0+b*4*step-9;output+=`<line x1="${x}" y1="${base-56}" x2="${x}" y2="${base}" stroke="#73847f" stroke-width="${b===0||b===4?1.8:1}"/>`;}
      output+=`<text x="22" y="${base-18}" font-size="36" fill="#283a32">${(staff===1&&!voiceBass)?'𝄞':'𝄢'}</text>`;
      const baseD=diatonic(basePitch);
      for(const n of notes){
        if(n.start>=16*TICKS||n.end<=0)continue;
        if(piano&&(staff===1?n.pitch<60:n.pitch>=60))continue;
        const x=x0+Math.max(0,n.start/TICKS)*step;
        const y=base-(diatonic(n.pitch)-baseD)*7;
        if(y<5||y>bottom-8)continue;
        for(let yy=base+14;yy<=y;yy+=14)output+=`<line x1="${x-14}" y1="${yy}" x2="${x+14}" y2="${yy}" stroke="#46534a" stroke-width="1.1"/>`;
        for(let yy=base-70;yy>=y;yy-=14)output+=`<line x1="${x-14}" y1="${yy}" x2="${x+14}" y2="${yy}" stroke="#46534a" stroke-width="1.1"/>`;
        output+=`<ellipse data-pitch="${n.pitch}" data-note-index="${notes.indexOf(n)}" cx="${x}" cy="${y}" rx="6.5" ry="4.5" transform="rotate(-17 ${x} ${y})" fill="#175e52"/>`;
        if(n.end-n.start<1920)output+=`<line x1="${x+5}" y1="${y}" x2="${x+5}" y2="${y-28}" stroke="#175e52" stroke-width="1.6"/>`;
        if([1,3,6,8,10].includes(n.pitch%12))output+=`<text x="${x-16}" y="${y+4}" font-size="15" fill="#175e52">♯</text>`;
      }
    }
    output+=`<text x="60" y="${bottom-10}" font-size="11" fill="#71817b">${piano?'ピアノ・2段':(voiceBass?'歌声・ヘ音記号':'歌声・ト音記号')} / BPM ${bpm()} / 最初の4小節（簡易表示）</text>`;
    svg.innerHTML=output;
  }
  function revokeDownloads(){for(const url of state.noteURLs)URL.revokeObjectURL(url);state.noteURLs=[];}
  function bindDownload(id,data,type){const url=URL.createObjectURL(new Blob([data],{type}));$(id).href=url;state.noteURLs.push(url);}
  function refreshScore(){
    stopScore();
    const notes=normalizeNotes();
    playback.duration=notes.length?scoreSeconds(Math.max(...notes.map(n=>n.end))):0;
    playbackUI();drawScore(notes);
    $('count').textContent=`${notes.length} 音符`;$('edit-count').textContent=`（${notes.length}件）`;
    renderNotes();revokeDownloads();
    bindDownload('download-midi',midiData(notes),'audio/midi');
    bindDownload('download-xml',musicXML(notes),'application/vnd.recordare.musicxml+xml');
  }
  function renderNotes(){
    const host=$('note-list');host.replaceChildren();
    if(state.notes.length>140){const hint=document.createElement('p');hint.className='hint';hint.textContent='音符が多いため、修正欄には最初の140音だけを表示しています。';host.appendChild(hint);}
    state.notes.slice(0,140).forEach((n,i)=>{
      const row=document.createElement('div');row.className='note-row';
      const label=document.createElement('div');
      const title=document.createElement('strong');title.textContent=pitchName(n.pitch);
      const sub=document.createElement('small');sub.textContent=`${n.start.toFixed(2)}〜${n.end.toFixed(2)}秒`;
      label.append(title,sub);row.appendChild(label);
      const controls=[['−',-1,'半音下げる'],['＋',1,'半音上げる'],['×',null,'音符を削除']];
      for(const [symbol,delta,description] of controls){
        const b=document.createElement('button');b.type='button';b.textContent=symbol;b.setAttribute('aria-label',description+' '+pitchName(n.pitch));
        if(delta===null)b.className='trash';
        b.onclick=()=>{if(delta===null)state.notes.splice(i,1);else state.notes[i].pitch=clamp(state.notes[i].pitch+delta,21,108);refreshScore();};
        row.appendChild(b);
      }
      host.appendChild(row);
    });
  }
  $('add-note').addEventListener('click',()=>{
    if(state.notes.length>=700){setStatus('追加できる音符は700個までです。',true);return;}
    const end=state.notes.length?Math.max(...state.notes.map(n=>n.end)):0;
    const len=60/bpm();state.notes.push({start:end,end:end+len,pitch:60,velocity:85});refreshScore();
  });
  // All three keyboard tones are synthesized locally with the Web Audio API.
  // They are expressive approximations, NOT samples of Steinway, Yamaha, or Wurlitzer instruments.
  const playback={context:null,master:null,playing:false,paused:false,notes:[],index:0,start:0,duration:0,offset:0,timer:null,voices:new Set()};
  let previewContext=null,previewMaster=null;
  const instrumentLabels={wurlitzer:'Wurlitzer風エレピ',steinway:'Steinway風グランド',yamaha:'Yamaha風グランド',
    'vocal-clear':'透明な高音（ミクをイメージ）','vocal-warm':'温かな中音（ルカをイメージ）',
    'vocal-bright':'はじける高音（リンをイメージ）','vocal-boy':'軽やかな少年声（レンをイメージ）'};
  const isVocal=preset=>preset.startsWith('vocal-');
  const formantWaves=new WeakMap();
  const vowelFormants={
    a:[850,1470,2850,3500],i:[300,2250,3050,3600],u:[370,1150,2470,3300],
    e:[510,1900,2750,3500],o:[510,940,2450,3350]
  };
  const vocalPresets={
    'vocal-clear':{shift:1.06,brightness:.93,vibrato:5.5,depth:11,breath:.06,soft:.72},
    'vocal-warm':{shift:.94,brightness:.78,vibrato:4.7,depth:13,breath:.075,soft:.85},
    'vocal-bright':{shift:1.14,brightness:1.22,vibrato:6.15,depth:16,breath:.038,soft:.75},
    'vocal-boy':{shift:.86,brightness:1.04,vibrato:5.1,depth:8,breath:.045,soft:.8}
  };
  // A spectral envelope with Japanese vowel formants. No copyrighted voicebanks are bundled.
  function vowelWave(ctx,frequency,preset,vowel){
    let cache=formantWaves.get(ctx);if(!cache){cache=new Map();formantWaves.set(ctx,cache);}
    const key=`${preset}:${vowel}:${Math.round(frequency)}`;
    if(cache.has(key))return cache.get(key);
    const profile=vocalPresets[preset],formants=vowelFormants[vowel]||vowelFormants.a;
    const real=new Float32Array(97),imag=new Float32Array(97);
    const amplitudes=[1.25,1.1,.85,.53];const widths=[125,195,300,430];
    for(let h=1;h<imag.length;h++){
      const hz=frequency*h;
      if(hz>ctx.sampleRate*.45)break;
      let resonance=.023;
      for(let k=0;k<formants.length;k++){
        const center=formants[k]*profile.shift;
        const ratio=(hz-center)/widths[k];
        resonance+=amplitudes[k]*Math.exp(-.5*ratio*ratio);
      }
      imag[h]=Math.pow(h,-.66)*resonance*Math.pow(profile.brightness,Math.min(h,12)/6);
    }
    imag[1]+=.075;
    const wave=ctx.createPeriodicWave(real,imag,{disableNormalization:false});
    if(cache.size>240)cache.clear();
    cache.set(key,wave);return wave;
  }
  const kanaVowels={};
  for(const [v,chars] of Object.entries({
    a:'あかさたなはまやらわがざだばぱぁゎ',
    i:'いきしちにひみりぎじぢびぴぃ',
    u:'うくすつぬふむゆるぐずづぶぷぅ',
    e:'えけせてねへめれげぜでべぺぇ',
    o:'おこそのほもよろをごぞどぼぽぉ'
  }))for(const ch of chars)kanaVowels[ch]=v;
  kanaVowels['と']='o';
  function sungVowels(){
    const input=$('vocal-lyrics').value.trim();
    if(!input)return [];
    const values=[];
    for(const original of [...input]){
      const cp=original.codePointAt(0);
      const ch=cp>=0x30a1&&cp<=0x30f6?String.fromCodePoint(cp-0x60):original.toLowerCase();
      if(ch==='っ'||ch==='ッ')continue;
      if(ch==='ー'){if(values.length)values.push(values[values.length-1]);continue;}
      if(ch==='ゃ'||ch==='ゅ'||ch==='ょ'){
        if(values.length)values[values.length-1]=ch==='ゃ'?'a':ch==='ゅ'?'u':'o';
        continue;
      }
      const vowel=kanaVowels[ch]||('aiueo'.includes(ch)&&ch.length===1?ch:null)||(ch==='ん'?'u':null);
      if(vowel)values.push(vowel);
    }
    return values;
  }
  function vowelAt(index){const vowels=sungVowels();return vowels.length?vowels[index%vowels.length]:$('vocal-vowel').value;}
  function refreshVocalOptions(){$('vocal-options').hidden=!isVocal($('instrument').value);}
  refreshVocalOptions();
  const audioCtor=()=>window.AudioContext||window.webkitAudioContext;
  const fmtTime=s=>`${Math.floor(Math.max(0,s)/60)}:${String(Math.floor(Math.max(0,s)%60)).padStart(2,'0')}`;
  const scoreSeconds=n=>n/TICKS*(60/bpm());
  function playbackUI(current=0){
    const duration=playback.duration;
    $('playback-progress').value=duration?clamp(current/duration,0,1):0;
    $('playback-time').textContent=`${fmtTime(current)} / ${fmtTime(duration)}`;
    $('play-score').textContent=playback.paused?'▶ 再開':playback.playing?'⏸ 一時停止':'▶ 譜面を再生';
    $('stop-score').disabled=!playback.context&&!playback.paused;
  }
  function makeOutput(ctx){
    const compressor=ctx.createDynamicsCompressor();
    compressor.threshold.value=-19;compressor.knee.value=15;compressor.ratio.value=3.3;
    compressor.attack.value=0.004;compressor.release.value=0.18;
    const master=ctx.createGain();master.gain.value=0.66;
    master.connect(compressor);compressor.connect(ctx.destination);
    return master;
  }
  // A scheduled, velocity-sensitive note. Times are in AudioContext seconds.
  function playTone(ctx,destination,pitch,velocity,when,held,preset,track=null,vowel='a'){
    const frequency=440*Math.pow(2,(pitch-69)/12);
    const v=clamp(velocity/110,.22,1);
    const duration=clamp(held,0.07,7);
    if(isVocal(preset))return playSungVowel(ctx,destination,frequency,v,when,duration,preset,track,vowel);
    const release=preset==='wurlitzer'?.26:(preset==='steinway'?.55:.4);
    const tail=release*3.5;
    const output=ctx.createGain();output.gain.value=.8;
    output.connect(destination);
    const envelope=ctx.createGain();envelope.gain.setValueAtTime(0,when);
    const attack=preset==='wurlitzer'?.006:(preset==='yamaha'?.004:.01);
    envelope.gain.linearRampToValueAtTime(v*.78,when+attack);
    // Piano tones fall naturally even when a note is held, while electric piano sustains longer.
    const target=preset==='wurlitzer'?.38:(preset==='steinway'?.22:.15);
    const decay=preset==='wurlitzer'?2.0:(preset==='steinway'?1.3:1.05);
    envelope.gain.setTargetAtTime(v*target,when+attack,decay);
    envelope.gain.setTargetAtTime(.00003,when+duration,release/3.6);
    envelope.connect(output);
    const oscillators=[];
    function addOsc(freq,type,amplitude,detuneCents=0,decaySeconds=0){
      if(freq>=ctx.sampleRate*.46)return null;
      const osc=ctx.createOscillator();osc.type=type;osc.frequency.setValueAtTime(freq,when);osc.detune.value=detuneCents;
      const partial=ctx.createGain();partial.gain.setValueAtTime(amplitude,when);
      if(decaySeconds>0)partial.gain.setTargetAtTime(Math.max(.00001,amplitude*.055),when+.035,decaySeconds);
      osc.connect(partial);partial.connect(envelope);osc.start(when);osc.stop(when+duration+tail);
      oscillators.push(osc);return osc;
    }
    if(preset==='wurlitzer'){
      const carrier=addOsc(frequency,'sine',.79);
      // Inharmonic, decaying frequency modulation gives the electric piano its tine-like attack.
      if(carrier){
        const mod=ctx.createOscillator();mod.type='sine';mod.frequency.setValueAtTime(frequency*2.013,when);
        const modAmount=ctx.createGain();
        modAmount.gain.setValueAtTime(frequency*.78,when);
        modAmount.gain.exponentialRampToValueAtTime(Math.max(.01,frequency*.025),when+.46);
        mod.connect(modAmount);modAmount.connect(carrier.frequency);
        mod.start(when);mod.stop(when+duration+tail);oscillators.push(mod);
      }
      addOsc(frequency*2,'sine',.20,0,.35);
      addOsc(frequency*3.92,'sine',.075,0,.12);
      // Slight tremolo from phase beating, rather than a costly per-voice effect node.
      addOsc(frequency,'sine',.09,1.3);
    }else{
      const bright=preset==='yamaha';
      const amplitudes=bright?[.69,.45,.27,.18,.12,.095,.052,.035]:[.78,.34,.19,.105,.072,.037,.024,.018];
      const spread=bright?0.38:0.30;
      const stiffness=bright?0.00020:0.00013;
      amplitudes.forEach((amp,i)=>{
        const harmonic=i+1;
        const inharmonic=frequency*harmonic*Math.sqrt(1+stiffness*harmonic*harmonic);
        const d=i===0?0:(bright?.08:-.04);
        const dsec=i===0?0:(bright?.28:.36)/(1+i*.12);
        addOsc(inharmonic,'sine',amp,d,dsec);
      });
      // A tiny, detuned unison makes the sound more like a vibrating piano string choir.
      addOsc(frequency,'sine',bright?.15:.20,-spread);
      addOsc(frequency,'sine',bright?.10:.18,spread);
      if(bright)addOsc(frequency*9.04,'sine',.015,0,.07);
    }
    const voice={oscillators,output};
    if(track){
      track.add(voice);
      let ended=0;
      for(const osc of oscillators)osc.addEventListener('ended',()=>{
        if(++ended===oscillators.length){output.disconnect();track.delete(voice);}
      },{once:true});
    }else{
      let ended=0;
      for(const osc of oscillators)osc.addEventListener('ended',()=>{if(++ended===oscillators.length)output.disconnect();},{once:true});
    }
    return voice;
  }
  // Lightweight formant singer. It sings a vowel at each score pitch, not real lyrics.
  function playSungVowel(ctx,destination,frequency,velocity,when,duration,preset,track,vowel){
    const profile=vocalPresets[preset];
    const tail=.30;
    const output=ctx.createGain();output.gain.value=.76;
    output.connect(destination);
    const envelope=ctx.createGain();envelope.gain.setValueAtTime(.0001,when);
    envelope.gain.linearRampToValueAtTime(.66*velocity*profile.soft,when+.055);
    envelope.gain.setTargetAtTime(.49*velocity*profile.soft,when+.09,.22);
    envelope.gain.setTargetAtTime(.0001,when+duration,.075);
    envelope.connect(output);
    const sources=[];
    const carrier=ctx.createOscillator();
    carrier.setPeriodicWave(vowelWave(ctx,frequency,preset,vowel));
    carrier.frequency.setValueAtTime(frequency*.993,when);
    carrier.frequency.exponentialRampToValueAtTime(frequency,when+.065);
    carrier.connect(envelope);carrier.start(when);carrier.stop(when+duration+tail);
    sources.push(carrier);
    // Gentle delayed vibrato evokes singing without copying a specific vocalist.
    const lfo=ctx.createOscillator();lfo.type='sine';lfo.frequency.value=profile.vibrato;
    const vibratoGain=ctx.createGain();vibratoGain.gain.setValueAtTime(0,when);
    vibratoGain.gain.linearRampToValueAtTime(profile.depth,when+Math.min(duration,.22));
    lfo.connect(vibratoGain);vibratoGain.connect(carrier.detune);
    lfo.start(when);lfo.stop(when+duration+tail);sources.push(lfo);
    // Low-level filtered air gives a sung rather than organ-like onset.
    const samples=Math.max(1,Math.round(ctx.sampleRate*.36));
    const noiseBuffer=ctx.createBuffer(1,samples,ctx.sampleRate);
    const data=noiseBuffer.getChannelData(0);
    let rnd=1459;
    for(let i=0;i<samples;i++){rnd=(rnd*1664525+1013904223)>>>0;data[i]=rnd/2147483648-1;}
    const noise=ctx.createBufferSource();noise.buffer=noiseBuffer;
    const hp=ctx.createBiquadFilter();hp.type='highpass';hp.frequency.value=1850;
    const air=ctx.createGain();air.gain.setValueAtTime(0,when);
    air.gain.linearRampToValueAtTime(profile.breath*velocity,when+.025);
    air.gain.setTargetAtTime(.0001,when+Math.min(duration,.21),.045);
    noise.connect(hp);hp.connect(air);air.connect(output);
    noise.start(when);noise.stop(when+Math.min(duration,.32));sources.push(noise);
    const voice={oscillators:sources,output};
    if(track)track.add(voice);
    let ended=0;
    for(const source of sources)source.addEventListener('ended',()=>{
      if(++ended===sources.length){try{output.disconnect();}catch(_){}if(track)track.delete(voice);}
    },{once:true});
    return voice;
  }
  function releasePlaybackContext(){
    if(playback.timer){clearInterval(playback.timer);playback.timer=null;}
    for(const voice of playback.voices){
      for(const osc of voice.oscillators){try{osc.stop();}catch(_){}}
      try{voice.output.disconnect();}catch(_){}
    }
    playback.voices.clear();
    if(playback.context){const old=playback.context;playback.context=null;old.close().catch(()=>{});}
  }
  function stopScore(){
    releasePlaybackContext();
    playback.playing=false;playback.paused=false;playback.offset=0;
    playback.notes=[];playback.index=0;playback.start=0;
    playbackUI(0);
  }
  function scheduler(){
    const ctx=playback.context;
    if(!ctx||playback.paused)return;
    const now=ctx.currentTime,windowEnd=now+.21;
    const preset=$('instrument').value;
    while(playback.index<playback.notes.length){
      const n=playback.notes[playback.index];
      const start=playback.start+scoreSeconds(n.start);
      if(start>windowEnd)break;
      playback.index++;
      const total=scoreSeconds(n.end-n.start);
      if(start+total<now-.08)continue;
      const when=Math.max(now+.005,start);
      const duration=Math.max(.065,total-Math.max(0,when-start));
      playTone(ctx,playback.master,n.pitch,n.velocity,when,duration,preset,playback.voices,vowelAt(playback.index-1));
    }
    const elapsed=Math.max(0,now-playback.start);
    playbackUI(elapsed);
    if(playback.index>=playback.notes.length&&elapsed>playback.duration+.72){stopScore();$('sound-note').textContent='再生が終わりました。別の音色を選んで、もう一度聴き比べられます。';}
  }
  async function toggleScore(){
    if(!audioCtor()){setStatus('このブラウザは音声再生に対応していません。',true);return;}
    if(playback.playing&&playback.context){
      playback.offset=Math.max(0,playback.context.currentTime-playback.start);
      releasePlaybackContext();
      playback.playing=false;playback.paused=true;
      playbackUI(playback.offset);
      return;
    }
    const resuming=playback.paused;
    const notes=resuming?playback.notes:normalizeNotes();
    if(!notes.length){setStatus('再生する音符がありません。先に採譜してください。',true);return;}
    try{
      const ctx=new (audioCtor())();
      playback.context=ctx;playback.master=makeOutput(ctx);
      playback.notes=notes;playback.index=0;
      if(!resuming){playback.offset=0;playback.duration=scoreSeconds(Math.max(...notes.map(n=>n.end)));}
      playback.start=ctx.currentTime+.09-playback.offset;
      playback.playing=true;playback.paused=false;
      await ctx.resume();
      scheduler();playback.timer=setInterval(scheduler,50);
      $('sound-note').textContent=`${instrumentLabels[$('instrument').value]}で再生中。BPM ${bpm()}。音色は内蔵シンセによる近似です。`;
    }catch(e){setStatus('再生に失敗しました: '+(e?.message||e),true);stopScore();}
  }
  $('play-score').addEventListener('click',toggleScore);
  $('stop-score').addEventListener('click',stopScore);
  $('instrument').addEventListener('change',()=>{
    if(playback.context||playback.paused)stopScore();
    refreshVocalOptions();
    $('sound-note').textContent=`${instrumentLabels[$('instrument').value]}を選択。▶で譜面を再生します。${isVocal($('instrument').value)?'母音だけの非公式ボーカルシンセです。':'実機の音源ではありません。'}`;
  });
  $('score-svg').addEventListener('click',async event=>{
    const target=event.target.closest('[data-pitch]');
    if(!target||!audioCtor())return;
    const pitch=Number(target.getAttribute('data-pitch'));
    const noteIndex=Number(target.getAttribute('data-note-index')||0);
    if(!Number.isInteger(pitch))return;
    try{
      if(!previewContext||previewContext.state==='closed'){previewContext=new (audioCtor())();previewMaster=makeOutput(previewContext);}
      await previewContext.resume();
      playTone(previewContext,previewMaster,pitch,88,previewContext.currentTime+.025,.40,$('instrument').value,null,vowelAt(noteIndex));
    }catch(e){setStatus('単音を再生できませんでした: '+(e?.message||e),true);}
  });
  $('vocal-test').addEventListener('click',async()=>{
    if(!audioCtor())return;
    try{
      if(!previewContext||previewContext.state==='closed'){
        previewContext=new (audioCtor())();previewMaster=makeOutput(previewContext);
      }
      await previewContext.resume();
      const pitches=[60,62,64,67,69],vowels=sungVowels();
      const start=previewContext.currentTime+.05;
      const preset=$('instrument').value;
      pitches.forEach((pitch,i)=>playTone(previewContext,previewMaster,pitch,90,start+i*.46,.38,preset,null,vowels.length?vowels[i%vowels.length]:['a','i','u','e','o'][i]));
      $('sound-note').textContent='5音の母音歌唱を再生しています。公式キャラクターの声ではありません。';
    }catch(e){setStatus('歌声サンプルを再生できませんでした: '+(e?.message||e),true);}
  });
  for(const id of ['vocal-vowel','vocal-lyrics'])$(id).addEventListener('change',()=>{
    if(playback.context||playback.paused)stopScore();
  });
  playbackUI();

  // Changing the score grid or BPM updates MIDI/XML without re-analyzing audio.
  for(const id of ['bpm','grid'])$(id).addEventListener('change',()=>{if(state.notes.length)refreshScore();});
  if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost')){
    window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  }
})();