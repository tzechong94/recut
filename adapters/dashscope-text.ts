// DashScope text-generation adapter (qwen3-max etc.). Model id passed in (lives in a manifest).

function base(): string {
  return (process.env.RECUT_DASHSCOPE_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/api/v1').replace(/\/$/, '');
}

export class TextGenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TextGenError';
  }
}

export async function dashscopeText(modelId: string, system: string, user: string): Promise<string> {
  const key = process.env.RECUT_DASHSCOPE_API_KEY ?? '';
  if (!key) throw new TextGenError('RECUT_DASHSCOPE_API_KEY unset');
  const res = await fetch(`${base()}/services/aigc/text-generation/generation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelId,
      input: { messages: [{ role: 'system', content: system }, { role: 'user', content: user }] },
      parameters: { result_format: 'message' },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    code?: string;
    message?: string;
    output?: { choices?: Array<{ message?: { content?: string } }>; text?: string };
  };
  if (!res.ok || body.code) throw new TextGenError(`${modelId} ${res.status} ${body.code ?? ''}: ${String(body.message ?? '').slice(0, 160)}`);
  return body.output?.choices?.[0]?.message?.content ?? body.output?.text ?? '';
}
