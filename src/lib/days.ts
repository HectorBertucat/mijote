// Jours civils (AAAA-MM-JJ) ↔ nombre de jours depuis le 1er janvier 1970, sans objet Date : les séries de
// Santé et les axes des graphiques en parcourent des milliers par page (un historique de plusieurs années),
// et un objet Date par jour se paie. Arithmétique des jours civils de H. Hinnant. Pur.

/** Le jour civil du jour `n` depuis le 1er janvier 1970 (négatif avant). */
export function dayString(n: number): string {
  const z = n + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${String(y).padStart(4, "0")}-${m < 10 ? "0" : ""}${m}-${d < 10 ? "0" : ""}${d}`;
}

/** Le jour de la semaine du jour `n` (0 dimanche … 6 samedi, comme getUTCDay) ; le 1er janvier 1970 est un jeudi. */
export const weekdayOf = (n: number) => (((n + 4) % 7) + 7) % 7;
