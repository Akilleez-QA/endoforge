export function createPort(options,{host}={}){ return { async evaluate(){ const t=Date.now();
  if(options.mode==='refresh'){ let n=0; while(Date.now()-t<options.forMs){ const s=Date.now(); while(Date.now()-s<100); await host({kind:'nope'}).catch(()=>{}); n++; } return {stage:'completed',attempts:[],frontier:[],calls:n}; }
  if(options.mode==='spin'){ host({kind:'hang'}).catch(()=>{}); await new Promise(r=>setTimeout(r,20)); for(;;); }
  if(options.mode==='amp'){ let n=0; for(let i=0;i<options.calls;i++){ await host({kind:'model',messages:[],remaining:-1}); n++; } return {stage:'completed',attempts:[],frontier:[],calls:n}; }
 } } }
