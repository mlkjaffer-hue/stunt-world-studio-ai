// Shared HTTP helpers for provider adapters.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class ProviderError extends Error {
  constructor(message, { status = 500, refundable = true } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.refundable = refundable;
  }
}

// 402: the site owner has not configured this paid model yet.
class NotConfiguredError extends ProviderError {
  constructor(modelLabel) {
    super(`${modelLabel} is not configured by the site owner yet. Please use the Free model or contact the site owner.`, { status: 402, refundable: true });
    this.name = 'NotConfiguredError';
  }
}

async function fetchBuffer(url, { headers = {}, timeoutMs = 120000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ProviderError(`Download failed (${res.status}): ${body.slice(0, 300)}`, { status: 502 });
    }
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = 60000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    if (!res.ok) {
      throw new ProviderError(
        `Provider API error (${res.status}): ${(data && (data.error?.message || data.error || data.message)) || text.slice(0, 300)}`,
        { status: 502 }
      );
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

module.exports = { sleep, ProviderError, NotConfiguredError, fetchBuffer, fetchJson };
