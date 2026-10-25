import * as core from 'core.js';
import module from 'compiler.wasm';
import kernel from 'kernel.wasm';
import {check} from 'check.mjs';
export default {async fetch(request) {
  if (new URL(request.url).pathname === '/ping') return new Response('ok');
  try {
    const {engine, project} = await request.json();
    return Response.json(check(engine, core, module, kernel, project));
  } catch(e) { return Response.json({error: String(e), stack: e.stack}, {status: 500}); }
}};
