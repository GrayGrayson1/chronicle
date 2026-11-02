export async function downloadAttachment(attachment, maxBytes, extensions) {
  if (!extensions.some(ext => attachment.name.toLowerCase().endsWith(ext))) throw new Error(`Supported files: ${extensions.join(', ')}`);
  if (attachment.size > maxBytes) throw new Error(`File limit: ${Math.floor(maxBytes/1024/1024)} MB.`);
  const url = new URL(attachment.url);
  if (url.protocol !== 'https:' || !['cdn.discordapp.com','media.discordapp.net'].includes(url.hostname)) throw new Error('Only Discord-hosted attachments are accepted.');
  const response = await fetch(url, { redirect:'error', signal:AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error('Attachment could not be downloaded; upload it again.');
  const parts=[]; let bytes=0;
  for await (const part of response.body) {
    bytes+=part.length;
    if (bytes>maxBytes) { await response.body.cancel().catch(() => {}); throw new Error('Attachment exceeds the file limit.'); }
    parts.push(part);
  }
  return Buffer.concat(parts);
}
