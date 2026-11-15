import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import multer from 'multer';
import { put, get, del } from '@vercel/blob';
import { handleUpload } from '@vercel/blob/client';
import { extractPdfText, tryOcrPdf } from './pdf.js';
import { hasObjectStorage, objectRequest } from './private-storage.js';
import { analyzeResumeText } from './resume-analysis.js';

function sections(text){
  const pick=names=>{const re=new RegExp(`(?:^|\\b)(?:${names.join('|')})\\s*[:\\n-]\\s*([\\s\\S]{0,1100})`,'i');return text.match(re)?.[1]?.split(/\\b(?:education|experience|work history|projects?|skills|certifications?)\\b/i)[0]?.trim()||''};
  return {email:text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0]||'',phone:text.match(/(?:\+?\d[\d ()-]{7,}\d)/)?.[0]||'',education:pick(['education']),skills:pick(['technical skills','skills','technologies']),experience:pick(['experience','work history','employment']),projects:pick(['projects','selected projects']),certifications:pick(['certifications','certificates'])};
}
function parseAnalysis(value){try{return value?JSON.parse(value):null}catch{return null}}
async function saveObject(key,buffer){
  if(process.env.BLOB_READ_WRITE_TOKEN){const blob=await put(key,buffer,{access:'private',addRandomSuffix:false,contentType:'application/pdf'});return `blob:${blob.pathname}`;}
  if(hasObjectStorage()){const result=await objectRequest('PUT',key,buffer,'application/pdf');if(!result.ok)throw new Error('Private object storage rejected the resume upload.');return `s3:${key}`;}
  if(process.env.VERCEL||process.env.NODE_ENV==='production')throw Object.assign(new Error('Configure a private Vercel Blob store or S3-compatible storage before uploading resumes.'),{status:503});
  const dir=path.resolve(process.env.UPLOAD_DIR||'./server/uploads');await fs.mkdir(dir,{recursive:true});const local=path.join(dir,`${crypto.randomUUID()}.pdf`);await fs.writeFile(local,buffer,{flag:'wx'});return local;
}
async function readObject(reference){
  if(reference.startsWith('blob:')){const result=await get(reference.slice(5),{access:'private'});if(result?.statusCode!==200||!result.stream)throw new Error('Could not retrieve the private resume.');return Buffer.from(await new Response(result.stream).arrayBuffer());}
  if(reference.startsWith('s3:')){const result=await objectRequest('GET',reference.slice(3));if(!result.ok)throw new Error('Could not retrieve the private resume.');return Buffer.from(await result.arrayBuffer());}
  return fs.readFile(reference);
}
async function deleteObject(reference){if(reference.startsWith('blob:'))return del(reference.slice(5));if(reference.startsWith('s3:'))return objectRequest('DELETE',reference.slice(3));return fs.rm(reference,{force:true});}
function cleanFilename(value){return path.basename(String(value||'resume.pdf')).replace(/[\r\n]/g,'').slice(0,200)||'resume.pdf'}
async function processStoredResume({db,userId,id,filename,reference,buffer}){
  if(buffer.subarray(0,5).toString()!=='%PDF-')throw new Error('Uploaded content is not a valid PDF.');
  let text=extractPdfText(buffer);
  if(!text&&process.env.PDFTOPPM_CMD&&process.env.TESSERACT_CMD){const temp=path.join(os.tmpdir(),`${id}.pdf`);try{await fs.writeFile(temp,buffer);text=await tryOcrPdf(temp)}finally{await fs.rm(temp,{force:true})}}
  await db.prepare("INSERT INTO resumes(id,user_id,filename,path,extracted_text,analysis) VALUES(?,?,?,?,?,'') ON CONFLICT(id) DO NOTHING").run(id,userId,filename,reference,text.slice(0,50000));
  if(text&&process.env.OPENAI_API_KEY){try{const analysis=await analyzeResumeText(text);await db.prepare('UPDATE resumes SET analysis=? WHERE id=? AND user_id=?').run(JSON.stringify(analysis),id,userId)}catch{/* Store extraction even when the optional AI analysis provider is unavailable. */}}
}
export function installResumeRoutes(app,{db,auth}){
  const serverUploadLimit=process.env.VERCEL&&!process.env.BLOB_READ_WRITE_TOKEN?4*1024*1024:8*1024*1024;
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:serverUploadLimit,files:1},fileFilter:(_req,file,cb)=>cb(null,file.mimetype==='application/pdf'&&file.originalname.toLowerCase().endsWith('.pdf'))});
  app.get('/api/resumes/upload-config',auth,(_req,res)=>res.json({method:process.env.VERCEL&&process.env.BLOB_READ_WRITE_TOKEN?'blob-client':'server',maximum_size:process.env.VERCEL&&!process.env.BLOB_READ_WRITE_TOKEN?4*1024*1024:8*1024*1024}));
  const handleBlobUpload=async(req,res)=>{try{const result=await handleUpload({body:req.body,request:req,onBeforeGenerateToken:async(pathname,clientPayload)=>{if(!req.user?.id)throw Object.assign(new Error('Please sign in to upload a resume.'),{status:401});let payload;try{payload=JSON.parse(clientPayload||'')}catch{throw Object.assign(new Error('Resume upload metadata is invalid.'),{status:400})}const id=String(payload.resumeId||''),filename=cleanFilename(payload.filename);if(!/^[0-9a-f-]{36}$/i.test(id)||pathname!==`resumes/${req.user.id}/${id}.pdf`)throw Object.assign(new Error('Resume upload path is not allowed.'),{status:403});return{allowedContentTypes:['application/pdf'],maximumSizeInBytes:8*1024*1024,addRandomSuffix:false,tokenPayload:JSON.stringify({userId:req.user.id,resumeId:id,filename})}},onUploadCompleted:async({blob,tokenPayload})=>{let payload;try{payload=JSON.parse(tokenPayload||'')}catch{throw new Error('Resume upload ownership metadata is invalid.')}const {userId,resumeId,filename}=payload;if(!userId||!/^[0-9a-f-]{36}$/i.test(String(resumeId||''))||blob.pathname!==`resumes/${userId}/${resumeId}.pdf`)throw new Error('Resume upload ownership could not be verified.');const exists=await db.prepare('SELECT id FROM resumes WHERE id=? AND user_id=?').get(resumeId,userId);if(exists)return;const buffer=await readObject(`blob:${blob.pathname}`);await processStoredResume({db,userId,id:resumeId,filename:cleanFilename(filename),reference:`blob:${blob.pathname}`,buffer})}});res.json(result)}catch(e){res.status(e.status||400).json({error:e.status?e.message:'Private resume upload could not be completed.'})}};
  app.post('/api/resumes/blob-upload',async(req,res,next)=>{if(req.body?.type==='blob.upload-completed')return handleBlobUpload(req,res);next()},auth,handleBlobUpload);
  app.get('/api/resumes',auth,async(req,res)=>{try{const rows=await db.prepare('SELECT id,filename,created_at,extracted_text,analysis FROM resumes WHERE user_id=? ORDER BY created_at DESC').all(req.user.id);res.json({resumes:rows.map(({extracted_text,analysis,...resume})=>({...resume,analyzed:Boolean(extracted_text),sections:sections(extracted_text||''),analysis:parseAnalysis(analysis),ai_analyzed:Boolean(parseAnalysis(analysis))}))})}catch(e){res.status(500).json({error:'Could not load resumes.'})}});
  app.post('/api/resumes',auth,upload.single('resume'),async(req,res)=>{
    if(!req.file)return res.status(400).json({error:'Choose a PDF resume (up to 8 MB).'});
    if(req.file.buffer.subarray(0,5).toString()!=='%PDF-')return res.status(400).json({error:'This file does not contain a valid PDF header.'});
    const id=crypto.randomUUID(),key=`resumes/${req.user.id}/${id}.pdf`;let text=extractPdfText(req.file.buffer),reference;
    if(!text&&process.env.PDFTOPPM_CMD&&process.env.TESSERACT_CMD){const temp=path.join(os.tmpdir(),`${id}.pdf`);try{await fs.writeFile(temp,req.file.buffer);text=await tryOcrPdf(temp)}finally{await fs.rm(temp,{force:true})}}
    let filename;
    try{reference=await saveObject(key,req.file.buffer);filename=path.basename(req.file.originalname).replace(/[\r\n]/g,'').slice(0,200);await db.prepare("INSERT INTO resumes(id,user_id,filename,path,extracted_text,analysis) VALUES(?,?,?,?,?,'')").run(id,req.user.id,filename,reference,text.slice(0,50000))}catch(e){if(reference)await deleteObject(reference).catch(()=>{});res.status(e.status||502).json({error:e.message||'Could not store the resume privately.'});return}
    let analysis=null,analysisStatus='unavailable',analysisError='';
    if(text&&process.env.OPENAI_API_KEY){try{analysis=await analyzeResumeText(text);await db.prepare('UPDATE resumes SET analysis=? WHERE id=? AND user_id=?').run(JSON.stringify(analysis),id,req.user.id);analysisStatus='ready'}catch(e){analysisStatus='failed';analysisError=e.status===503?'AI resume analysis needs OPENAI_API_KEY configured on the server.':'The resume was saved, but AI analysis could not be completed. You can retry it from your resume library.'}}
    else if(text)analysisError='Resume saved and parsed. Add OPENAI_API_KEY on the server to enable AI analysis.';
    const message=text?(analysisStatus==='ready'?'Resume uploaded, analyzed and saved for personalized interviews.':analysisStatus==='failed'?'Resume uploaded and parsed; AI analysis failed and can be retried.':analysisError):(process.env.PDFTOPPM_CMD?'No selectable text found; OCR returned no text.':'Resume uploaded. This PDF appears scanned; configure PDFTOPPM_CMD and TESSERACT_CMD to enable OCR.');
    res.status(201).json({resume:{id,filename,extracted_text:!!text,sections:sections(text),analysis,analysis_status:analysisStatus},message,analysis_error:analysisError||undefined});
  });
  app.post('/api/resumes/:id/analyze',auth,async(req,res)=>{const item=await db.prepare('SELECT extracted_text FROM resumes WHERE id=? AND user_id=?').get(req.params.id,req.user.id);if(!item)return res.status(404).json({error:'Resume not found.'});try{const analysis=await analyzeResumeText(item.extracted_text);await db.prepare('UPDATE resumes SET analysis=? WHERE id=? AND user_id=?').run(JSON.stringify(analysis),req.params.id,req.user.id);res.json({analysis,analysis_status:'ready'})}catch(e){res.status(e.status||502).json({error:e.status===503?e.message:e.status===422?e.message:'AI resume analysis failed. Please retry shortly.'})}});
  app.get('/api/resumes/:id/file',auth,async(req,res)=>{try{const item=await db.prepare('SELECT * FROM resumes WHERE id=? AND user_id=?').get(req.params.id,req.user.id);if(!item)return res.status(404).json({error:'Resume not found.'});const bytes=await readObject(item.path);res.setHeader('Content-Type','application/pdf');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Disposition',`inline; filename="${item.filename.replace(/["\\]/g,'')}"`);res.send(bytes)}catch{res.status(502).json({error:'Could not retrieve the private resume.'})}});
  app.delete('/api/resumes/:id',auth,async(req,res)=>{try{const item=await db.prepare('SELECT * FROM resumes WHERE id=? AND user_id=?').get(req.params.id,req.user.id);if(!item)return res.status(404).json({error:'Resume not found.'});await deleteObject(item.path);await db.prepare('DELETE FROM resumes WHERE id=? AND user_id=?').run(item.id,req.user.id);res.json({ok:true})}catch{res.status(502).json({error:'Could not delete the private resume.'})}});
}
