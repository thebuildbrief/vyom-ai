import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

const starters = {
  Python: `nums = [2, 7, 11, 15]\ntarget = 9\nseen = {}\nfor index, value in enumerate(nums):\n    complement = target - value\n    if complement in seen:\n        print(seen[complement], index)\n        break\n    seen[value] = index\n`,
  JavaScript: `const nums = [2, 7, 11, 15];\nconst target = 9;\nconst seen = new Map();\nfor (let i = 0; i < nums.length; i++) {\n  const complement = target - nums[i];\n  if (seen.has(complement)) { console.log(seen.get(complement), i); break; }\n  seen.set(nums[i], i);\n}\n`,
  Java: `import java.util.*;\npublic class Main {\n  public static void main(String[] args) {\n    int[] nums = {2, 7, 11, 15}; int target = 9;\n    Map<Integer, Integer> seen = new HashMap<>();\n    for (int i = 0; i < nums.length; i++) {\n      int need = target - nums[i];\n      if (seen.containsKey(need)) { System.out.println(seen.get(need) + " " + i); break; }\n      seen.put(nums[i], i);\n    }\n  }\n}\n`,
  'C++': `#include <iostream>\n#include <unordered_map>\n#include <vector>\nusing namespace std;\nint main() {\n  vector<int> nums{2, 7, 11, 15}; int target = 9;\n  unordered_map<int, int> seen;\n  for (int i = 0; i < (int)nums.size(); ++i) {\n    int need = target - nums[i];\n    if (seen.count(need)) { cout << seen[need] << " " << i << "\\n"; break; }\n    seen[nums[i]] = i;\n  }\n}\n`
};

