import { normalisePhone } from "./phone";

/**
 * Weighted duplicate scoring — presentation helpers + algorithm contract tests.
 *
 * **Source of truth for production scoring is Postgres**
 * (`private.duplicate_match` in supabase/migrations/*_merge_and_scoring_functions.sql
 * and the prefilter rewrite of `find_possible_duplicates`).
 *
 * Live UI banners use server-returned `match_score` / `match_tier` / `match_reasons`.
 * `scorePair` exists so unit tests lock the weight/tier contract; do not re-score
 * patients in the client for business decisions.
 *
 * Weights:
 *   identity document match  -> decisive: always "likely"
 *   full name match          +3
 *   date of birth match      +3
 *   email match              +2
 *   phone match              +1
 *   address match            +1
 *
 * Tiers: likely  = identity match, or name + date of birth, or score >= 6
 *        possible = score 2..5 across AT LEAST TWO matching fields.
 */

export type MatchSide = {
  first_names: string;
  surname: string;
  date_of_birth: string;
  phone: string;
  email: string | null;
  residential_address: string;
};

export type DuplicateTier = "likely" | "possible" | "none";

export type MatchResult = {
  score: number;
  tier: DuplicateTier;
  reasons: string[];
};

function stripDiacritics(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

export function normaliseName(value: string): string {
  return stripDiacritics(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function normaliseAddress(value: string): string {
  return stripDiacritics(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Algorithm contract (tests only). Production scoring runs in SQL. */
export function scorePair(a: MatchSide, b: MatchSide, identityMatch = false): MatchResult {
  const sameName =
    normaliseName(a.first_names) === normaliseName(b.first_names) &&
    normaliseName(a.surname) === normaliseName(b.surname);
  const sameDob = a.date_of_birth === b.date_of_birth;
  const sameEmail = Boolean(
    a.email && b.email && a.email.trim().toLowerCase() === b.email.trim().toLowerCase(),
  );
  const samePhone =
    normalisePhone(a.phone).length > 0 && normalisePhone(a.phone) === normalisePhone(b.phone);
  const sameAddress = normaliseAddress(a.residential_address) === normaliseAddress(b.residential_address);

  const score =
    (sameName ? 3 : 0) + (sameDob ? 3 : 0) + (sameEmail ? 2 : 0) + (samePhone ? 1 : 0) + (sameAddress ? 1 : 0);
  const fieldsMatched =
    Number(sameName) + Number(sameDob) + Number(sameEmail) + Number(samePhone) + Number(sameAddress);

  const reasons: string[] = [];
  if (identityMatch) reasons.push("identity number");
  if (sameName) reasons.push("name");
  if (sameDob) reasons.push("date of birth");
  if (sameEmail) reasons.push("email");
  if (samePhone) reasons.push("phone");
  if (sameAddress) reasons.push("address");

  const tier: DuplicateTier =
    identityMatch || (sameName && sameDob) || score >= 6
      ? "likely"
      : score >= 2 && fieldsMatched >= 2
        ? "possible"
        : "none";

  return { score, tier, reasons };
}

export function tierLabel(tier: DuplicateTier): string {
  return tier === "likely" ? "Likely duplicate" : tier === "possible" ? "Possible duplicate" : "No match";
}

function humanJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Banner copy from server-provided score payload: "Likely duplicate — same name, date of birth and address". */
export function matchBanner(result: Pick<MatchResult, "tier" | "reasons"> & { score?: number }): string {
  const label = tierLabel(result.tier === "none" ? "possible" : result.tier);
  return result.reasons.length
    ? `${label} — same ${humanJoin(result.reasons)}`
    : `${label} — matching details found during registration`;
}

type FingerprintSide = MatchSide & {
  identity_type: string;
  identity_number?: string | null;
  identity_country?: string | null;
};

function sideFingerprint(side: FingerprintSide): string {
  return [
    normaliseName(side.first_names),
    normaliseName(side.surname),
    side.date_of_birth,
    normalisePhone(side.phone),
    (side.email ?? "").trim().toLowerCase(),
    normaliseAddress(side.residential_address),
    side.identity_type,
    (side.identity_number ?? "").trim().toUpperCase(),
    (side.identity_country ?? "").toUpperCase(),
  ].join("|");
}

/**
 * Order-insensitive fingerprint of matched fields for unit tests.
 * Production keep-both fingerprints are MD5'd in SQL (`private.pair_match_fingerprint`).
 * Equality of this helper tracks field changes the same way the DB re-opens pairs.
 */
export function pairMatchFingerprint(a: FingerprintSide, b: FingerprintSide): string {
  const [first, second] = [sideFingerprint(a), sideFingerprint(b)].sort();
  return `${first}||${second}`;
}
