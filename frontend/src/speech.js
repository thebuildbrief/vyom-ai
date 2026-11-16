export function isSpeechSynthesisSupported() {
  return typeof window !== 'undefined'
    && typeof window.speechSynthesis !== 'undefined'
    && typeof window.SpeechSynthesisUtterance === 'function';
}

export function isSpeechRecognitionSupported() {
  return Boolean(getSpeechRecognition());
}

export function getSpeechRecognition() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function pickVoice(voices, language = 'en-US') {
  if (!Array.isArray(voices) || voices.length === 0) return null;
  const target = String(language || '').toLowerCase();
  const base = target.split('-')[0];
  return voices.find(voice => String(voice.lang || '').toLowerCase() === target)
    || voices.find(voice => String(voice.lang || '').toLowerCase().startsWith(`${base}-`))
    || voices.find(voice => String(voice.lang || '').toLowerCase().startsWith(base))
    || voices.find(voice => voice.default)
    || voices[0];
}

export function speakText({ text, language = 'en-US', rate = 1, onEnd, onError }) {
  if (!isSpeechSynthesisSupported()) {
    onError?.(new Error('Read-aloud is not supported in this browser. Try Chrome or Edge.'));
    return null;
  }
  const clean = String(text || '').trim();
  if (!clean) return null;
  window.speechSynthesis.cancel();
  const utterance = new window.SpeechSynthesisUtterance(clean);
  const voice = pickVoice(window.speechSynthesis.getVoices(), language);
  if (voice) utterance.voice = voice;
  utterance.lang = language;
  utterance.rate = rate;
  utterance.onend = () => onEnd?.();
  utterance.onerror = event => {
    if (event.error === 'interrupted' || event.error === 'canceled') return;
    onError?.(event);
  };
  window.speechSynthesis.speak(utterance);
  return utterance;
}

export function stopSpeaking() {
  if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
}
