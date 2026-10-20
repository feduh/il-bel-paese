import { describe, it, expect } from "vitest";
import { firstReviewSlot, isValidReviewDate, romeToDate, romeParts } from "../reviewWindow";

describe("finestra di revisione 24h", () => {
  it("propone il primo slot da 30 minuti dopo invio + 24h", () => {
    const now = new Date("2026-10-20T10:07:00Z");
    expect(firstReviewSlot(now).toISOString()).toBe("2026-10-21T10:30:00.000Z");
  });

  it("se invio + 24h cade già su uno slot lo usa", () => {
    const now = new Date("2026-10-20T10:30:00Z");
    expect(firstReviewSlot(now).toISOString()).toBe("2026-10-21T10:30:00.000Z");
  });

  it("rifiuta una data a meno di 24 ore dall'invio", () => {
    const sub = new Date("2026-10-20T10:00:00Z");
    expect(isValidReviewDate(new Date("2026-10-21T09:30:00Z"), sub)).toBe(false);
    expect(isValidReviewDate(new Date("2026-10-21T10:00:00Z"), sub)).toBe(true);
  });

  it("rifiuta orari fuori dagli slot da 30 minuti", () => {
    const sub = new Date("2026-10-20T10:00:00Z");
    expect(isValidReviewDate(new Date("2026-10-22T10:15:00Z"), sub)).toBe(false);
  });

  it("converte l'ora italiana in UTC a cavallo del cambio d'ora", () => {
    // Fine ora legale: 25 ottobre 2026
    expect(romeToDate("2026-10-24", "12:00").toISOString()).toBe("2026-10-24T10:00:00.000Z");
    expect(romeToDate("2026-10-26", "12:00").toISOString()).toBe("2026-10-26T11:00:00.000Z");
    expect(romeParts(new Date("2026-10-26T11:00:00Z"))).toEqual({ date: "2026-10-26", time: "12:00" });
  });

  it("le 24 ore valgono come durata assoluta anche col cambio d'ora", () => {
    // invio sabato 24/10 12:00 italiane (10:00Z) → prima data utile 10:00Z del 25 = 11:00 italiane
    const slot = firstReviewSlot(new Date("2026-10-24T10:00:00Z"));
    expect(romeParts(slot)).toEqual({ date: "2026-10-25", time: "11:00" });
  });
});
