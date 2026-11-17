import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import multer from 'multer';
import { put, get, del, issueSignedToken, presignUrl, getDownloadUrl } from '@vercel/blob';
import { handleUpload } from '@vercel/blob/client';
import { extractPdfText, extractDocxText, tryOcrPdf } from './pdf.js';
import { storageProvider, objectRequest } from './private-storage.js';
import { analyzeResumeText } from './resume-analysis.js';

export const PDF_TYPE='application/pdf';
export const DOCX_TYPE='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const MAX_RESUME_BYTES=8*1024*1024;
const TYPE_BY_EXTENSION={'.pdf':PDF_TYPE,'.docx':DOCX_TYPE};
const UUID_PATTERN=/^[0-9a-f-]{36}$/i;
const PRESIGN_TTL_MS=5*60*1000;
const defaultStorage={put,get,del,issueSignedToken,presignUrl};

function sections(text){
  const pick=names=>{const re=new RegExp(`(?:^|\\b)(?:${names.join('|')})\\s*[:\\n-]\\s*([\\s\\S]{0,1100})`,'i');return text.match(re)?.[1]?.split(/\\b(?:education|experience|work history|projects?|skills|certifications?)\\b/i)[0]?.trim()||''};
  return {email:text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0]||'',phone:text.match(/(?:\+?\d[\d ()-]{7,}\d)/)?.[0]||'',education:pick(['education']),skills:pick(['technical skills','skills','technologies']),experience:pick(['experience','work history','employment']),projects:pick(['projects','selected projects']),certifications:pick(['certifications','certificates'])};
}
function parseAnalysis(value){try{return value?JSON.parse(value):null}catch{return null}}
export function resumeType(filename,buffer){
  const extension=path.extname(String(filename||'')).toLowerCase(),expected=TYPE_BY_EXTENSION[extension];
  if(!expected||!buffer?.length)return null;
  if(expected===PDF_TYPE)return buffer.subarray(0,5).toString()==='%PDF-'?PDF_TYPE:null;
  return buffer[0]===0x50&&buffer[1]===0x4b&&buffer.indexOf('[Content_Types].xml')!==-1?DOCX_TYPE:null;
}
async function extractText(buffer,mimeType,id){
  if(mimeType===DOCX_TYPE)return extractDocxText(buffer);
  let text=extractPdfText(buffer);
  if(!text&&process.env.PDFTOPPM_CMD&&process.env.TESSERACT_CMD){const temp=path.join(os.tmpdir(),`${id}.pdf`);try{await fs.writeFile(temp,buffer);text=await tryOcrPdf(temp)}finally{await fs.rm(temp,{force:true})}}
  return text;
}
async function saveObject(storage,key,buffer,mimeType){
  if(process.env.BLOB_READ_WRITE_TOKEN){const blob=await storage.put(key,buffer,{access:'private',addRandomSuffix:false,contentType:mimeType});return `blob:${blob.pathname}`;}
  if(storageProvider()==='s3'){const result=await objectRequest('PUT',key,buffer,mimeType);if(!result.ok)throw new Error('Private object storage rejected the resume upload.');return `s3:${key}`;}
  if(process.env.VERCEL||process.env.NODE_ENV==='production')throw Object.assign(new Error('Configure a private Vercel Blob store or S3-compatible storage before uploading resumes.'),{status:503});
  const dir=path.resolve(process.env.UPLOAD_DIR||'./server/uploads');await fs.mkdir(dir,{recursive:true});const local=path.join(dir,path.basename(key));await fs.writeFile(local,buffer,{flag:'wx'});return local;
}
async function readObject(storage,reference){
  if(reference.startsWith('blob:')){const result=await storage.get(reference.slice(5),{access:'private'});if(result?.statusCode!==200||!result.stream)throw new Error('Could not retrieve the private resume.');return Buffer.from(await new Response(result.stream).arrayBuffer());}
  if(reference.startsWith('s3:')){const result=await objectRequest('GET',reference.slice(3));if(!result.ok)throw new Error('Could not retrieve the private resume.');return Buffer.from(await result.arrayBuffer());}
  return fs.readFile(reference);
}
async function deleteObject(storage,reference){
  if(reference.startsWith('blob:'))return storage.del(reference.slice(5));
  if(reference.startsWith('s3:'))return objectRequest('DELETE',reference.slice(3));
  return fs.rm(reference,{force:true});
}
async function presignedBlobUrl(storage,key,download){
  const validUntil=Date.now()+PRESIGN_TTL_MS;
  const issued=await storage.issueSignedToken({pathname:key,operations:['get'],validUntil});
  const result=await storage.presignUrl(issued,{operation:'get',pathname:key,access:'private',validUntil,useCache:false});
  return download?getDownloadUrl(result.presignedUrl):result.presignedUrl;
}
function cleanFilename(value){return path.basename(String(value||'resume.pdf')).replace(/[\r\n]/g,'').slice(0,200)||'resume.pdf'}
async function storeResume({db,userId,id,filename,reference,buffer,mimeType}){
  const text=await extractText(buffer,mimeType,id);
  await db.prepare("INSERT INTO resumes(id,user_id,filename,path,extracted_text,analysis,mime_type,size_bytes) VALUES(?,?,?,?,?,'',?,?) ON CONFLICT(id) DO NOTHING").run(id,userId,filename,reference,text.slice(0,50000),mimeType,buffer.length);
  return text;
}
// Client uploads land in Blob first; this is the single place that validates the
// stored bytes and creates the owner-scoped row. Both the completion callback and
// the client's confirm call use it, so a missed callback cannot leave a hidden file
// and a database failure removes the orphaned blob.
async function finalizeBlobResume({storage,db,userId,id,filename}){
  const existing=await db.prepare('SELECT id FROM resumes WHERE id=? AND user_id=?').get(id,userId);
  if(existing)return {created:false};
  const extension=path.extname(filename).toLowerCase(),mimeType=TYPE_BY_EXTENSION[extension];
  if(!mimeType)throw Object.assign(new Error('Choose a PDF or Word (.docx) resume.'),{status:400});
  const key=`resumes/${userId}/${id}${extension}`,reference=`blob:${key}`;
  try{
    const object=await storage.get(key,{access:'private'});
    if(object?.statusCode!==200||!object.stream)throw Object.assign(new Error('The uploaded resume could not be found in private storage.'),{status:404});
    if(Number(object.blob?.size)>MAX_RESUME_BYTES)throw Object.assign(new Error('The uploaded resume exceeds the 8 MB limit.'),{status:400});
    const buffer=Buffer.from(await new Response(object.stream).arrayBuffer());
    if(!buffer.length||buffer.length>MAX_RESUME_BYTES)throw Object.assign(new Error('The uploaded resume is empty or exceeds the 8 MB limit.'),{status:400});
    if(!resumeType(filename,buffer))throw Object.assign(new Error(extension==='.docx'?'This file is not a valid Word (.docx) document.':'This file does not contain a valid PDF header.'),{status:400});
    await storeResume({db,userId,id,filename,reference,buffer,mimeType});
    return {created:true};
  }catch(error){
    let row=null;try{row=await db.prepare('SELECT id FROM resumes WHERE id=? AND user_id=?').get(id,userId)}catch{row=null}
    if(!row)await deleteObject(storage,reference).catch(()=>{});
    throw error;
  }
}
export function installResumeRoutes(app,{db,auth,storage=defaultStorage}){
  const clientUploads=Boolean(process.env.VERCEL&&process.env.BLOB_READ_WRITE_TOKEN);
  // Vercel functions accept at most ~4.5 MB per request, so the multipart fallback
  // stays under that. Direct browser uploads use the 8 MB Blob limit instead.
  const serverUploadLimit=process.env.VERCEL?4*1024*1024:MAX_RESUME_BYTES;
  const maximumSize=clientUploads?MAX_RESUME_BYTES:serverUploadLimit;
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:serverUploadLimit,files:1},fileFilter:(_req,file,cb)=>cb(null,Boolean(TYPE_BY_EXTENSION[path.extname(file.originalname).toLowerCase()]))});
  app.get('/api/resumes/upload-config',auth,(_req,res)=>{res.json({method:clientUploads?'blob-client':'server',maximum_size:maximumSize,maximum_size_mb:Math.round(maximumSize/1048576),accepted_types:[PDF_TYPE,DOCX_TYPE],accepted_extensions:['.pdf','.docx'],storage_configured:storageProvider()!=='none',storage_provider:storageProvider()})});
  const handleBlobUpload=async(req,res)=>{
    if(!process.env.BLOB_READ_WRITE_TOKEN)return res.status(503).json({error:'Private resume storage is not configured on the server.'});
    try{
      const result=await handleUpload({
        body:req.body,
        request:req,
        onBeforeGenerateToken:async(pathname,clientPayload)=>{
          if(!req.user?.id)throw Object.assign(new Error('Please sign in to upload a resume.'),{status:401});
          let payload;try{payload=JSON.parse(clientPayload||'')}catch{throw Object.assign(new Error('Resume upload metadata is invalid.'),{status:400})}
          const id=String(payload.resumeId||''),filename=cleanFilename(payload.filename),extension=path.extname(filename).toLowerCase();
          if(!UUID_PATTERN.test(id)||!TYPE_BY_EXTENSION[extension]||pathname!==`resumes/${req.user.id}/${id}${extension}`)throw Object.assign(new Error('Resume upload path is not allowed.'),{status:403});
          if(await db.prepare('SELECT id FROM resumes WHERE id=?').get(id))throw Object.assign(new Error('This resume has already been uploaded.'),{status:409});
          return {allowedContentTypes:[PDF_TYPE,DOCX_TYPE],maximumSizeInBytes:MAX_RESUME_BYTES,addRandomSuffix:false,tokenPayload:JSON.stringify({userId:req.user.id,resumeId:id,filename})};
        },
        onUploadCompleted:async({blob:uploaded,tokenPayload})=>{
          let payload;try{payload=JSON.parse(tokenPayload||'')}catch{throw new Error('Resume upload ownership metadata is invalid.')}
          const {userId,resumeId,filename}=payload,extension=path.extname(cleanFilename(filename)).toLowerCase(),mimeType=TYPE_BY_EXTENSION[extension];
          if(!userId||!mimeType||!UUID_PATTERN.test(String(resumeId||''))||uploaded.pathname!==`resumes/${userId}/${resumeId}${extension}`)throw new Error('Resume upload ownership could not be verified.');
          await finalizeBlobResume({storage,db,userId,id:resumeId,filename:cleanFilename(filename)});
        }
      });
      res.json(result);
    }catch(e){res.status(e.status||400).json({error:e.status?e.message:'Private resume upload could not be completed.'})}
  };
  app.post('/api/resumes/blob-upload',async(req,res,next)=>{if(req.body?.type==='blob.upload-completed')return handleBlobUpload(req,res);next()},auth,handleBlobUpload);
  app.post('/api/resumes/:id/confirm',auth,async(req,res)=>{
    const id=String(req.params.id||''),filename=cleanFilename(req.body?.filename),extension=path.extname(filename).toLowerCase();
    if(!UUID_PATTERN.test(id)||!TYPE_BY_EXTENSION[extension])return res.status(400).json({error:'Choose a PDF or Word (.docx) resume.'});
    if(!process.env.BLOB_READ_WRITE_TOKEN)return res.status(503).json({error:'Private resume storage is not configured on the server.'});
    try{
      const result=await finalizeBlobResume({storage,db,userId:req.user.id,id,filename});
      const row=await db.prepare('SELECT id,filename,mime_type,size_bytes,extracted_text,analysis FROM resumes WHERE id=? AND user_id=?').get(id,req.user.id);
      if(!row)throw Object.assign(new Error('The resume was uploaded but could not be saved.'),{status:502});
      const text=row.extracted_text||'';
      let analysis=parseAnalysis(row.analysis),analysisStatus=analysis?'ready':'unavailable',analysisError='';
      if(!analysis&&text&&process.env.OPENAI_API_KEY){
        try{analysis=await analyzeResumeText(text);await db.prepare('UPDATE resumes SET analysis=? WHERE id=? AND user_id=?').run(JSON.stringify(analysis),id,req.user.id);analysisStatus='ready'}
        catch{analysisStatus='failed';analysisError='The resume was saved, but AI analysis could not be completed. You can retry it from your resume library.'}
      }else if(text&&!analysis)analysisError='Resume saved and parsed. Add OPENAI_API_KEY on the server to enable AI analysis.';
      const message=text?(analysisStatus==='ready'?'Resume uploaded, analyzed and saved for personalized interviews.':analysisStatus==='failed'?'Resume uploaded and parsed; AI analysis failed and can be retried.':analysisError):(row.mime_type===PDF_TYPE&&process.env.PDFTOPPM_CMD?'No selectable text found; OCR returned no text.':row.mime_type===PDF_TYPE?'Resume uploaded. This PDF appears scanned; configure PDFTOPPM_CMD and TESSERACT_CMD to enable OCR.':'Resume uploaded, but no readable text was found in this Word document.');
      res.status(result.created?201:200).json({resume:{id:row.id,filename:row.filename,mime_type:row.mime_type,size_bytes:Number(row.size_bytes)||0,extracted_text:Boolean(text),sections:sections(text),analysis,analysis_status:analysisStatus},message,analysis_error:analysisError||undefined});
    }catch(e){res.status(e.status||502).json({error:e.message||'The resume was uploaded but could not be saved.'})}
  });
  app.get('/api/resumes',auth,async(req,res)=>{try{const rows=await db.prepare('SELECT id,filename,mime_type,size_bytes,created_at,extracted_text,analysis FROM resumes WHERE user_id=? ORDER BY created_at DESC').all(req.user.id);res.json({resumes:rows.map(({extracted_text,analysis,...resume})=>({...resume,mime_type:resume.mime_type||PDF_TYPE,size_bytes:Number(resume.size_bytes)||0,analyzed:Boolean(extracted_text),sections:sections(extracted_text||''),analysis:parseAnalysis(analysis),ai_analyzed:Boolean(parseAnalysis(analysis))}))})}catch(e){res.status(500).json({error:'Could not load resumes.'})}});
  app.post('/api/resumes',auth,upload.single('resume'),async(req,res)=>{
    if(!req.file)return res.status(400).json({error:`Choose a PDF or Word (.docx) resume (up to ${Math.round(maximumSize/1048576)} MB).`});
    const filename=cleanFilename(req.file.originalname),mimeType=resumeType(filename,req.file.buffer);
    if(!mimeType)return res.status(400).json({error:path.extname(filename).toLowerCase()==='.docx'?'This file is not a valid Word (.docx) document.':'This file does not contain a valid PDF header.'});
    const id=crypto.randomUUID(),extension=path.extname(filename).toLowerCase(),key=`resumes/${req.user.id}/${id}${extension}`;let reference;
    try{reference=await saveObject(storage,key,req.file.buffer,mimeType)}catch(e){res.status(e.status||502).json({error:e.message||'Could not store the resume privately.'});return}
    let text;
    try{text=await storeResume({db,userId:req.user.id,id,filename,reference,buffer:req.file.buffer,mimeType})}
    catch(e){await deleteObject(storage,reference).catch(()=>{});res.status(502).json({error:'The resume was uploaded but could not be parsed and saved.'});return}
    let analysis=null,analysisStatus='unavailable',analysisError='';
    if(text&&process.env.OPENAI_API_KEY){try{analysis=await analyzeResumeText(text);await db.prepare('UPDATE resumes SET analysis=? WHERE id=? AND user_id=?').run(JSON.stringify(analysis),id,req.user.id);analysisStatus='ready'}catch(e){analysisStatus='failed';analysisError=e.status===503?'AI resume analysis needs OPENAI_API_KEY configured on the server.':'The resume was saved, but AI analysis could not be completed. You can retry it from your resume library.'}}
    else if(text)analysisError='Resume saved and parsed. Add OPENAI_API_KEY on the server to enable AI analysis.';
    const message=text?(analysisStatus==='ready'?'Resume uploaded, analyzed and saved for personalized interviews.':analysisStatus==='failed'?'Resume uploaded and parsed; AI analysis failed and can be retried.':analysisError):(mimeType===PDF_TYPE&&process.env.PDFTOPPM_CMD?'No selectable text found; OCR returned no text.':mimeType===PDF_TYPE?'Resume uploaded. This PDF appears scanned; configure PDFTOPPM_CMD and TESSERACT_CMD to enable OCR.':'Resume uploaded, but no readable text was found in this Word document.');
    res.status(201).json({resume:{id,filename,mime_type:mimeType,size_bytes:req.file.size,extracted_text:!!text,sections:sections(text),analysis,analysis_status:analysisStatus},message,analysis_error:analysisError||undefined});
  });
  app.post('/api/resumes/:id/analyze',auth,async(req,res)=>{const item=await db.prepare('SELECT extracted_text FROM resumes WHERE id=? AND user_id=?').get(req.params.id,req.user.id);if(!item)return res.status(404).json({error:'Resume not found.'});try{const analysis=await analyzeResumeText(item.extracted_text);await db.prepare('UPDATE resumes SET analysis=? WHERE id=? AND user_id=?').run(JSON.stringify(analysis),req.params.id,req.user.id);res.json({analysis,analysis_status:'ready'})}catch(e){res.status(e.status||502).json({error:e.status===503?e.message:e.status===422?e.message:'AI resume analysis failed. Please retry shortly.'})}});
  app.get('/api/resumes/:id/file',auth,async(req,res)=>{
    try{
      const item=await db.prepare('SELECT * FROM resumes WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
      if(!item)return res.status(404).json({error:'Resume not found.'});
      if(item.path.startsWith('blob:')){
        if(!process.env.BLOB_READ_WRITE_TOKEN)return res.status(503).json({error:'Private resume storage is not configured on the server.'});
        let url;try{url=await presignedBlobUrl(storage,item.path.slice(5),req.query.download==='1')}catch{return res.status(502).json({error:'Could not create a secure download link.'})}
        res.setHeader('Cache-Control','private, no-store');
        return res.redirect(302,url);
      }
      const bytes=await readObject(storage,item.path),mimeType=item.mime_type===DOCX_TYPE?DOCX_TYPE:PDF_TYPE;
      res.setHeader('Content-Type',mimeType);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Disposition',`${mimeType===PDF_TYPE?'inline':'attachment'}; filename="${item.filename.replace(/["\\]/g,'')}"`);res.send(bytes);
    }catch{res.status(502).json({error:'Could not retrieve the private resume.'})}
  });
  app.delete('/api/resumes/:id',auth,async(req,res)=>{try{const item=await db.prepare('SELECT * FROM resumes WHERE id=? AND user_id=?').get(req.params.id,req.user.id);if(!item)return res.status(404).json({error:'Resume not found.'});await deleteObject(storage,item.path);await db.prepare('DELETE FROM resumes WHERE id=? AND user_id=?').run(item.id,req.user.id);res.json({ok:true})}catch{res.status(502).json({error:'Could not delete the private resume.'})}});
}
