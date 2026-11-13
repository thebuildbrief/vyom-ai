import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import multer from 'multer';
import { put, get, del } from '@vercel/blob';
import { extractPdfText, tryOcrPdf } from './pdf.js';
import { hasObjectStorage, objectRequest } from './private-storage.js';

function sections(text){
  const pick=names=>{const re=new RegExp(`(?:^|\\b)(?:${names.join('|')})\\s*[:\\n-]\\s*([\\s\\S]{0,1100})`,'i');return text.match(re)?.[1]?.split(/\\b(?:education|experience|work history|projects?|skills|certifications?)\\b/i)[0]?.trim()||''};
  return {email:text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0]||'',phone:text.match(/(?:\+?\d[\d ()-]{7,}\d)/)?.[0]||'',education:pick(['education']),skills:pick(['technical skills','skills','technologies']),experience:pick(['experience','work history','employment']),projects:pick(['projects','selected projects']),certifications:pick(['certifications','certificates'])};
}
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
export function installResumeRoutes(app,{db,auth}){
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024,files:1},fileFilter:(_req,file,cb)=>cb(null,file.mimetype==='application/pdf'&&file.originalname.toLowerCase().endsWith('.pdf'))});
  app.get('/api/resumes',auth,async(req,res)=>{try{res.json({resumes:await db.prepare('SELECT id,filename,created_at,CASE WHEN length(extracted_text)>0 THEN 1 ELSE 0 END AS analyzed FROM resumes WHERE user_id=? ORDER BY created_at DESC').all(req.user.id)})}catch(e){res.status(500).json({error:'Could not load resumes.'})}});
  app.post('/api/resumes',auth,upload.single('resume'),async(req,res)=>{
    if(!req.file)return res.status(400).json({error:'Choose a PDF resume (up to 8 MB).'});
    if(req.file.buffer.subarray(0,5).toString()!=='%PDF-')return res.status(400).json({error:'This file does not contain a valid PDF header.'});
    const id=crypto.randomUUID(),key=`resumes/${req.user.id}/${id}.pdf`;let text=extractPdfText(req.file.buffer),reference;
    if(!text&&process.env.PDFTOPPM_CMD&&process.env.TESSERACT_CMD){const temp=path.join(os.tmpdir(),`${id}.pdf`);try{await fs.writeFile(temp,req.file.buffer);text=await tryOcrPdf(temp)}finally{await fs.rm(temp,{force:true})}}
    try{reference=await saveObject(key,req.file.buffer);const filename=path.basename(req.file.originalname).replace(/[\r\n]/g,'').slice(0,200);await db.prepare('INSERT INTO resumes(id,user_id,filename,path,extracted_text) VALUES(?,?,?,?,?)').run(id,req.user.id,filename,reference,text.slice(0,50000));res.status(201).json({resume:{id,filename,extracted_text:!!text,sections:sections(text)},message:text?'Resume uploaded and text extracted for personalized interview questions.':(process.env.PDFTOPPM_CMD?'No selectable text found; OCR returned no text.':'Resume uploaded. This PDF appears scanned; configure PDFTOPPM_CMD and TESSERACT_CMD to enable OCR.')})}catch(e){if(reference)await deleteObject(reference).catch(()=>{});res.status(e.status||502).json({error:e.message||'Could not store the resume privately.'})}
  });
  app.get('/api/resumes/:id/file',auth,async(req,res)=>{try{const item=await db.prepare('SELECT * FROM resumes WHERE id=? AND user_id=?').get(req.params.id,req.user.id);if(!item)return res.status(404).json({error:'Resume not found.'});const bytes=await readObject(item.path);res.setHeader('Content-Type','application/pdf');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Disposition',`inline; filename="${item.filename.replace(/["\\]/g,'')}"`);res.send(bytes)}catch{res.status(502).json({error:'Could not retrieve the private resume.'})}});
  app.delete('/api/resumes/:id',auth,async(req,res)=>{try{const item=await db.prepare('SELECT * FROM resumes WHERE id=? AND user_id=?').get(req.params.id,req.user.id);if(!item)return res.status(404).json({error:'Resume not found.'});await deleteObject(item.path);await db.prepare('DELETE FROM resumes WHERE id=? AND user_id=?').run(item.id,req.user.id);res.json({ok:true})}catch{res.status(502).json({error:'Could not delete the private resume.'})}});
}
