import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isAllowed, ownerEmails } from "./auth-policy";

/**
 * The allowlist is the authorisation boundary for this app.
 *
 * It matters more than usual here because the Supabase project is SHARED with a
 * separate live application that has its own real users. Those users can obtain
 * a completely valid session for this project, so "is there a session?" is not
 * a sufficient check -- if this list is wrong, every user of that other
 * application has an account on the betting terminal.
 */
describe("access allowlist", () => {
  const original = process.env.DIAMONDS_OWNER_EMAILS;

  beforeEach(() => {
    delete process.env.DIAMONDS_OWNER_EMAILS;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.DIAMONDS_OWNER_EMAILS;
    else process.env.DIAMONDS_OWNER_EMAILS = original;
  });

  it("FAILS CLOSED when unconfigured", () => {
    // The single most important case. A missing or empty variable is far more
    // likely to be a broken deploy than an intention to admit everyone, and
    // guessing wrong hands a stranger the bet log.
    expect(isAllowed("anyone@example.com")).toBe(false);

    process.env.DIAMONDS_OWNER_EMAILS = "";
    expect(isAllowed("anyone@example.com")).toBe(false);

    process.env.DIAMONDS_OWNER_EMAILS = "   ,  , ";
    expect(isAllowed("anyone@example.com")).toBe(false);
    expect(ownerEmails()).toEqual([]);
  });

  it("admits only listed addresses", () => {
    process.env.DIAMONDS_OWNER_EMAILS = "owner@example.com";
    expect(isAllowed("owner@example.com")).toBe(true);
    // A user of the other application sharing this Supabase project.
    expect(isAllowed("someone.else@example.com")).toBe(false);
  });

  it("is case-insensitive on both sides", () => {
    // Email addresses are not case-sensitive in practice, and an allowlist that
    // treats them as such is trivially bypassed in the other direction: the
    // owner simply cannot log in.
    process.env.DIAMONDS_OWNER_EMAILS = "Owner@Example.COM";
    expect(isAllowed("owner@example.com")).toBe(true);
    expect(isAllowed("OWNER@EXAMPLE.COM")).toBe(true);
  });

  it("handles a multi-address list with untidy spacing", () => {
    process.env.DIAMONDS_OWNER_EMAILS = " a@x.com , b@y.com ,c@z.com ";
    expect(ownerEmails()).toEqual(["a@x.com", "b@y.com", "c@z.com"]);
    expect(isAllowed("b@y.com")).toBe(true);
    expect(isAllowed("d@w.com")).toBe(false);
  });

  it("rejects missing, empty and malformed identities", () => {
    process.env.DIAMONDS_OWNER_EMAILS = "owner@example.com";
    expect(isAllowed(null)).toBe(false);
    expect(isAllowed(undefined)).toBe(false);
    expect(isAllowed("")).toBe(false);
    // A near-miss must not pass: no prefix, suffix or substring matching.
    expect(isAllowed("owner@example.com.attacker.net")).toBe(false);
    expect(isAllowed("xowner@example.com")).toBe(false);
    expect(isAllowed("owner@example.co")).toBe(false);
  });
});
