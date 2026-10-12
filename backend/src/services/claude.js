/* Talking to Claude.
   The key is read from the environment and never leaves this process. The till asks our
   own /api/ai, and we ask Anthropic — putting the key in frontend/index.html would hand it to
   every browser that opens the shop site, and anyone could then spend the shop's money.
   Nothing in here ever puts the key into an error message or a log line either.

   Set ANTHROPIC_API_KEY in backend/.env for this PC, and in the host's environment
   settings for the live site. ANTHROPIC_MODEL can override which model is used. */
const API = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

/* Sonnet reasons over figures far better than the cheaper models, and getting a number
   wrong is the one thing this must not do. ANTHROPIC_MODEL=claude-haiku-4-5-20251001
   makes it much cheaper for lighter work such as writing posts. */
const FALLBACK_MODEL = 'claude-sonnet-5';

/* vercel.json allows the function 30 seconds. Give up at 25 so the shop gets a straight
   answer about what went wrong instead of the host cutting the connection. */
const BUDGET_MS = 25000;

export const aiKey = () => String(process.env.ANTHROPIC_API_KEY || '').trim();
export const aiModel = () => String(process.env.ANTHROPIC_MODEL || '').trim() || FALLBACK_MODEL;
export const aiReady = () => /^sk-ant-/.test(aiKey());
/* A key made for the whole organisation, not inside one workspace, has to say which workspace each
   request is for. Set ANTHROPIC_WORKSPACE_ID (Console → Settings → Workspaces) — or make the key
   inside a workspace, and then this is not needed. */
const aiWorkspace = () => String(process.env.ANTHROPIC_WORKSPACE_ID || '').trim();

/* What each model will take. The newer models refuse a temperature outright (a 400), and Sonnet 5 and
   Opus 5 think before answering unless told not to — which eats the short answer budget and the 25
   seconds. These answers are short and factual, so thinking is switched off where a model allows it,
   and where it cannot be (Opus 5.5, Sonnet 5.5, Fable, Haiku 5.5) the answer is given room for it. */
const takesTemperature = m => /^claude-(3|haiku-4-5|sonnet-4-[56]|opus-4-[56])/.test(m);
const thinkingCanBeOff = m => /^claude-(sonnet-5|opus-5)$/.test(m);

const fail = (status, message, code) => Object.assign(new Error(message), { status, code, expose: true });

/**
 * One question to Claude, one answer back.
 * @param {{system:string, messages:Array<{role:string,content:string}>, maxTokens?:number, temperature?:number}} o
 * @returns {Promise<{text:string, model:string, usage:object}>}
 */
export async function askClaude({ system, messages, maxTokens = 1000, temperature = 0.2 }) {
  if (!aiReady()) throw fail(503, 'Claude is not connected yet — the shop has to put its key in first.', 'no-key');

  const model = aiModel();
  const request = { model, max_tokens: maxTokens, system, messages };
  if (takesTemperature(model)) request.temperature = temperature;
  else if (thinkingCanBeOff(model)) request.thinking = { type: 'disabled' };
  else request.max_tokens = Math.max(maxTokens, 8000);       // room for the thinking it always does
  const headers = { 'content-type': 'application/json', 'anthropic-version': VERSION, 'x-api-key': aiKey() };
  if (aiWorkspace()) headers['anthropic-workspace-id'] = aiWorkspace();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), BUDGET_MS);
  let res;
  try {
    res = await fetch(API, { method: 'POST', signal: ctrl.signal, headers, body: JSON.stringify(request) });
  } catch (e) {
    if (e.name === 'AbortError') throw fail(504, 'Claude took longer than 25 seconds. Ask something narrower — a single supplier, or a shorter stretch of days.', 'slow');
    throw fail(502, 'Could not reach Claude. Check this machine is online.', 'offline');
  } finally {
    clearTimeout(timer);
  }

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const said = body?.error?.message || '';
    if (res.status === 401 || res.status === 403) throw fail(502, 'Anthropic would not accept the key. Check ANTHROPIC_API_KEY, and that the account has credit.', 'bad-key');
    if (res.status === 429) throw fail(429, 'Too many questions at once, or the account is out of credit. Wait a moment and try again.', 'busy');
    if (res.status === 529) throw fail(503, 'Claude is overloaded just now. Try again in a minute.', 'overloaded');
    if (res.status === 400 && /max_tokens|too long|exceed/i.test(said)) throw fail(413, 'Too much was sent at once. Ask about a shorter stretch of days.', 'too-big');
    if (res.status === 400 && /workspace/i.test(said)) throw fail(502, 'The Claude key needs a workspace: put ANTHROPIC_WORKSPACE_ID in backend/.env (Anthropic Console → Settings → Workspaces), or make a new key inside a workspace and use that.', 'no-workspace');
    throw fail(502, `Claude refused the question (${res.status}).` + (said ? ' ' + said.slice(0, 200) : ''), 'refused');
  }

  const text = (body?.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
  if (!text) throw fail(502, 'Claude sent nothing back. Try asking again.', 'empty');

  return { text, model: body.model || aiModel(), usage: body.usage || {} };
}
