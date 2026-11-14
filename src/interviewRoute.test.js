import test from 'node:test';
import assert from 'node:assert/strict';
import { interviewIdFromPath } from './interviewRoute.js';

const id = '5006822b-d3ca-40c8-b137-57ee52b94181';

test('extracts interview IDs from manually routed interview paths', () => {
  assert.equal(interviewIdFromPath(`/interview/${id}`), id);
  assert.equal(interviewIdFromPath(`/interview/${id}/coding`), id);
  assert.equal(interviewIdFromPath(`/interview/${id}/report`), id);
});

test('returns an empty ID for missing or malformed interview paths', () => {
  assert.equal(interviewIdFromPath('/interview'), '');
  assert.equal(interviewIdFromPath('/dashboard'), '');
  assert.equal(interviewIdFromPath('/interview/%E0%A4%A'), '');
});
