import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { upload as uploadToBlob } from '@vercel/blob/client';
import { formatDateTime } from './dates.js';
import DashboardShell from './DashboardShell.jsx';

const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const ACCEPT = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1048576) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1048576).toFixed(1)} MB`;
}

function isDocx(item) {
  return item?.mime_type === DOCX_MIME || /\.docx$/i.test(item?.filename || '');
}

function List({ items, empty }) {
  return Array.isArray(items) && items.length ? <ul>{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p>{empty}</p>;
}

function ResumeAnalysisPanel({ analysis }) {
  if (!analysis) return null;
  return <div className="resume-ai-analysis">
    <span className="eyebrow">AI REVIEW · GROUNDED IN YOUR RESUME</span>
    <p>{analysis.summary}</p>
    <div className="resume-analysis-grid">
      <div><b>Skills identified</b><List items={analysis.skills} empty="No skills explicitly identified."/></div>
      <div><b>Experience</b><List items={analysis.experience} empty="No experience details explicitly identified."/></div>
      <div><b>Projects</b><List items={analysis.projects} empty="No projects explicitly identified."/></div>
      <div><b>Education</b><List items={analysis.education} empty="No education details explicitly identified."/></div>
      <div><b>Strengths</b><List items={analysis.strengths} empty="No strengths inferred without evidence."/></div>
      <div><b>Questions to explore</b><List items={analysis.follow_up_questions} empty="No follow-up questions available."/></div>
    </div>
  </div>;
}

function uploadWithProgress(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${apiBase}/api/resumes`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* Keep the friendly fallback below. */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else if (xhr.status === 413) reject(Error('This file is too large for the current upload path. Choose a smaller PDF or Word document.'));
      else reject(Error(data.error || 'The resume could not be uploaded.'));
    };
    xhr.onerror = () => reject(Error('The upload failed. Check your connection and try again.'));
    xhr.onabort = () => reject(Error('The upload was cancelled.'));
    const form = new FormData();
    form.append('resume', file);
    xhr.send(form);
  });
}

