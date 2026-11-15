import { completion } from './ai-coding-routes.js';

const list = value => Array.isArray(value) ? value.map(item => String(item).trim()).filter(Boolean).slice(0, 20) : [];

export async function analyzeResumeText(text) {
  const source = String(text || '').trim();
  if (!source) throw Object.assign(new Error('This resume has no extractable text to analyze.'), { status: 422 });
  const raw = await completion([
    { role: 'system', content: 'Analyze resumes for the candidate. Use only explicit evidence in the supplied resume text. Never infer dates, proficiency, employers, degrees, impact or skills. If a section is absent, return an empty array. Return JSON with summary (string), education (string array), skills (string array), experience (string array), projects (string array), strengths (string array), and follow_up_questions (string array). Keep each item concise and evidence-based.' },
    { role: 'user', content: `Analyze this resume text. Do not repeat contact information.\n\n${source.slice(0, 18000)}` }
  ], { json: true, temperature: 0.1 });
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw Object.assign(new Error('The AI provider returned an unreadable resume analysis.'), { status: 502 }); }
  const summary = String(parsed.summary || '').trim().slice(0, 1200);
  if (!summary) throw Object.assign(new Error('The AI provider returned an incomplete resume analysis.'), { status: 502 });
  return {
    summary,
    education: list(parsed.education),
    skills: list(parsed.skills),
    experience: list(parsed.experience),
    projects: list(parsed.projects),
    strengths: list(parsed.strengths),
    follow_up_questions: list(parsed.follow_up_questions)
  };
}