export function CodePlayground({ user, request }) {
  const [language, setLanguage] = useState('Python');
  const [source, setSource] = useState(starters.Python);
  const [sessionId, setSessionId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function run() {
    setResult(null);
    setError('');
    if (!user) { setError('Sign in to run code with JDoodle and save your execution.'); return; }
    setBusy(true);
    try {
      let id = sessionId;
      if (!id) {
        const created = await request('/interviews', { method: 'POST', body: JSON.stringify({
          type: 'DSA', role: 'Software Engineer', difficulty: 'Easy', duration: 20,
          interviewer: 'Samarth', language, topics: 'Code Practice playground'
        }) });
        id = created.interview.id;
        setSessionId(id);
      }
      const execution = await request(`/interviews/${id}/code`, {
        method: 'POST', body: JSON.stringify({ language, source, input: '', test_cases: [{ input: '', expected_output: null }] })
      });
      setResult(execution.test_results?.[0] || null);
      if (!execution.test_results?.length) setError('The execution service returned no result. Please try again.');
    } catch (e) { setError(e.message || 'Code execution failed.'); }
    finally { setBusy(false); }
  }

  return <article className="feature-card feature-wide interactive-feature code-feature">
    <div className="feature-text"><span className="feature-icon">⌨</span><h3>Think out loud.<br/>Code it through.</h3><p>Edit this Two Sum example and run it with JDoodle. Your first run creates a Code Practice session so the real output is saved to your account.</p><span className="feature-tag">PYTHON · JAVASCRIPT · JAVA · C++</span></div>
    <section className="code-preview code-playground" aria-label="Interactive code playground">
      <div className="playground-toolbar"><label htmlFor="home-code-language">Language</label><select id="home-code-language" value={language} onChange={e => { setLanguage(e.target.value); setSource(starters[e.target.value]); setResult(null); setError(''); }}><option>Python</option><option>JavaScript</option><option>Java</option><option>C++</option></select><span>JDoodle</span></div>
      <label className="sr-only" htmlFor="home-code-source">Edit sample code</label><textarea id="home-code-source" className="playground-editor" spellCheck="false" value={source} onChange={e => setSource(e.target.value)} aria-label="Sample code" />
      <div className="playground-actions"><span>{sessionId ? 'Saved to your practice history' : 'Real output · saved to your account'}</span>{sessionId&&<Link className="playground-session-link" to={`/interview/${sessionId}`}>Open session ↗</Link>}<button className="button small" type="button" onClick={run} disabled={busy}>{busy ? 'Running…' : '▶ Run code'}</button></div>
      <div className={`playground-output ${error ? 'has-error' : result ? 'has-result' : ''}`} role="status" aria-live="polite">
        {busy ? 'Sending code to JDoodle…' : error ? error : result ? <><span>Execution complete · JDoodle</span><pre>{result.actual || '(Program completed with no output)'}</pre></> : 'Run the sample to see actual execution output.'}
      </div>
    </section>
  </article>;
}

export function VoiceDemo() {
  const [status, setStatus] = useState('Ready');
  const [levels, setLevels] = useState(Array(28).fill(8));
  const [transcript, setTranscript] = useState('');
  const [notice, setNotice] = useState('No interviewer audio is played in this demo.');
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const recognitionRef = useRef(null);
  const frameRef = useRef(0);
  const stoppedRef = useRef(true);
  const readyTimerRef = useRef(0);

  function stop() {
    stoppedRef.current = true;
    cancelAnimationFrame(frameRef.current);
    window.clearTimeout(readyTimerRef.current);
    try { recognitionRef.current?.stop(); } catch { /* It may already have stopped. */ }
    recognitionRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    setLevels(Array(28).fill(8));
    setStatus('Ready');
  }

  useEffect(() => () => {
    stoppedRef.current = true;
    cancelAnimationFrame(frameRef.current);
    window.clearTimeout(readyTimerRef.current);
    try { recognitionRef.current?.stop(); } catch { /* Ignore cleanup after the browser has stopped recognition. */ }
    streamRef.current?.getTracks().forEach(track => track.stop());
    audioContextRef.current?.close().catch(() => {});
  }, []);

  async function start() {
    setTranscript('');
    setNotice('No interviewer audio is played in this demo.');
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('Ready');
      setNotice('Microphone input requires a supported browser on HTTPS or localhost.');
      return;
    }
    stoppedRef.current = false;
    setStatus('Processing');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (stoppedRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        const context = new AudioContextClass();
        audioContextRef.current = context;
        await context.resume();
        const analyser = context.createAnalyser();
        analyser.fftSize = 64;
        context.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        let lastPaint = 0;
        const draw = time => {
          if (stoppedRef.current) return;
          frameRef.current = requestAnimationFrame(draw);
          if (time - lastPaint < 90) return;
          lastPaint = time;
          analyser.getByteFrequencyData(data);
          setLevels(Array.from({ length: 28 }, (_, i) => Math.max(5, Math.min(38, 5 + (data[i % data.length] / 255) * 34))));
        };
        frameRef.current = requestAnimationFrame(draw);
      } else setNotice('Microphone is active. This browser does not support a live waveform.');

      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognitionRef.current = recognition;
        recognition.lang = 'en-US';
        recognition.interimResults = true;
        recognition.continuous = true;
        recognition.onresult = event => {
          const text = Array.from(event.results).map(item => item[0].transcript).join('').trim();
          if (text) setTranscript(text);
          if (event.results[event.results.length - 1]?.isFinal) {
            setStatus('Processing');
            readyTimerRef.current = window.setTimeout(() => { if (!stoppedRef.current) setStatus('Listening'); }, 1000);
          }
        };
        recognition.onerror = event => {
          if (event.error !== 'no-speech' && event.error !== 'aborted') setNotice(`Speech recognition: ${event.error}. The live waveform can still be used.`);
        };
        recognition.onend = () => {
          if (!stoppedRef.current) {
            setStatus('Processing');
            readyTimerRef.current = window.setTimeout(() => { if (!stoppedRef.current && !streamRef.current?.active) setStatus('Ready'); else if (!stoppedRef.current) setStatus('Listening'); }, 1000);
          }
        };
        recognition.start();
        setNotice('Live microphone waveform and browser speech recognition are active.');
      } else setNotice('Live microphone waveform is active. Browser speech-to-text needs Chrome or Edge on desktop.');
      setStatus('Listening');
    } catch (e) {
      stoppedRef.current = true;
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      audioContextRef.current?.close().catch(() => {});
      audioContextRef.current = null;
      cancelAnimationFrame(frameRef.current);
      setLevels(Array(28).fill(8));
      setStatus('Ready');
      setNotice(e.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow microphone access in your browser to try again.' : e.message || 'Microphone could not be started.');
    }
  }

  return <article className="feature-card feature-voice interactive-feature">
    <div className="voice-top"><span className="feature-icon">◖</span><span className="voice-live"><i/> {status.toUpperCase()}</span></div>
    <h3>It feels like<br/>a conversation.</h3><p>Try the microphone waveform and speech-to-text in your browser. This demo never fabricates interviewer audio.</p>
    <div className="voice-bars" aria-hidden="true">{levels.map((height, i) => <i key={i} style={{ height: `${height}px` }} />)}</div>
    <div className="voice-demo-controls"><button className="button small" type="button" onClick={status === 'Ready' ? start : stop}>{status === 'Ready' ? 'Start Demo' : 'Stop Demo'}</button><span className="voice-demo-status" role="status">{status}</span></div>
    <p className="voice-demo-note">{notice}</p>
    {transcript && <p className="voice-demo-transcript"><b>Your transcript</b><br/>{transcript}</p>}
  </article>;
}

