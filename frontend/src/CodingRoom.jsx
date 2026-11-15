import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { interviewIdFromPath } from './interviewRoute.js';
import { formatDateTime } from './dates.js';

const languages = ['Python', 'JavaScript', 'Java', 'C++'];
const difficultyOrder = ['All', 'Easy', 'Medium', 'Hard'];
const keywords = new Set(['and', 'as', 'assert', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'def', 'default', 'delete', 'do', 'else', 'enum', 'elif', 'except', 'export', 'extends', 'false', 'final', 'finally', 'for', 'from', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'None', 'null', 'or', 'package', 'pass', 'private', 'protected', 'public', 'raise', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'True', 'False', 'include', 'using', 'namespace', 'struct', 'template', 'typename', 'auto', 'bool', 'char', 'double', 'float', 'int', 'long', 'short', 'signed', 'unsigned', 'vector', 'string', 'pair', 'map', 'unordered_map']);

function escapeText(value) {
  return value.replace(/[&<>]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[character]));
}

function tokenize(code, language) {
  const stringPattern = '`(?:\\\\.|[^`\\\\])*`|"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'';
  const commentPattern = language === 'Python' ? '#[^\\n]*' : '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/';
  const pattern = new RegExp(`(${commentPattern}|${stringPattern}|\\b\\d+(?:\\.\\d+)?\\b|\\b[A-Za-z_$][\\w$]*\\b)`, 'g');
  const nodes = [];
  let cursor = 0, index = 0;
  code.replace(pattern, (...args) => {
    const match = args[0], offset = args[args.length - 2];
    if (offset > cursor) nodes.push(<span key={`plain-${index++}`}>{code.slice(cursor, offset)}</span>);
    let type = 'code';
    if (match.startsWith('#') || match.startsWith('//') || match.startsWith('/*')) type = 'comment';
    else if (/^["'`]/.test(match)) type = 'string';
    else if (/^\d/.test(match)) type = 'number';
    else if (keywords.has(match)) type = 'keyword';
    else if (/^[A-Z][A-Za-z0-9_]*$/.test(match)) type = 'type';
    nodes.push(<span key={`token-${index++}`} className={`tok-${type}`}>{match}</span>);
    cursor = offset + match.length;
    return match;
  });
  if (cursor < code.length) nodes.push(<span key={`tail-${index++}`}>{code.slice(cursor)}</span>);
  return nodes;
}

function DifficultyBadge({ value }) {
  return <span className={`difficulty-badge ${String(value).toLowerCase()}`}>{value}</span>;
}

function statusLabel(result) {
  if (result.passed === true) return 'Passed';
  if (result.passed === false) return 'Failed';
  return 'Executed';
}

function CodingWorkspace({ api, id }) {
  const [problems, setProblems] = useState([]);
  const [progress, setProgress] = useState(null);
  const [difficulty, setDifficulty] = useState('All');
  const [activeKey, setActiveKey] = useState('');
  const [language, setLanguage] = useState('Python');
  const [source, setSource] = useState('');
  const [customInput, setCustomInput] = useState('');
  const [results, setResults] = useState([]);
  const [consoleText, setConsoleText] = useState('');
  const [consoleTab, setConsoleTab] = useState('output');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [drafts, setDrafts] = useState({});
  const editorRef = useRef(null);
  const highlightRef = useRef(null);
  const activeProblem = problems.find(problem => problem.key === activeKey) || null;
  const filteredProblems = problems.filter(problem => difficulty === 'All' || problem.difficulty === difficulty);
  const highlighted = useMemo(() => tokenize(source, language), [source, language]);
  const lineCount = Math.max(1, source.split('\n').length);

  const loadProgress = useCallback(async () => {
    try { setProgress(await api('/coding/progress')); } catch (value) { setError(value.message); }
  }, [api]);

  useEffect(() => {
    let alive = true;
    Promise.all([api('/coding/problems'), api('/coding/progress')])
      .then(([problemData, progressData]) => {
        if (!alive) return;
        const list = problemData.problems || [];
        setProblems(list);
        setProgress(progressData);
        if (list[0]) {
          setActiveKey(list[0].key);
          setSource(list[0].starters.Python || '');
          setCustomInput(list[0].examples?.[0]?.input || '');
        }
      })
      .catch(value => { if (alive) setError(value.message); });
    return () => { alive = false; };
  }, [api]);

  function updateSource(value) {
    setSource(value);
    if (activeKey) setDrafts(current => ({ ...current, [`${activeKey}:${language}`]: value }));
  }

  function selectProblem(problem) {
    if (!problem) return;
    if (activeKey) setDrafts(current => ({ ...current, [`${activeKey}:${language}`]: source }));
    setActiveKey(problem.key);
    setSource(drafts[`${problem.key}:${language}`] ?? problem.starters[language] ?? '');
    setCustomInput(problem.examples?.[0]?.input || '');
    setResults([]);
    setConsoleText('');
    setConsoleTab('output');
    setError('');
    setNotice('');
    requestAnimationFrame(() => editorRef.current?.focus());
  }

  function selectLanguage(next) {
    if (next === language) return;
    setDrafts(current => ({ ...current, [`${activeKey}:${language}`]: source }));
    setLanguage(next);
    if (activeProblem) setSource(drafts[`${activeKey}:${next}`] ?? activeProblem.starters[next] ?? '');
  }

  function resetCode() {
    if (!activeProblem) return;
    setSource(activeProblem.starters[language] || '');
    setDrafts(current => ({ ...current, [`${activeKey}:${language}`]: activeProblem.starters[language] || '' }));
  }

  function onEditorKeyDown(event) {
    if (event.key === 'Tab') {
      event.preventDefault();
      const start = event.currentTarget.selectionStart, end = event.currentTarget.selectionEnd;
      updateSource(`${source.slice(0, start)}    ${source.slice(end)}`);
      requestAnimationFrame(() => { if (editorRef.current) editorRef.current.selectionStart = editorRef.current.selectionEnd = start + 4; });
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      execute('run');
    }
  }

  function syncScroll(event) {
    if (highlightRef.current) {
      highlightRef.current.scrollTop = event.currentTarget.scrollTop;
      highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
    }
  }

  async function execute(mode) {
    if (busy || !activeProblem) return;
    if (!id) { setError('This coding session has no interview ID.'); return; }
    setBusy(mode);
    setError('');
    setNotice('');
    setResults([]);
    setConsoleText('');
    try {
      const payload = mode === 'submit'
        ? { language, source, mode: 'submit', problem_key: activeProblem.key }
        : { language, source, mode: 'run', problem_key: activeProblem.key, input: customInput, test_cases: [{ input: customInput, expected_output: null }] };
      const data = await api(`/interviews/${id}/code`, { method: 'POST', body: JSON.stringify(payload) });
      const testResults = data.test_results || [];
      setResults(testResults);
      setConsoleTab(mode === 'submit' ? 'tests' : 'output');
      if (mode === 'run') setConsoleText(testResults.map(test => test.actual || '(Program completed with no output)').join('\n\n'));
      if (mode === 'submit') {
        setNotice(`${data.passed}/${data.total} tests passed.${data.passed === data.total ? ' Problem solved.' : ''}`);
      }
      await loadProgress();
    } catch (value) { setError(value.message); }
    finally { setBusy(''); }
  }

  const stats = progress?.stats || {};
  return <div className="coding-page coding-lab">
    <div className="coding-bar">
      <div className="coding-bar-left"><Link to={`/interview/${id}`}>← Interview room</Link><span>CODE LAB</span></div>
      <div className="coding-bar-right">
        <span className="coding-session">Session {id ? id.slice(0, 8) : '—'}</span>
        <button className="button secondary small" onClick={() => execute('run')} disabled={Boolean(busy) || !activeProblem}>{busy === 'run' ? 'Running…' : '▶ Run code'}</button>
        <button className="button small" onClick={() => execute('submit')} disabled={Boolean(busy) || !activeProblem}>{busy === 'submit' ? 'Judging…' : 'Submit solution'}</button>
      </div>
    </div>
    <div className="coding-shell">
      <aside className="coding-sidebar">
        <section className="coding-progress-card">
          <span className="eyebrow">YOUR PROGRESS</span>
          <strong>{stats.solved || 0}<small> / {stats.total_problems || problems.length}</small></strong>
          <div className="coding-progress-bar"><i style={{ width: `${stats.total_problems ? (stats.solved / stats.total_problems) * 100 : 0}%` }}/></div>
          <small>{stats.submissions || 0} submissions · {stats.passed_tests || 0}/{stats.total_tests || 0} tests passed</small>
        </section>
        <div className="problem-filters" role="group" aria-label="Filter problems by difficulty">
          {difficultyOrder.map(value => <button type="button" key={value} aria-pressed={difficulty === value} onClick={() => setDifficulty(value)}>{value}</button>)}
        </div>
        <div className="problem-list">
          {filteredProblems.map(problem => <button type="button" key={problem.key} className={`problem-item ${problem.key === activeKey ? 'is-active' : ''}`} onClick={() => selectProblem(problem)}>
            <span>{progress?.solved_problems?.includes(problem.key) ? '✓' : '○'}</span>
            <div><b>{problem.title}</b><small>{problem.topics.join(' · ')}</small></div>
            <DifficultyBadge value={problem.difficulty}/>
          </button>)}
        </div>
      </aside>
      <main className="coding-main">
        <div className="coding-problem-head">
          <div><span className="eyebrow">{activeProblem ? activeProblem.topics.join(' · ') : 'CODING PRACTICE'}</span><h1>{activeProblem?.title || 'Choose a problem'}</h1></div>
          {activeProblem && <DifficultyBadge value={activeProblem.difficulty}/>}
        </div>
        {notice && <div className="coding-notice" role="status">{notice}</div>}
        {error && <div className="coding-notice error" role="alert">{error}</div>}
        <section className="editor-card" aria-label="Code editor">
          <div className="editor-toolbar">
            <label>Language<select value={language} onChange={event => selectLanguage(event.target.value)}>{languages.map(value => <option key={value}>{value}</option>)}</select></label>
            <span>{lineCount} lines · real JDoodle execution</span>
            <button type="button" onClick={resetCode}>Reset code</button>
          </div>
          <div className="editor-surface">
            <pre className="code-highlight" ref={highlightRef} aria-hidden="true">{highlighted}{'\n'}</pre>
            <textarea ref={editorRef} className="code-input" spellCheck="false" value={source} onChange={event => updateSource(event.target.value)} onKeyDown={onEditorKeyDown} onScroll={syncScroll} aria-label="Solution source code" wrap="off"/>
          </div>
          <div className="stdin-row">
            <label>Custom input <span>used by Run code</span><textarea value={customInput} onChange={event => setCustomInput(event.target.value)} placeholder="Standard input for a custom run" aria-label="Custom standard input"/></label>
            <div className="editor-hint">Ctrl/⌘ + Enter to run · Tab inserts spaces</div>
          </div>
        </section>
        <section className="console-card" aria-label="Execution output">
          <div className="console-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={consoleTab === 'output'} className={consoleTab === 'output' ? 'active' : ''} onClick={() => setConsoleTab('output')}>Output</button>
            <button type="button" role="tab" aria-selected={consoleTab === 'tests'} className={consoleTab === 'tests' ? 'active' : ''} onClick={() => setConsoleTab('tests')}>Test cases {results.length ? `· ${results.filter(row => row.passed === true).length}/${results.length}` : ''}</button>
            <span>{busy ? 'Executing on JDoodle…' : 'Real execution only'}</span>
          </div>
          {consoleTab === 'output' ? <pre className="console-output">{consoleText || (busy ? 'Sending your solution to JDoodle…' : 'Run your code with custom input to see stdout, stderr and compiler output.')}</pre> : <div className="test-results">
            {results.length ? results.map(result => <article className={`test-result ${result.passed === true ? 'passed' : result.passed === false ? 'failed' : 'executed'}`} key={result.index}>
              <div><b>{result.hidden ? `Hidden test ${result.index}` : `Test ${result.index}`}</b><span>{statusLabel(result)}</span></div>
              {!result.hidden && <small>Input: <code>{String(result.input || '').slice(0, 240) || '(custom stdin)'}</code></small>}
              <small>Your output: <code>{String(result.actual || '(no output)').slice(0, 400)}</code></small>
              {result.expected != null && <small>Expected: <code>{String(result.expected).slice(0, 400)}</code></small>}
              {result.time != null && <small>CPU {result.time}s{result.memory != null ? ` · ${result.memory} KB` : ''}</small>}
            </article>) : <div className="console-empty">Run or submit to execute every visible and hidden test through JDoodle.</div>}
          </div>}
        </section>
      </main>
      <aside className="coding-details">
        {activeProblem && <section className="problem-detail">
          <span className="eyebrow">PROBLEM STATEMENT</span>
          <h2>{activeProblem.title}</h2>
          <p>{activeProblem.description}</p>
          <h3>Constraints</h3>
          <ul>{activeProblem.constraints.map(item => <li key={item}>{item}</li>)}</ul>
          <h3>Examples</h3>
          {activeProblem.examples.map((example, index) => <div className="example-block" key={index}>
            <small>Input</small><pre>{example.input}</pre>
            <small>Output</small><pre>{example.output}</pre>
            {example.explanation && <p>{example.explanation}</p>}
          </div>)}
          <p className="problem-test-count">{activeProblem.test_count} test cases · hidden tests are verified on Submit.</p>
        </section>}
        <section className="submission-history">
          <div className="submission-heading"><span className="eyebrow">SUBMISSION HISTORY</span><span>{stats.submissions || 0} total</span></div>
          {progress?.history?.length ? progress.history.map(item => <div className="submission-row" key={item.id}>
            <span className={`submission-dot ${item.total > 0 && item.passed === item.total ? 'solved' : ''}`}/>
            <div><b>{item.problem_title}</b><small>{item.language} · {item.mode === 'submit' ? 'submitted' : 'ran'} · {formatDateTime(item.created_at)}</small></div>
            <span>{item.total ? `${item.passed}/${item.total}` : 'run'}</span>
          </div>) : <div className="console-empty">Your real JDoodle submissions will appear here.</div>}
        </section>
        <section className="coding-tip">
          <b>How scoring works</b>
          <p>Submit validates against the server’s full test set. Passed tests and solved problems feed the coding progress on your friends leaderboard.</p>
        </section>
      </aside>
    </div>
  </div>;
}

export default function CodingRoom({ api }) {
  const id = interviewIdFromPath(useLocation().pathname);
  return <CodingWorkspace api={api} id={id}/>;
}

export function CodingHome({ api }) {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    api('/coding/workspace', { method: 'POST' })
      .then(data => { if (alive) navigate(`/interview/${data.interview.id}/coding`, { replace: true }); })
      .catch(value => { if (alive) setError(value.message); });
    return () => { alive = false; };
  }, [api, navigate]);
  return <div className="dash wrap coding-home">
    <span className="eyebrow">CODE LAB</span>
    <h1>Sharpen your problem solving.</h1>
    {error ? <div className="empty-card">{error} <Link to="/dashboard">Back to dashboard</Link></div> : <div className="empty-card" role="status">Opening your coding workspace…</div>}
  </div>;
}
