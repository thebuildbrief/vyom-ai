import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from './migrate.js';
import { installAiRoutes } from './ai-coding-routes.js';

function fixture(){
  const raw=new Database(':memory:');
  const db={dialect:'sqlite',prepare:raw.prepare.bind(raw),exec:raw.exec.bind(raw),pragma:raw.pragma.bind(raw),transaction:raw.transaction.bind(raw)};
  migrate(db);raw.prepare('INSERT INTO users(id,name,email,password) VALUES(?,?,?,?)').run('candidate','Candidate','candidate@example.test','hash');
  raw.prepare("INSERT INTO interviews(id,user_id,role,type,difficulty,status) VALUES('interview-1','candidate','Software Engineer','Technical','Medium','active')").run();
  const routes=new Map(),app=Object.fromEntries(['get','post','put','patch','delete'].map(method=>[method,(route,...handlers)=>routes.set(`${method.toUpperCase()} ${route}`,handlers)]));
  const auth=(req,_res,next)=>{req.user={id:'candidate'};return next()};
  const owned=async(req,res,next)=>{const item=await db.prepare('SELECT * FROM interviews WHERE id=? AND user_id=?').get(req.params.id,req.user.id);if(!item)return res.status(404).json({error:'Interview not found.'});req.interview=item;return next()};
  installAiRoutes(app,{db,auth,owned});
  return{raw,db,routes,auth,owned};
}
async function invoke(f,route,{params={id:'interview-1'},body={}}={}){
  const handlers=f.routes.get(`POST ${route}`);assert.ok(handlers,`registered POST ${route}`);
  const req={params,body,user:null,headers:{},get:()=>'',app:{locals:{db:f.db}}};
  const res={statusCode:200,headers:{},status(code){this.statusCode=code;return this},json(data){this.body=data;return this},setHeader(name,value){this.headers[name]=value;return this}};
  const run=async index=>{const handler=handlers[index];if(index===handlers.length-1)return handler(req,res);return handler(req,res,()=>run(index+1))};
  await run(0);return res;
}

test('Realtime session route issues a short-lived credential with interview context and saves both transcript roles',async t=>{
  const f=fixture(),keys={OPENAI_API_KEY:process.env.OPENAI_API_KEY,OPENAI_BASE_URL:process.env.OPENAI_BASE_URL},oldFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=oldFetch;for(const[k,v]of Object.entries(keys))if(v===undefined)delete process.env[k];else process.env[k]=v;f.raw.close()});
  process.env.OPENAI_API_KEY='server-test-secret';process.env.OPENAI_BASE_URL='https://provider.test/v1';
  let request;
  globalThis.fetch=async(url,options)=>{request={url:String(url),options,body:JSON.parse(options.body)};return new Response(JSON.stringify({value:'temporary-client-secret'}),{status:200,headers:{'content-type':'application/json'}})};
  const session=await invoke(f,'/api/interviews/:id/voice/session');
  assert.equal(session.statusCode,200);
  assert.equal(session.body.client_secret,'temporary-client-secret');
  assert.equal(session.headers['Cache-Control'],'no-store');
  assert.equal(request.url,'https://provider.test/v1/realtime/client_secrets');
  assert.equal(request.options.headers.Authorization,'Bearer server-test-secret');
  assert.match(request.body.session.instructions,/Software Engineer/);
  assert.equal(request.body.expires_after.seconds,600);
  const user=await invoke(f,'/api/interviews/:id/transcript',{body:{role:'user',content:'I would use a hash map.'}});
  const assistant=await invoke(f,'/api/interviews/:id/transcript',{body:{role:'assistant',content:'What tradeoff does the hash map introduce?'}});
  assert.equal(user.statusCode,201);assert.equal(assistant.statusCode,201);
  assert.deepEqual(f.raw.prepare('SELECT role,content FROM messages WHERE interview_id=? ORDER BY created_at,id').all('interview-1').map(row=>row.role),['user','assistant']);
});

test('Realtime session fails closed when server credentials are absent',async t=>{
  const f=fixture(),previous=process.env.OPENAI_API_KEY;delete process.env.OPENAI_API_KEY;
  t.after(()=>{if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;f.raw.close()});
  const res=await invoke(f,'/api/interviews/:id/voice/session');
  assert.equal(res.statusCode,503);assert.match(res.body.error,/OPENAI_API_KEY/);
});

test('Concurrent interview start requests save one opening question',async t=>{
  const f=fixture(),previous=process.env.OPENAI_API_KEY,oldFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=oldFetch;if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;f.raw.close()});
  process.env.OPENAI_API_KEY='server-test-secret';
  globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:'Tell me about a project.'}}]}),{status:200,headers:{'content-type':'application/json'}});
  const waitForBody=async res=>{for(let i=0;i<200&&!res.body;i+=1)await new Promise(resolve=>setTimeout(resolve,10));return res};
  const [first,second]=await Promise.all([invoke(f,'/api/interviews/:id/start'),invoke(f,'/api/interviews/:id/start')]);
  await Promise.all([waitForBody(first),waitForBody(second)]);
  assert.equal(first.statusCode,200);assert.equal(second.statusCode,200);
  assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM messages WHERE interview_id=?').get('interview-1').n,1);
});
