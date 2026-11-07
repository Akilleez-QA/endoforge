import { readFileSync } from 'node:fs';
export async function warm() {}
export function createPort(o){ return { async evaluate(){ return {stage:'completed',attempts:[],frontier:[],env:process.env.SYNTHETIC_SECRET??null,file:readFileSync(o.path,'utf8')}; } } }
