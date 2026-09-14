/**
 * ISO 3166-1 alpha-2 country codes.
 *
 * Only the codes are stored here. The names come from `Intl.DisplayNames`,
 * which every browser already carries, so there is no translation table to
 * maintain and the list reads in the user's own language for free.
 */

const CODES =
  'AD,AE,AF,AG,AI,AL,AM,AO,AQ,AR,AS,AT,AU,AW,AX,AZ,BA,BB,BD,BE,BF,BG,BH,BI,BJ,BL,BM,BN,BO,BQ,BR,BS,BT,BV,BW,BY,BZ,CA,CC,CD,CF,CG,CH,CI,CK,CL,CM,CN,CO,CR,CU,CV,CW,CX,CY,CZ,DE,DJ,DK,DM,DO,DZ,EC,EE,EG,EH,ER,ES,ET,FI,FJ,FK,FM,FO,FR,GA,GB,GD,GE,GF,GG,GH,GI,GL,GM,GN,GP,GQ,GR,GS,GT,GU,GW,GY,HK,HM,HN,HR,HT,HU,ID,IE,IL,IM,IN,IO,IQ,IR,IS,IT,JE,JM,JO,JP,KE,KG,KH,KI,KM,KN,KP,KR,KW,KY,KZ,LA,LB,LC,LI,LK,LR,LS,LT,LU,LV,LY,MA,MC,MD,ME,MF,MG,MH,MK,ML,MM,MN,MO,MP,MQ,MR,MS,MT,MU,MV,MW,MX,MY,MZ,NA,NC,NE,NF,NG,NI,NL,NO,NP,NR,NU,NZ,OM,PA,PE,PF,PG,PH,PK,PL,PM,PN,PR,PS,PT,PW,PY,QA,RE,RO,RS,RU,RW,SA,SB,SC,SD,SE,SG,SH,SI,SJ,SK,SL,SM,SN,SO,SR,SS,ST,SV,SX,SY,SZ,TC,TD,TF,TG,TH,TJ,TK,TL,TM,TN,TO,TR,TT,TV,TW,TZ,UA,UG,UM,US,UY,UZ,VA,VC,VE,VG,VI,VN,VU,WF,WS,YE,YT,ZA,ZM,ZW'.split(
    ',',
  );

export const COUNTRY_CODES = Object.freeze(CODES);

export const isCountryCode = (code) => CODES.includes(code);

/** 'ES' -> 'Spain'. Falls back to the code itself if the runtime has no name. */
export function countryName(code, locale) {
  if (!code) return '';
  try {
    return (
      new Intl.DisplayNames([locale ?? navigator.language], { type: 'region' }).of(code) ?? code
    );
  } catch {
    return code;
  }
}

/**
 * 'ES' -> 🇪🇸, built from regional indicator symbols.
 *
 * Whether it appears as a flag depends on the platform: macOS, iOS, Linux and
 * Android draw one, and Windows deliberately does not — it renders the two
 * letters instead. Both are legible, and both beat inventing a bitmap set for
 * 249 countries.
 */
export function countryFlag(code) {
  if (!isCountryCode(code)) return '';
  return String.fromCodePoint(...[...code].map((letter) => 0x1f1a5 + letter.charCodeAt(0)));
}

/** Codes sorted by their name in the reader's language. */
export function countriesByName(locale) {
  return CODES.map((code) => ({ code, name: countryName(code, locale) })).sort((a, b) =>
    a.name.localeCompare(b.name, locale),
  );
}
