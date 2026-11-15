const languageVersions = {
  'C++': ['cpp', 'JDOODLE_CPP_VERSION_INDEX', '7'],
  Java: ['java', 'JDOODLE_JAVA_VERSION_INDEX', '6'],
  Python: ['python3', 'JDOODLE_PYTHON_VERSION_INDEX', '6'],
  JavaScript: ['nodejs', 'JDOODLE_JAVASCRIPT_VERSION_INDEX', '7']
};

export async function executeJdoodle(language, script, stdin = '') {
  if (!process.env.JDOODLE_CLIENT_ID || !process.env.JDOODLE_CLIENT_SECRET) {
    throw Object.assign(new Error('Code execution needs JDOODLE_CLIENT_ID and JDOODLE_CLIENT_SECRET configured.'), { status: 503 });
  }
  const mapping = languageVersions[language];
  if (!mapping) throw Object.assign(new Error('Choose a supported JDoodle language.'), { status: 400 });
  const response = await fetch(process.env.JDOODLE_API_URL || 'https://api.jdoodle.com/v1/execute', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: process.env.JDOODLE_CLIENT_ID, clientSecret: process.env.JDOODLE_CLIENT_SECRET, script, language: mapping[0], versionIndex: process.env[mapping[1]] || mapping[2], stdin }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw Object.assign(new Error(`JDoodle returned ${response.status}.`), { status: 502 });
  const result = await response.json();
  if (Number(result.statusCode) !== 200) throw Object.assign(new Error('JDoodle could not execute this submission.'), { status: 502 });
  return { output: String(result.output || ''), cpuTime: result.cpuTime, memory: result.memory };
}
