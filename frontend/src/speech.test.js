import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSpeechSynthesisSupported,
  isSpeechRecognitionSupported,
  getSpeechRecognition,
  pickVoice,
  speakText,
  stopSpeaking
} from './speech.js';

function withWindow(stubs, fn) {
  const previous = globalThis.window;
  globalThis.window = stubs;
  try { return fn(); }
  finally { globalThis.window = previous; }
}

test('speech synthesis support is false without a browser window', () => {
  assert.equal(isSpeechSynthesisSupported(), false);
  assert.equal(isSpeechRecognitionSupported(), false);
  assert.equal(getSpeechRecognition(), null);
});

test('speech recognition detection prefers the standard API and falls back to webkit', () => {
  class StandardRecognition {}
  class WebkitRecognition {}
  assert.equal(withWindow({}, () => getSpeechRecognition()), null);
  assert.equal(withWindow({ webkitSpeechRecognition: WebkitRecognition }, () => getSpeechRecognition()), WebkitRecognition);
  assert.equal(withWindow({ SpeechRecognition: StandardRecognition }, () => getSpeechRecognition()), StandardRecognition);
  assert.equal(withWindow({ SpeechRecognition: StandardRecognition, webkitSpeechRecognition: WebkitRecognition }, isSpeechRecognitionSupported), true);
});

test('pickVoice matches exact locale, then base language, then default voice', () => {
  const voices = [
    { lang: 'en-GB', name: 'Daniel' },
    { lang: 'hi-IN', name: 'Lekha' },
    { lang: 'en-US', name: 'Samantha', default: true }
  ];
  assert.equal(pickVoice(voices, 'hi-IN').name, 'Lekha');
  assert.equal(pickVoice(voices, 'hi').name, 'Lekha');
  assert.equal(pickVoice(voices, 'en-IN').name, 'Daniel');
  assert.equal(pickVoice(voices, 'en-US').name, 'Samantha');
  assert.equal(pickVoice([], 'en-US'), null);
  assert.equal(pickVoice(undefined, 'en-US'), null);
});

test('speakText cancels the previous utterance and speaks with a matching voice', () => {
  const spoken = [];
  let cancelled = 0;
  class Utterance {
    constructor(text) { this.text = text; }
  }
  const result = withWindow({
    SpeechSynthesisUtterance: Utterance,
    speechSynthesis: {
      cancel: () => { cancelled += 1; },
      speak: u => spoken.push(u),
      getVoices: () => [{ lang: 'hi-IN', name: 'Lekha' }]
    }
  }, () => speakText({ text: 'नमस्ते', language: 'hi-IN', rate: 0.95 }));
  assert.ok(result instanceof Utterance);
  assert.equal(result.text, 'नमस्ते');
  assert.equal(result.lang, 'hi-IN');
  assert.equal(result.rate, 0.95);
  assert.equal(result.voice.name, 'Lekha');
  assert.equal(cancelled, 1);
  assert.equal(spoken.length, 1);
});

test('speakText reports an error when synthesis is unavailable', () => {
  let message = '';
  const result = withWindow({}, () => speakText({ text: 'hello', onError: error => { message = error.message; } }));
  assert.equal(result, null);
  assert.match(message, /not supported/i);
});

test('speakText ignores empty text', () => {
  assert.equal(withWindow({ SpeechSynthesisUtterance: class {}, speechSynthesis: { cancel() {}, speak() {}, getVoices: () => [] } }, () => speakText({ text: '   ' })), null);
});

test('stopSpeaking cancels only when synthesis exists', () => {
  withWindow({}, () => { stopSpeaking(); });
  let cancelled = 0;
  withWindow({ speechSynthesis: { cancel: () => { cancelled += 1; } } }, () => { stopSpeaking(); stopSpeaking(); });
  assert.equal(cancelled, 2);
});
