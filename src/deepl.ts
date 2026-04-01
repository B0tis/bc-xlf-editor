/**
 * Maps XLF BCP-47 language tags (e.g. de-DE, en-US) to DeepL `*_lang` codes.
 *
 * DeepL uses short codes (`DE`, `FR`, …) for most languages — not regional BCP-47
 * forms like `DE-DE` / `FR-FR`, which are invalid `target_lang` / `source_lang`
 * values and yield HTTP 400.
 * Regional variants exist mainly for `EN`, `PT`, `ES` (see DeepL supported languages).
 *
 * @see https://developers.deepl.com/docs/api-reference/translate
 */
const PRIMARY_TO_DEEPL: Record<string, string> = {
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

/** Lowercase BCP-47 tags that map to DeepL’s regional codes. */
const TAG_TO_DEEPL: Record<string, string> = {
  'en-us': 'EN-US',
  'en-gb': 'EN-GB',
  'pt-br': 'PT-BR',
  'pt-pt': 'PT-PT',
  'es-es': 'ES',
  'es-419': 'ES-419'
};

export function xlfLangToDeepL(lang: string): string {
  const t = lang.trim();
  if (!t) {
    return 'EN';
  }
  const norm = t.replace(/_/g, '-');
  const lower = norm.toLowerCase();
  if (TAG_TO_DEEPL[lower]) {
    return TAG_TO_DEEPL[lower];
  }
  const parts = lower.split('-').filter(Boolean);
  const primary = parts[0];
  if (!primary) {
    return 'EN';
  }
  if (parts.length >= 2) {
    const composite = `${parts[0]}-${parts[1]}`;
    if (TAG_TO_DEEPL[composite]) {
      return TAG_TO_DEEPL[composite];
    }
    if (primary === 'es') {
      if (parts[1] === 'es') {
        return 'ES';
      }
      return 'ES-419';
    }
    if (primary === 'zh') {
      return 'ZH';
    }
    if (PRIMARY_TO_DEEPL[primary]) {
      return PRIMARY_TO_DEEPL[primary];
    }
    return norm.toUpperCase();
  }
  return PRIMARY_TO_DEEPL[primary] ?? primary.toUpperCase();
}

/**
 * DeepL `target_lang` accepts regional codes (EN-US, PT-BR, …).
 * `source_lang` only accepts neutral codes from the /languages?type=source list:
 * English → EN (not EN-US / EN-GB), Portuguese → PT (not PT-BR / PT-PT).
 *
 * @see https://developers.deepl.com/docs/getting-started/supported-languages
 */
export function xlfLangToDeepLSource(lang: string): string {
  const code = xlfLangToDeepL(lang);
  const u = code.toUpperCase();
  if (u === 'EN-US' || u === 'EN-GB') {
    return 'EN';
  }
  if (u === 'PT-BR' || u === 'PT-PT') {
    return 'PT';
  }
  return code;
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
    body.set('source_lang', xlfLangToDeepLSource(src));
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
