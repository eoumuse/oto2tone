/* oto2score: browser-side voice and piano analysis. No audio uploads. */
'use strict';
const SR = 11025;
function fft(re,im,inverse=false){
  const n=re.length;
  for(let i=1,j=0;i<n;i++){
    let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;
    if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}
  }
  for(let len=2;len<=n;len<<=1){
    const ang=(inverse?2:-2)*Math.PI/len,wlenR=Math.cos(ang),wlenI=Math.sin(ang);
    for(let i=0;i<n;i+=len){let wr=1,wi=0;
      for(let j=0;j<len/2;j++){
        const a=i+j,b=a+len/2,ur=re[a],ui=im[a],vr=re[b]*wr-im[b]*wi,vi=re[b]*wi+im[b]*wr;
        re[a]=ur+vr;im[a]=ui+vi;re[b]=ur-vr;im[b]=ui-vi;
        let nr=wr*wlenR-wi*wlenI;wi=wr*wlenI+wi*wlenR;wr=nr;
      }
    }
  }
  if(inverse){for(let i=0;i<n;i++){re[i]/=n;im[i]/=n;}}
}
function windowAudio(audio,offset,n,re,im){
  let sum=0;
  for(let i=0;i<n;i++){
    const t=(audio[offset+i]||0),v=t*(0.5-0.5*Math.cos(2*Math.PI*i/(n-1)));
    re[i]=v;im[i]=0;sum+=v*v;
  }
  return Math.sqrt(sum/n);
}
function autocorrPitch(audio,offset,n=2048){
  const re=new Float64Array(n),im=new Float64Array(n);
  const rms=windowAudio(audio,offset,n,re,im);
  if(rms<.0005)return {p:-1,rms,conf:0};
  fft(re,im);
  for(let i=0;i<n;i++){re[i]=re[i]*re[i]+im[i]*im[i];im[i]=0;}
  fft(re,im,true);
  const minLag=Math.floor(SR/1000),maxLag=Math.min(n/2,Math.ceil(SR/75));
  const r0=re[0];let best=0,bestLag=-1;
  const ratios=new Float64Array(maxLag+2);
  for(let lag=minLag;lag<=maxLag;lag++){
    const val=re[lag]/Math.max(r0,1e-15);
    ratios[lag]=val;
    if(val>best){best=val;bestLag=lag;}
  }
  if(best<.38||bestLag<0)return {p:-1,rms,conf:best};
  let lag=bestLag;
  for(let i=minLag+1;i<bestLag;i++){
    if(ratios[i]>=Math.max(.42,best*.88)&&ratios[i]>=ratios[i-1]&&ratios[i]>=ratios[i+1]){lag=i;break;}
  }
  const prev=ratios[lag-1],cur=ratios[lag],next=ratios[lag+1],den=prev-2*cur+next;
  const fraction=Math.abs(den)>1e-7?Math.max(-1,Math.min(1,.5*(prev-next)/den)):0;
  const freq=SR/(lag+fraction),p=Math.round(69+12*Math.log2(freq/440));
  return {p:p>=36&&p<=96?p:-1,rms,conf:best};
}
function collectNotes(pitches,energies,hop,sensitivity,minTime){
  const maxEnergy=Math.max(...energies,.00001);
  const gate=Math.max(.001,maxEnergy*(.14-sensitivity*.085));
  const smoothed=[];
  for(let i=0;i<pitches.length;i++){
    if(energies[i]<gate){smoothed.push(-1);continue;}
    const nearby=[];
    for(let j=Math.max(0,i-2);j<=Math.min(pitches.length-1,i+2);j++)
      if(pitches[j]>=0&&energies[j]>=gate)nearby.push(pitches[j]);
    nearby.sort((a,b)=>a-b);
    smoothed.push(nearby.length?nearby[Math.floor(nearby.length/2)]:-1);
  }
  for(let i=1;i<smoothed.length-2;i++)
    if(smoothed[i]<0&&smoothed[i-1]>=0&&smoothed[i+1]===smoothed[i-1])smoothed[i]=smoothed[i-1];
  const events=[];let start=0,last=-1;
  for(let i=0;i<=smoothed.length;i++){
    const p=i<smoothed.length?smoothed[i]:-1;
    if(p!==last){
      if(last>=0){
        const st=Math.max(0,start*hop/SR),en=i*hop/SR;
        if(en-st>=minTime)events.push({start:st,end:en,pitch:last,velocity:85});
      }
      start=i;last=p;
    }
  }
  return events;
}
function analyzeVoice(audio,sensitivity){
  const N=2048,HOP=256,pitches=[],energies=[];
  for(let at=0,frame=0;at<audio.length;at+=HOP,frame++){
    const {p,rms,conf}=autocorrPitch(audio,at,N);
    pitches.push(conf>.43-.08*sensitivity?p:-1);energies.push(rms);
    if(frame%45===0)postMessage({type:'progress',percent:Math.round(at/audio.length*95)});
  }
  return collectNotes(pitches,energies,HOP,sensitivity,.095);
}
function freqMag(mag,hz){
  const k=hz*mag.length*2/SR,idx=Math.round(k);
  if(idx<=1||idx>=mag.length-2)return 0;
  return Math.max(mag[idx-1]*.72,mag[idx],mag[idx+1]*.72);
}
function analyzePiano(audio,sensitivity){
  const N=4096,HOP=512,pitches=Array.from({length:66},()=>[]),energies=[],peakVals=[];
  const re=new Float64Array(N),im=new Float64Array(N),mag=new Float32Array(N/2);
  const midis=Array.from({length:66},(_,i)=>36+i);
  for(let at=0,frame=0;at<audio.length;at+=HOP,frame++){
    const rms=windowAudio(audio,at,N,re,im);fft(re,im);
    for(let k=0;k<mag.length;k++)mag[k]=Math.hypot(re[k],im[k]);
    const strengths=[],fundamentals=[];
    for(let j=0;j<midis.length;j++){
      const fundamental=440*Math.pow(2,(midis[j]-69)/12);
      const f1=freqMag(mag,fundamental);fundamentals[j]=f1;
      strengths[j]=f1+freqMag(mag,2*fundamental)*.38+freqMag(mag,3*fundamental)*.2;
    }
    const corrected=strengths.map((v,j)=>{
      let result=v;if(j>=12)result-=.48*strengths[j-12];
      if(j>=19)result-=.14*strengths[j-19];
      return Math.max(0,result);
    });
    const top=Math.max(...corrected,.00001);
    peakVals.push(top);energies.push(rms);
    const rel=.38-sensitivity*.19;
    for(let j=0;j<corrected.length;j++){
      const x=corrected[j];
      const local=x>=(corrected[j-1]||0)*.97&&x>=(corrected[j+1]||0)*.97;
      const fundamental=fundamentals[j]>top*(.13-sensitivity*.05);
      pitches[j].push(local&&x>top*rel&&fundamental?x:0);
    }
    if(frame%24===0)postMessage({type:'progress',percent:Math.round(at/audio.length*95)});
  }
  const maxPeak=Math.max(...peakVals,1e-9),notes=[];
  for(let j=0;j<pitches.length;j++){
    const strength=pitches[j];let started=-1,holes=0;
    for(let t=0;t<=strength.length;t++){
      const active=t<strength.length&&strength[t]>(.06-sensitivity*.035)*maxPeak&&energies[t]>.002;
      if(active){if(started<0)started=t;holes=0;}
      else if(started>=0){
        holes++;
        if(holes>2||t===strength.length){
          const last=t-holes+1,start=Math.max(0,started*HOP/SR-.04),
            end=Math.min(audio.length/SR,last*HOP/SR-.02);
          if(end-start>.13)notes.push({start,end,pitch:midis[j],velocity:80});
          started=-1;holes=0;
        }
      }
    }
  }
  return notes.sort((a,b)=>a.start-b.start||a.pitch-b.pitch).slice(0,700);
}
self.onmessage=event=>{
  try{
    const {audio,mode,sensitivity}=event.data;
    if(!audio||audio.length<2205)throw new Error('0.2秒以上の音声を選んでください。');
    if(audio.length/SR>60.15)throw new Error('60秒以内の音声を選んでください。');
    const peak=audio.reduce((m,v)=>Math.max(m,Math.abs(v)),0);
    if(peak<1e-4)throw new Error('音がほとんど入っていません。');
    const notes=mode==='piano'?analyzePiano(audio,sensitivity):analyzeVoice(audio,sensitivity);
    postMessage({type:'done',notes});
  }catch(err){postMessage({type:'error',message:String(err?.message||err)});}
};