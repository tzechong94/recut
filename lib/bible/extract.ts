// VL auto-extraction of entity attributes from reference images. Pure orchestration: the
// caller injects the vision call (qwen3-vl-plus via a vision.critique manifest). The user then
// edits the returned typed block in the bible panel.

export interface AttributeExtraction {
  attributes: Record<string, string>;
}

export function attributePrompt(kind: string): string {
  return (
    `You are cataloguing a ${kind} for a film's Series Bible. From the reference image(s), extract ` +
    `stable visual attributes as STRICT JSON: {"attributes": {"<key>": "<value>", ...}}. Use short keys ` +
    `(hair, wardrobe, age, build, distinguishing_features, palette for a character; material, shape, ` +
    `colour for a prop/vehicle; setting, time_of_day, palette for a location). Values are short phrases. ` +
    `JSON only.`
  );
}

export function parseAttributes(vlText: string): Record<string, string> {
  const t = vlText.slice(vlText.indexOf('{'), vlText.lastIndexOf('}') + 1);
  const parsed = JSON.parse(t) as { attributes?: Record<string, unknown> };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed.attributes ?? {})) out[k] = String(v);
  return out;
}

/** vlFn receives the image parts + prompt and returns the model's raw text reply. */
export async function extractAttributes(
  refUrls: string[],
  kind: string,
  vlFn: (content: unknown[]) => Promise<string>,
): Promise<AttributeExtraction> {
  const content = [...refUrls.map((u) => ({ image: u })), { text: attributePrompt(kind) }];
  const text = await vlFn(content);
  return { attributes: parseAttributes(text) };
}
