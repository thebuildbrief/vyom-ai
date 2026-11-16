import { useEffect, useRef, useState } from 'react';

async function api(path, options = {}) {
  const response = await fetch(`${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')}/api${path}`, {
    credentials: 'include',
    cache: 'no-store',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || 'Voice session request failed');
  return data;
}

export default function VoiceSession({ interviewId, onTranscript, onStateChange, onLevels, onMutedChange, onPausedChange, lastAssistantMessage = '', disabled = false }) {
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const peer = useRef(null);
  const stream = useRef(null);
  const channel = useRef(null);
  const audio = useRef(null);
  const seen = useRef(new Set());
  const stateChange = useRef(onStateChange);
  const levelCallback = useRef(onLevels);
  const mutedCallback = useRef(onMutedChange);
  const pausedCallback = useRef(onPausedChange);
  const levelContext = useRef(null);
  const levelFrame = useRef(0);
  const pausedRef = useRef(false);
  const mutedRef = useRef(false);
  const stopped = useRef(true);
  const saveQueue = useRef(Promise.resolve());

  useEffect(() => { stateChange.current = onStateChange; }, [onStateChange]);
  useEffect(() => { levelCallback.current = onLevels; }, [onLevels]);
  useEffect(() => { mutedCallback.current = onMutedChange; }, [onMutedChange]);
  useEffect(() => { pausedCallback.current = onPausedChange; }, [onPausedChange]);
  const updateState = value => {
    setState(value);
    stateChange.current?.(value);
  };

  function stopLevels() {
    cancelAnimationFrame(levelFrame.current);
    levelFrame.current = 0;
    try { levelContext.current?.close(); } catch { /* Already closed. */ }
    levelContext.current = null;
    levelCallback.current?.([]);
  }

  function release(update = true) {
    stopped.current = true;
    stopLevels();
    try { channel.current?.close(); } catch { /* Already closed. */ }
    try { peer.current?.close(); } catch { /* Already closed. */ }
    stream.current?.getTracks().forEach(track => track.stop());
    if (audio.current) audio.current.srcObject = null;
    channel.current = null;
    peer.current = null;
    stream.current = null;
    pausedRef.current = false;
    mutedRef.current = false;
    mutedCallback.current?.(false);
    pausedCallback.current?.(false);
    if (update) {
      setPaused(false);
      setMuted(false);
      updateState('idle');
    }
  }

  useEffect(() => () => release(false), [interviewId]);
  useEffect(() => {
    if (disabled && !stopped.current) release();
  }, [disabled]);

  async function start() {
    if (disabled || !stopped.current) return;
    setError('');
    seen.current.clear();
    saveQueue.current = Promise.resolve();
    mutedRef.current = false;
    pausedRef.current = false;
    setMuted(false);
    setPaused(false);
    mutedCallback.current?.(false);
    pausedCallback.current?.(false);
    updateState('connecting');
    stopped.current = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Error('Microphone access requires HTTPS or localhost in a supported browser.');
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (stopped.current) { microphone.getTracks().forEach(track => track.stop()); return; }
      stream.current = microphone;

      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          const context = new AudioContextClass();
          levelContext.current = context;
          if (context.state === 'suspended') await context.resume();
          if (stopped.current) { stopLevels(); return; }
          const analyser = context.createAnalyser();
          analyser.fftSize = 64;
          analyser.smoothingTimeConstant = 0.65;
          context.createMediaStreamSource(microphone).connect(analyser);
          const bins = new Uint8Array(analyser.frequencyBinCount);
          let lastPaint = 0;
          const paint = time => {
            if (stopped.current) return;
            levelFrame.current = requestAnimationFrame(paint);
            if (time - lastPaint < 90) return;
            lastPaint = time;
            const levels = Array(28).fill(2);
            if (!mutedRef.current && !pausedRef.current) {
              analyser.getByteFrequencyData(bins);
              for (let i = 0; i < levels.length; i += 1) levels[i] = 2 + (bins[i % bins.length] / 255) * 36;
            }
            levelCallback.current?.(levels);
          };
          levelFrame.current = requestAnimationFrame(paint);
        }
      } catch { stopLevels(); }

      const session = await api(`/interviews/${interviewId}/voice/session`, { method: 'POST', body: '{}' });
      if (stopped.current) return;
      if (!session.client_secret) throw Error('The voice provider did not return a temporary session credential.');
      const connection = new RTCPeerConnection();
      peer.current = connection;
      connection.ontrack = event => {
        if (audio.current) {
          audio.current.srcObject = event.streams[0];
          audio.current.play().catch(() => setError('Audio is ready. Tap the page or enable audio playback to hear the interviewer.'));
        }
      };
      connection.onconnectionstatechange = () => {
        if (stopped.current) return;
        if (connection.connectionState === 'disconnected') {
          setError('Realtime voice connection interrupted. Trying to recover…');
          try { connection.restartIce(); } catch { /* Older browsers may not support restartIce. */ }
          return;
        }
        if (connection.connectionState === 'failed') {
          setError('Realtime voice connection failed. Stop and start voice to try again.');
          release();
          updateState('error');
        }
      };
      microphone.getTracks().forEach(track => connection.addTrack(track, microphone));

      const events = connection.createDataChannel('oai-events');
      channel.current = events;
      events.onopen = () => {
        if (stopped.current || events.readyState !== 'open') return;
        updateState('processing');
        events.send(JSON.stringify({
          type: 'response.create',
          response: { instructions: lastAssistantMessage
            ? `Read the interviewer's latest question aloud exactly once, then listen for the candidate's answer: ${lastAssistantMessage}`
            : 'Introduce yourself briefly and ask the opening interview question.' }
        }));
      };
      events.onerror = () => setError('The realtime event channel encountered a network error.');
      events.onclose = () => {
        if (stopped.current || channel.current !== events) return;
        setError('Realtime voice session ended. Start voice again to continue.');
        release(false);
        updateState('error');
      };
      events.onmessage = async event => {
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        const type = data.type || '';
        if (type === 'error') {
          setError(data.error?.message || 'The realtime voice provider returned an error.');
          release(false);
          updateState('error');
          return;
        }
        if (type === 'input_audio_buffer.speech_started') updateState('listening');
        if (type === 'response.created') updateState('processing');
        if (type.includes('output_audio') && (type.includes('delta') || type.includes('started'))) updateState('speaking');
        if (type === 'response.done' || type === 'output_audio_buffer.stopped') updateState(pausedRef.current ? 'paused' : 'listening');

        const userTranscript = type === 'conversation.item.input_audio_transcription.completed' || type === 'input_audio_transcription.completed';
        const assistantTranscript = type === 'response.output_audio_transcript.done' || type === 'response.audio_transcript.done';
        const role = userTranscript ? 'user' : assistantTranscript ? 'assistant' : null;
        const content = String(data.transcript || data.text || '').trim();
        const itemId = data.item_id || data.response_id || '';
        if (!role || !content || !itemId || seen.current.has(`${role}:${itemId}`)) return;
        seen.current.add(`${role}:${itemId}`);
        if (role === 'assistant' && lastAssistantMessage && content.toLowerCase() === lastAssistantMessage.trim().toLowerCase()) return;
        try {
          const pending = saveQueue.current.then(() => api(`/interviews/${interviewId}/transcript`, { method: 'POST', body: JSON.stringify({ role, content }) }));
          saveQueue.current = pending.catch(() => {});
          const saved = await pending;
          onTranscript?.(saved);
        } catch (saveError) {
          setError(`Transcript could not be saved: ${saveError.message}`);
        }
      };

      const offer = await connection.createOffer();
      if (stopped.current) return;
      await connection.setLocalDescription(offer);
      if (stopped.current) return;
      const answer = await fetch(`${session.call_url || 'https://api.openai.com/v1/realtime/calls'}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.client_secret}`, 'Content-Type': 'application/sdp' },
        body: connection.localDescription?.sdp || offer.sdp
      });
      if (!answer.ok) {
        const reason = await answer.text().catch(() => '');
        throw Error(`Realtime voice connection failed (${answer.status})${reason ? `: ${reason.slice(0, 180)}` : ''}`);
      }
      await connection.setRemoteDescription({ type: 'answer', sdp: await answer.text() });
    } catch (startError) {
      if (stopped.current) return;
      release(false);
      setError(startError.name === 'NotAllowedError'
        ? 'Microphone permission was denied. Allow microphone access in your browser and try again.'
        : startError.message || 'Could not start realtime voice.');
      updateState('error');
    }
  }

  function toggleMute() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    mutedCallback.current?.(next);
    stream.current?.getAudioTracks().forEach(track => { track.enabled = !next && !pausedRef.current; });
  }

  function togglePause() {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    pausedCallback.current?.(next);
    stream.current?.getAudioTracks().forEach(track => { track.enabled = !next && !mutedRef.current; });
    if (audio.current) audio.current.muted = next;
    if (next) updateState('paused');
    else {
      if (audio.current) audio.current.muted = false;
      updateState('listening');
    }
  }

  async function stopVoice() {
    try { await saveQueue.current; } catch { /* Failed saves already surfaced their own error. */ }
    if (stopped.current) return;
    release();
  }

  return <div className="voice-control">
    <audio ref={audio} autoPlay />
    {state === 'idle' || state === 'error'
      ? <button className="voice-toggle" onClick={start} disabled={disabled}>◖ {state === 'error' ? 'Retry realtime voice' : 'Start realtime voice'}</button>
      : <>
        <span className={`voice-status voice-${state}`} role="status">{state === 'connecting' ? 'Connecting…' : state === 'processing' ? 'AI processing…' : state === 'speaking' ? 'Interviewer speaking' : state === 'paused' ? 'Paused' : 'Listening'}</span>
        <button className="voice-toggle active" onClick={toggleMute} aria-pressed={muted}>{muted ? 'Unmute' : 'Mute'}</button>
        <button className="voice-toggle" onClick={togglePause} aria-pressed={paused}>{paused ? 'Resume' : 'Pause'}</button>
        <button className="voice-toggle" onClick={() => { stopVoice(); }}>Stop voice</button>
      </>}
    {error && <span className="voice-error" role="status">{error}</span>}
  </div>;
}
