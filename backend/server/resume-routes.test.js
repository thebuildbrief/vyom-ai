import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { migrate } from './migrate.js';
import { installResumeRoutes, DOCX_TYPE, PDF_TYPE, MAX_RESUME_BYTES } from './resume-routes.js';

async function docxBuffer(text) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

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

test('resume upload accepts Word documents, enforces file signatures, and reports only non-secret storage config', async t => {
  const raw = new Database(':memory:');
  const db = { dialect: 'sqlite', prepare: raw.prepare.bind(raw), exec: raw.exec.bind(raw), pragma: raw.pragma.bind(raw), transaction: raw.transaction.bind(raw) };
  migrate(db);
  raw.prepare('INSERT INTO users(id,name,email,password) VALUES(?,?,?,?)').run('owner', 'Owner', 'owner@example.test', 'hash');
  const routes = new Map(), app = { get: (route,...handlers) => routes.set(`GET ${route}`,handlers), post: (route,...handlers) => routes.set(`POST ${route}`,handlers), delete: (route,...handlers) => routes.set(`DELETE ${route}`,handlers) };
  const secret = 'resume-test-secret-at-least-32-characters';
  const token = jwt.sign({id:'owner'},secret);
  const auth = (req,res,next) => { try{req.user=jwt.verify(req.headers.authorization?.replace(/^Bearer /,'')||'',secret);return next()}catch{res.status(401).json({error:'Sign in required'})} };
  const storage = await fs.mkdtemp(path.join(os.tmpdir(),'vyom-resume-docx-'));
  const env = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, UPLOAD_DIR: process.env.UPLOAD_DIR, VERCEL: process.env.VERCEL };
  t.after(async()=>{for(const [key,value] of Object.entries(env))if(value===undefined)delete process.env[key];else process.env[key]=value;await fs.rm(storage,{recursive:true,force:true});raw.close()});
  delete process.env.OPENAI_API_KEY; delete process.env.VERCEL; process.env.UPLOAD_DIR=storage;
  installResumeRoutes(app,{db,auth});
  async function call(method,route,{file,params={}}={}){const handlers=routes.get(`${method} ${route}`);assert.ok(handlers);const req={headers:{authorization:`Bearer ${token}`},user:undefined,params,body:{},file,get:()=>undefined};const res={statusCode:200,headers:{},status(code){this.statusCode=code;return this},json(value){this.body=value;return this},setHeader(name,value){this.headers[name]=value;return this},send(value){this.body=value;return this}};await handlers[0](req,res,()=>handlers.at(-1)(req,res));return res}

  const config=await call('GET','/api/resumes/upload-config');
  assert.equal(config.body.maximum_size,MAX_RESUME_BYTES);
  assert.equal(config.body.maximum_size_mb,8);
  assert.deepEqual(config.body.accepted_types,[PDF_TYPE,DOCX_TYPE]);
  assert.equal(config.body.storage_provider,'local');
  assert.equal(config.body.storage_configured,true);

  const buffer=await docxBuffer('Candidate resume. Skills: JavaScript, SQL.');
  const uploaded=await call('POST','/api/resumes',{file:{originalname:'candidate.docx',mimetype:DOCX_TYPE,buffer,size:buffer.length}});
  assert.equal(uploaded.statusCode,201);
  assert.equal(uploaded.body.resume.mime_type,DOCX_TYPE);
  assert.equal(uploaded.body.resume.size_bytes,buffer.length);
  assert.equal(uploaded.body.resume.extracted_text,true);
  assert.match(uploaded.body.message,/Add OPENAI_API_KEY/);
  const list=await call('GET','/api/resumes');
  assert.equal(list.body.resumes[0].mime_type,DOCX_TYPE);
  assert.equal(list.body.resumes[0].size_bytes,buffer.length);
  const download=await call('GET','/api/resumes/:id/file',{params:{id:uploaded.body.resume.id}});
  assert.equal(download.headers['Content-Type'],DOCX_TYPE);
  assert.equal(download.headers['Cache-Control'],'private, no-store');
  assert.match(download.body.subarray(0,2).toString(),/^PK$/);

  const spoofed=Buffer.from('PK\u0003\u0004not a word document');
  const rejected=await call('POST','/api/resumes',{file:{originalname:'broken.docx',mimetype:DOCX_TYPE,buffer:spoofed,size:spoofed.length}});
  assert.equal(rejected.statusCode,400);
  assert.match(rejected.body.error,/Word \(\.docx\)/);
  assert.equal((await call('POST','/api/resumes',{file:{originalname:'notes.txt',mimetype:'text/plain',buffer:Buffer.from('hello'),size:5}})).statusCode,400);
});

test('resume AI analysis reports missing credentials instead of fabricating findings', async () => {
  const previous=process.env.OPENAI_API_KEY;delete process.env.OPENAI_API_KEY;
  const { analyzeResumeText }=await import('./resume-analysis.js');
  try{await assert.rejects(()=>analyzeResumeText('Resume says JavaScript.'),error=>error.status===503&&/OPENAI_API_KEY/.test(error.message))}
  finally{if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous}
});
