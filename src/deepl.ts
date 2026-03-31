/**
 * Maps XLF BCP-47 language tags (e.g. de-DE, en-US) to DeepL `*_lang` codes.
 * @see https://www.deepl.com/docs-api/translate-text/
 */
export function xlfLangToDeepL(lang: string): string {
  const t = lang.trim();
  if (!t) {
    return 'EN';
  }
  if (/^[a-z]{2}-[A-Z]{2}$/.test(t)) {
    return t.toUpperCase();
  }
  const lower = t.toLowerCase();
  const map: Record<string, string> = {
    de: 'DE',
    en: 'EN',
    fr: 'FR',
    es: 'ES',
    it: 'IT',
    nl: 'NL',
    pl: 'PL',
    pt: 'PT-PT',
    ru: 'RU',
    ja: 'JA',
    zh: 'ZH',
    ko: 'KO',
    sv: 'SV',
    da: 'DA',
    fi: 'FI',
    el: 'EL',
    cs: 'CS',
    sk: 'SK',
    hu: 'HU',
    ro: 'RO',
    bg: 'BG',
    sl: 'SL',
    et: 'ET',
    lv: 'LV',
    lt: 'LT',
    uk: 'UK',
    nb: 'NB',
    tr: 'TR',
    id: 'ID'
  };
  return map[lower] ?? t.toUpperCase();
}

/** @deprecated Use {@link xlfLangToDeepL} */
export const xlfTargetToDeepL = xlfLangToDeepL;

export interface DeepLTranslateResult {
  text: string;
}

export async function translateWithDeepL(
  authKey: string,
  text: string,
  targetLang: string,
  useFreeApi: boolean,
  /** XLF `source-language` — improves translation when set (DeepL `source_lang`). */
  sourceLang?: string
): Promise<DeepLTranslateResult> {
  const url = useFreeApi
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';
  const body = new URLSearchParams();
  body.set('text', text);
  body.set('target_lang', xlfLangToDeepL(targetLang));
  const src = sourceLang?.trim();
  if (src) {
    body.set('source_lang', xlfLangToDeepL(src));
  }

  const res = await fetch(url, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `DeepL-Auth-Key ${authKey}`
    }
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${res.status} ${errText.slice(0, 500)}`);
  }
  const j = (await res.json()) as { translations?: { text: string }[] };
  const line = j.translations?.[0]?.text ?? '';
  return { text: line };
}
