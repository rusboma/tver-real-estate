export async function fetchText(url, timeoutMs, userAgent) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': userAgent, 'Accept': 'application/rss+xml, application/atom+xml, text/xml, text/html;q=0.9, */*;q=0.8' }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return { text, contentType: response.headers.get('content-type') || '' };
  } finally { clearTimeout(timer); }
}
