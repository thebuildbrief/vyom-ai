import crypto from 'node:crypto';

const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const hmac=(key,value,encoding)=>crypto.createHmac('sha256',key).update(value).digest(encoding);
const encodePath=s=>s.split('/').map(encodeURIComponent).join('/');
export function hasObjectStorage(){return !!(process.env.S3_BUCKET&&process.env.S3_ACCESS_KEY_ID&&process.env.S3_SECRET_ACCESS_KEY)}
export function hasResumeStorage(){return Boolean(process.env.BLOB_READ_WRITE_TOKEN)||hasObjectStorage()}
export function storageProvider(){if(process.env.BLOB_READ_WRITE_TOKEN)return 'blob';if(hasObjectStorage())return 's3';return process.env.VERCEL||process.env.NODE_ENV==='production'?'none':'local'}
export async function objectRequest(method,key,body,contentType='application/octet-stream'){
  const endpoint=new URL(process.env.S3_ENDPOINT||`https://s3.${process.env.S3_REGION||'us-east-1'}.amazonaws.com`),bucket=process.env.S3_BUCKET,region=process.env.S3_REGION||'us-east-1',pathStyle=process.env.S3_PATH_STYLE==='true';
  const host=pathStyle?endpoint.host:`${bucket}.${endpoint.host}`,uri=`${endpoint.pathname.replace(/\/$/,'')}${pathStyle?`/${bucket}`:''}/${encodePath(key)}`.replace(/^\/\//,'/'),url=`${endpoint.protocol}//${host}${uri}`;
  const date=new Date().toISOString().replace(/[:-]|\.\d{3}/g,''),short=date.slice(0,8),payload=body?hash(body):hash(''),headers={'host':host,'x-amz-content-sha256':payload,'x-amz-date':date};
  if(body)headers['content-type']=contentType;if(process.env.S3_SESSION_TOKEN)headers['x-amz-security-token']=process.env.S3_SESSION_TOKEN;
  const signed=Object.keys(headers).sort().join(';'),canonical=Object.keys(headers).sort().map(k=>`${k}:${headers[k].trim()}\n`).join(''),request=[method,uri,'',canonical,signed,payload].join('\n'),scope=`${short}/${region}/s3/aws4_request`,toSign=['AWS4-HMAC-SHA256',date,scope,hash(request)].join('\n'),kDate=hmac(`AWS4${process.env.S3_SECRET_ACCESS_KEY}`,short),kRegion=hmac(kDate,region),kService=hmac(kRegion,'s3'),kSigning=hmac(kService,'aws4_request'),signature=hmac(kSigning,toSign,'hex');
  headers.Authorization=`AWS4-HMAC-SHA256 Credential=${process.env.S3_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
  return fetch(url,{method,headers,body:body||undefined});
}
