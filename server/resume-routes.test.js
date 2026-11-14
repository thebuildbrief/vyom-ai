import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { migrate } from './migrate.js';
import { installResumeRoutes } from './resume-routes.js';

test('resume upload stores extracted text and AI analysis, with owner-only retrieval and reanalysis', async t => {
  const raw = new Database(':memory:');
  const db = { dialect: 'sqlite', prepare: raw.prepare.bind(raw), exec: raw.exec.bind(raw), pragma: raw.pragma.bind(raw), transaction: raw.transaction.bind(raw) };
  migrate(db);
  raw.prepare('INSERT INTO users(id,name,email,password) VALUES(?,?,?,?)').run('owner', 'Owner', 'owner@example.test', 'hash');
  raw.prepare('INSERT INTO users(id,name,email,password) VALUES(?,?,?,?)').run('other', 'Other', 'other@example.test', 'hash');
  const routes = new Map(), app = { get: (route,...handlers) => routes.set(`GET ${route}`,handlers), post: (route,...handlers) => routes.set(`POST ${route}`,handlers), delete: (route,...handlers) => routes.set(`DELETE ${route}`,handlers) };
  const secret = 'resume-test-secret-at-least-32-characters';
  const tokens = { owner: jwt.sign({id:'owner'},secret), other: jwt.sign({id:'other'},secret) };
  const auth = (req,res,next) => { try{req.user=jwt.verify(req.headers.authorization?.replace(/^Bearer /,'')||'',secret);return next()}catch{res.status(401).json({error:'Sign in required'})} };
  const storage = await fs.mkdtemp(path.join(os.tmpdir(),'vyom-resume-test-'));
  const env = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, OPENAI_BASE_URL: process.env.OPENAI_BASE_URL, UPLOAD_DIR: process.env.UPLOAD_DIR };
  const oldFetch = globalThis.fetch;
  t.after(async()=>{globalThis.fetch=oldFetch;for(const [key,value] of Object.entries(env))if(value===undefined)delete process.env[key];else process.env[key]=value;await fs.rm(storage,{recursive:true,force:true});raw.close()});
  process.env.OPENAI_API_KEY='test-only-key';process.env.OPENAI_BASE_URL='https://provider.test/v1';process.env.UPLOAD_DIR=storage;
  const analysis={summary:'Resume explicitly describes JavaScript and SQL project work.',education:['BSc Computer Science'],skills:['JavaScript','SQL'],experience:['Built an internal reporting tool'],projects:['Inventory dashboard'],strengths:['Shows database and frontend experience'],follow_up_questions:['How did you validate dashboard accuracy?']};
  globalThis.fetch=async(url,options)=>{assert.match(String(url),/provider\.test\/v1\/chat\/completions$/);const body=JSON.parse(options.body);assert.equal(body.response_format.type,'json_object');assert.match(body.messages[1].content,/Skills: JavaScript, SQL/);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(analysis)}}]}),{status:200,headers:{'content-type':'application/json'}})};
  installResumeRoutes(app,{db,auth});
  async function call(user,method,route,{file,params={}}={}){const handlers=routes.get(`${method} ${route}`);assert.ok(handlers);const req={headers:{authorization:`Bearer ${tokens[user]||''}`},user:undefined,params,body:{},file};const res={statusCode:200,headers:{},status(code){this.statusCode=code;return this},json(value){this.body=value;return this},setHeader(name,value){this.headers[name]=value},send(value){this.body=value;return this}};await handlers[0](req,res,()=>handlers.at(-1)(req,res));return res}
  const file={originalname:'candidate.pdf',mimetype:'application/pdf',buffer:Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nstream\nBT (Skills: JavaScript, SQL) Tj ET\nendstream\nendobj\n%%EOF')};
  const uploaded=await call('owner','POST','/api/resumes',{file});
  assert.equal(uploaded.statusCode,201);
  assert.equal(uploaded.body.resume.analysis_status,'ready');
  assert.deepEqual(uploaded.body.resume.analysis.skills,['JavaScript','SQL']);
  const id=uploaded.body.resume.id;
  assert.equal((await call('other','POST','/api/resumes/:id/analyze',{params:{id}})).statusCode,404);
  const list=await call('owner','GET','/api/resumes');
  assert.equal(list.body.resumes[0].ai_analyzed,true);
  assert.equal(list.body.resumes[0].analysis.summary,analysis.summary);
  const download=await call('owner','GET','/api/resumes/:id/file',{params:{id}});
  assert.equal(download.statusCode,200);
  assert.equal(download.headers['Cache-Control'],'private, no-store');
  assert.match(download.body.toString(),/^%PDF-/);
  assert.equal((await call('other','GET','/api/resumes/:id/file',{params:{id}})).statusCode,404);
  const rerun=await call('owner','POST','/api/resumes/:id/analyze',{params:{id}});
  assert.equal(rerun.body.analysis_status,'ready');
  assert.equal(raw.prepare('SELECT analysis FROM resumes WHERE id=? AND user_id=?').get(id,'owner').analysis,JSON.stringify(analysis));
});

test('resume AI analysis reports missing credentials instead of fabricating findings', async () => {
  const previous=process.env.OPENAI_API_KEY;delete process.env.OPENAI_API_KEY;
  const { analyzeResumeText }=await import('./resume-analysis.js');
  try{await assert.rejects(()=>analyzeResumeText('Resume says JavaScript.'),error=>error.status===503&&/OPENAI_API_KEY/.test(error.message))}
  finally{if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous}
});