export function ResumeCard({ user }) {
  return <Link className="feature-card feature-resume feature-link" to={user ? '/dashboard/resume' : '/login'} aria-label={user ? 'Open your resume library' : 'Sign in to use resume intelligence'}>
    <span className="feature-icon">▤</span><h3>Your story,<br/>in the room.</h3><p>Upload a PDF, review the text we extract, and bring your resume into personalized interview questions.</p>
    <div className="resume-sheets" aria-hidden="true"><div><b>YOUR EXPERIENCE</b><i/><i/><i/><i/><span>✦ project deep dive</span></div><div><b>SKILLS & PROJECTS</b><i/><i/><i/><span>✦ personalized prompts</span></div></div>
    <span className="feature-card-link">{user ? 'Open resume library ↗' : 'Sign in to get started ↗'}</span>
  </Link>;
}

export function ProgressCard({ user, request }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!user) return;
    let active = true;
    request('/analytics').then(value => { if (active) setData(value); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [user, request]);

  const keys = [['communication', 'Communication'], ['problem_solving', 'Problem solving'], ['technical_knowledge', 'Technical knowledge']];
  const metrics = data?.categories ? keys.filter(([key]) => Number.isFinite(Number(data.categories[key]))).map(([key, label]) => ({ label, value: Number(data.categories[key]) })) : [];
  const sessions = (data?.history || []).filter(item => Number.isFinite(Number(item.overall_score))).slice(-4);
  const delta = sessions.length > 1 ? Number(sessions.at(-1).overall_score) - Number(sessions.at(-2).overall_score) : null;

  return <Link className="feature-card feature-growth feature-link" to={user ? '/dashboard/analytics' : '/login'} aria-label={user ? 'Open your performance analytics' : 'Sign in to view performance analytics'}>
    <span className="feature-icon">↗</span><h3>Notice how<br/>far you’ve come.</h3><p>Your actual session feedback, with clear next steps drawn from your reports.</p>
    {!user ? <div className="growth-empty">Sign in to view your personal interview metrics.</div> : error ? <div className="growth-empty">{error}</div> : !data ? <div className="growth-empty">Loading your session results…</div> : !data.total ? <div className="growth-empty">Complete your first interview to see your communication, problem-solving, and technical results here.</div> : <div className="growth-chart">
      {metrics.map(metric => <div key={metric.label}><span>{metric.label} · {metric.value}%</span><i style={{ width: `${Math.max(0, Math.min(100, metric.value))}%` }} /></div>)}
      {sessions.length > 0 && <div className="growth-session-list"><b>Recent interview scores</b><div className="growth-session-bars">{sessions.map(item => <span key={item.id} title={`${item.role}: ${item.overall_score}/100`} aria-label={`${item.role}: ${item.overall_score} out of 100`}><i style={{ height: `${Math.max(4, Math.min(100, Number(item.overall_score)))}%` }} /><small>{item.overall_score}</small></span>)}</div></div>}
      {delta !== null && <div className="chart-up">{delta > 0 ? `↑ ${delta} points` : delta < 0 ? `↓ ${Math.abs(delta)} points` : 'No score change'} from your previous report</div>}
      <span className="feature-card-link">View all analytics ↗</span>
    </div>}
  </Link>;
}