async function uploadDirectToBlob(file, userId, onProgress) {
  const extension = file.name.toLowerCase().endsWith('.docx') ? '.docx' : '.pdf';
  const resumeId = window.crypto.randomUUID();
  await uploadToBlob(`resumes/${userId}/${resumeId}${extension}`, file, {
    access: 'private',
    handleUploadUrl: `${apiBase}/api/resumes/blob-upload`,
    clientPayload: JSON.stringify({ resumeId, filename: file.name }),
    contentType: extension === '.docx' ? DOCX_MIME : 'application/pdf',
    onUploadProgress: event => onProgress(Math.min(99, Math.max(1, Math.round(event.percentage || 0))))
  });
  const response = await fetch(`${apiBase}/api/resumes/${resumeId}/confirm`, {
    method: 'POST', credentials: 'include', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || 'The resume was uploaded but could not be saved. Please try again.');
  return data;
}

export default function ResumePage({ api, user }) {
  const [items, setItems] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [analysisBusy, setAnalysisBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const reload = useCallback(async () => {
    try { setItems((await api('/resumes')).resumes || []); }
    catch (value) { setError(value.message); }
  }, [api]);

  useEffect(() => {
    let alive = true;
    Promise.all([api('/resumes'), api('/resumes/upload-config')])
      .then(([list, uploadConfig]) => { if (!alive) return; setItems(list.resumes || []); setConfig(uploadConfig); })
      .catch(value => { if (alive) setError(value.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [api]);

  async function upload(file) {
    if (!file || uploading) return;
    setError('');
    setNotice('');
    setParsed(null);
    if (!/\.(pdf|docx)$/i.test(file.name)) { setError('Choose a PDF or Word (.docx) file.'); return; }
    const maximum = config?.maximum_size || 8 * 1024 * 1024;
    if (file.size > maximum) { setError(`${file.name} is ${formatBytes(file.size)}. The limit is ${Math.round(maximum / 1048576)} MB.`); return; }
    if (config && !config.storage_configured) { setError('Private resume storage is not configured on the server yet. Uploads are unavailable.'); return; }
    const direct = config?.method === 'blob-client';
    if (direct && !user?.id) { setError('Please sign in again to upload a resume.'); return; }
    setUploading(true);
    setProgress(0);
    try {
      const data = direct ? await uploadDirectToBlob(file, user.id, setProgress) : await uploadWithProgress(file, setProgress);
      setProgress(100);
      setNotice(data.analysis_error || data.message || 'Resume uploaded.');
      setParsed({ id: data.resume.id, filename: data.resume.filename, mime_type: data.resume.mime_type, size_bytes: data.resume.size_bytes, extracted: Boolean(data.resume.extracted_text), sections: data.resume.sections || {}, analysis: data.resume.analysis, analysisStatus: data.resume.analysis_status });
      await reload();
    } catch (value) { setError(value.message); }
    finally { setUploading(false); setProgress(0); if (inputRef.current) inputRef.current.value = ''; }
  }

  function onDrop(event) {
    event.preventDefault();
    setDragging(false);
    upload(event.dataTransfer.files?.[0]);
  }

  async function analyze(id) {
    setAnalysisBusy(id);
    setError('');
    setNotice('');
    try {
      const data = await api(`/resumes/${id}/analyze`, { method: 'POST', body: JSON.stringify({}) });
      setItems(previous => previous.map(item => item.id === id ? { ...item, analysis: data.analysis, ai_analyzed: true } : item));
      setParsed(previous => previous?.id === id ? { ...previous, analysis: data.analysis, analysisStatus: 'ready' } : previous);
      setNotice('AI resume analysis saved.');
    } catch (value) { setError(value.message); }
    finally { setAnalysisBusy(''); }
  }

  async function download(item) {
    setError('');
    if (config?.storage_provider === 'blob') {
      const anchor = document.createElement('a');
      anchor.href = `${apiBase}/api/resumes/${item.id}/file?download=1`;
      anchor.download = item.filename;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      return;
    }
    try {
      const response = await fetch(`${apiBase}/api/resumes/${item.id}/file`, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw Error('The resume could not be downloaded.');
      const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = item.filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (value) { setError(value.message); }
  }

  async function remove(item) {
    if (!window.confirm(`Delete “${item.filename}” permanently?`)) return;
    setError('');
    try { await api(`/resumes/${item.id}`, { method: 'DELETE' }); setParsed(previous => previous?.id === item.id ? null : previous); setNotice('Resume deleted.'); await reload(); }
    catch (value) { setError(value.message); }
  }

  function showAnalysis(item) {
    setParsed({ id: item.id, filename: item.filename, mime_type: item.mime_type, size_bytes: item.size_bytes, extracted: true, sections: item.sections || {}, analysis: item.analysis, analysisStatus: item.ai_analyzed ? 'ready' : 'unavailable' });
  }

  const limitMb = config ? Math.round(config.maximum_size / 1048576) : 8;
  return <DashboardShell user={user}>
    <div className="dash wrap resume-page">
      <span className="eyebrow">YOUR STORY</span>
      <h1>Resume library.</h1>
      <p>Upload a PDF or Word (.docx) resume. Files stay private to your account, are validated on the server, and power resume-based interview questions.</p>

      <div className="resume-layout">
        <section className="dash-panel resume-upload-panel">
          <div
            className={`resume-drop ${dragging ? 'is-dragging' : ''} ${uploading ? 'is-busy' : ''}`}
            role="button" tabIndex={0} aria-label="Upload a resume"
            onClick={() => !uploading && inputRef.current?.click()}
            onKeyDown={event => { if (!uploading && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); inputRef.current?.click(); } }}
            onDragOver={event => { event.preventDefault(); if (!uploading) setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <span className="resume-drop-icon" aria-hidden="true">⇪</span>
            <b>{uploading ? `Uploading… ${progress}%` : dragging ? 'Drop your resume here' : 'Drop a resume, or choose a file'}</b>
            <small>PDF or Word (.docx) · up to {limitMb} MB · validated on the server</small>
            {uploading && <div className="resume-progress" role="progressbar" aria-valuenow={progress} aria-valuemin="0" aria-valuemax="100"><i style={{ width: `${progress}%` }}/></div>}
            <input ref={inputRef} type="file" accept={ACCEPT} disabled={uploading} onChange={event => upload(event.target.files?.[0])} hidden/>
          </div>
          {config && !config.storage_configured && <p className="form-error" role="alert">Private storage is not configured on the server, so uploads are disabled in this environment.</p>}
          {notice && <p className="resume-notice" role="status">{notice}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <p className="resume-privacy">Resume files are stored privately and are never exposed publicly. Uploads go directly to private storage, the server validates every file, and previews and downloads require your signed-in account.</p>
        </section>

        <section className="dash-panel resume-library">
          <div className="panel-heading"><div><span className="eyebrow">SAVED DOCUMENTS</span><h2>Your library</h2></div><span className="resume-count">{items.length} file{items.length === 1 ? '' : 's'}</span></div>
          {loading ? <p role="status">Loading your resumes…</p> : items.length ? items.map(item => <article className="resume-row" key={item.id}>
            <span className={`resume-file-icon ${isDocx(item) ? 'docx' : 'pdf'}`} aria-hidden="true">{isDocx(item) ? 'W' : 'PDF'}</span>
            <div className="resume-row-copy">
              <b>{item.filename}</b>
              <small>{isDocx(item) ? 'Word document' : 'PDF'} · {formatBytes(item.size_bytes)} · {formatDateTime(item.created_at)}</small>
              <div className="resume-chips">
                <span className={item.analyzed ? 'ok' : ''}>{item.analyzed ? 'Text extracted' : 'No text extracted'}</span>
                <span className={item.ai_analyzed ? 'ok' : ''}>{item.ai_analyzed ? 'AI analyzed' : 'No AI analysis'}</span>
              </div>
            </div>
            <div className="resume-row-actions">
              {(item.ai_analyzed || item.analysis) && <button type="button" onClick={() => showAnalysis(item)}>View analysis</button>}
              {item.analyzed && !item.ai_analyzed && <button type="button" disabled={analysisBusy === item.id} onClick={() => analyze(item.id)}>{analysisBusy === item.id ? 'Analyzing…' : 'Analyze with AI'}</button>}
              <button type="button" onClick={() => window.open(`${apiBase}/api/resumes/${item.id}/file`, '_blank', 'noopener')}>Preview</button>
              <button type="button" onClick={() => download(item)}>Download</button>
              <button type="button" className="danger" onClick={() => remove(item)}>Delete</button>
            </div>
          </article>) : <div className="empty-state"><span>▤</span><h3>No resumes yet.</h3><p>Upload a PDF or Word resume to extract skills and projects for personalized interviews.</p></div>}
        </section>
      </div>

      {parsed && <section className="resume-analysis" aria-live="polite">
        <span className="eyebrow">RESUME ANALYSIS</span>
        <h2>{parsed.filename}</h2>
        <p>{parsed.extracted ? 'Text extracted successfully. These details can inform resume-based interview questions.' : 'The file was stored, but no selectable text was extracted.'}</p>
        <div className="resume-analysis-grid">
          <div><b>Skills from resume</b><p>{parsed.sections.skills || 'No skills section detected in the source text.'}</p></div>
          <div><b>Projects from resume</b><p>{parsed.sections.projects || 'No projects section detected in the source text.'}</p></div>
          <div><b>Experience from resume</b><p>{parsed.sections.experience || 'No experience section detected in the source text.'}</p></div>
          <div><b>Education from resume</b><p>{parsed.sections.education || 'No education section detected in the source text.'}</p></div>
        </div>
        {parsed.analysis
          ? <ResumeAnalysisPanel analysis={parsed.analysis}/>
          : <p className="ai-analysis-state">{parsed.analysisStatus === 'failed' ? 'AI analysis failed. Retry from the resume list.' : parsed.extracted ? 'AI analysis is unavailable until OPENAI_API_KEY is configured.' : 'AI analysis requires extractable resume text.'}</p>}
        {parsed.extracted && <Link className="button small" to="/interview/setup" state={{ resumeId: parsed.id }}>Use this resume in an interview ↗</Link>}
      </section>}

      <div className="account-links"><Link to="/interview/setup">Start an interview ↗</Link><Link to="/dashboard">Back to overview ↗</Link></div>
    </div>
  </DashboardShell>;
}
