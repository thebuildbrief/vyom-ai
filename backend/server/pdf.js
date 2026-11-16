import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import * as mammoth from 'mammoth';

function decodeLiteral(value) {
  return value.replace(/\\([0-7]{1,3})|\\(n|r|t|b|f|\(|\)|\\)|\\\r?\n/g, (_, octal, escape) => {
    if (octal) return String.fromCharCode(parseInt(octal, 8));
    return ({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f','(':'(',')':')','\\':'\\'})[escape] ?? '';
  });
}
function decodeHex(value) {
  const bytes = Buffer.from(value.replace(/\s/g, '').replace(/>$/, '').padEnd(Math.ceil(value.length / 2) * 2, '0'), 'hex');
  if (bytes[0] === 0xfe && bytes[1] === 0xff) { const le=Buffer.alloc(bytes.length-2);for(let i=2;i+1<bytes.length;i+=2){le[i-2]=bytes[i+1];le[i-1]=bytes[i]}return le.toString('utf16le'); }
  return bytes.toString('latin1');
}
function readTextOperators(source) {
  const out = [];
  const literal = String.raw`\(((?:\\.|[^\\)])*)\)`;
  const hex = String.raw`<([0-9A-Fa-f\s]+)>`;
  const token = new RegExp(`(?:${literal}|${hex})`, 'g');
  for (const match of source.matchAll(new RegExp(`(?:${literal}|${hex})\\s*Tj`, 'g'))) {
    const part = match[1] !== undefined ? decodeLiteral(match[1]) : decodeHex(match[2]);
    if (part) out.push(part);
  }
  for (const match of source.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
    const parts = [...match[1].matchAll(token)].map(x => x[1] !== undefined ? decodeLiteral(x[1]) : decodeHex(x[2]));
    if (parts.length) out.push(parts.join(''));
  }
  return out;
}

export function extractPdfText(buffer) {
  const raw = buffer.toString('latin1'), chunks = [];
  const streamPattern = /<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (const match of raw.matchAll(streamPattern)) {
    let stream = Buffer.from(match[2], 'latin1');
    if (/\/FlateDecode/.test(match[1])) {
      try { stream = zlib.inflateSync(stream); } catch { try { stream = zlib.inflateRawSync(stream); } catch { continue; } }
    }
    const data = stream.toString('latin1');
    chunks.push(...readTextOperators(data));
  }
  return chunks.join(' ').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function extractDocxText(buffer) {
  try {
    const { value } = await mammoth.extractRawText({ buffer });
    return String(value || '').replace(/\s+/g, ' ').trim();
  } catch { return ''; }
}

export async function tryOcrPdf(filePath) {
  const rasterizer = process.env.PDFTOPPM_CMD, ocr = process.env.TESSERACT_CMD;
  if (!rasterizer || !ocr) return '';
  const { mkdtemp, readdir, readFile, rm } = await import('node:fs/promises');
  const os = await import('node:os');
  const dir = await mkdtemp(`${os.tmpdir()}/vyom-ocr-`);
  const prefix = `${dir}/page`;
  const run = (cmd, args) => new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, stdio: ['ignore','pipe','pipe'] }); let err='',out='';
    p.stdout.on('data', b => { out += b.toString(); });p.stderr.on('data', b => { err += b.toString(); }); p.on('error', reject); p.on('close', code => code===0 ? resolve(out) : reject(new Error(err || `${cmd} failed`)));
  });
  try {
    await run(rasterizer, ['-f','1','-l','8','-r','160','-png',filePath,prefix]);
    const pages=(await readdir(dir)).filter(x=>x.endsWith('.png')).sort().slice(0,8), texts=[];
    for (const page of pages) { const image=`${dir}/${page}`; texts.push(await run(ocr,[image,'stdout','-l',process.env.TESSERACT_LANG||'eng'])); }
    return texts.join(' ').trim();
  } catch { return ''; } finally { await rm(dir,{recursive:true,force:true}); }
}
