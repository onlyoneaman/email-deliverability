import { describe, expect, test } from "bun:test";
import { MESSAGE_CODES, SUPPORTED_LOCALES, formatMessage } from "../src/locale.js";

describe("locale dictionaries", () => {
  test("every supported locale has every stable message code", () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const code of MESSAGE_CODES) {
        expect(formatMessage(code, locale)).not.toBe(code);
      }
    }
  });

  test("non-English supported locales are not English aliases", () => {
    for (const locale of SUPPORTED_LOCALES.filter((entry) => entry !== "en")) {
      expect(formatMessage("email.validation.failed", locale)).not.toBe(
        formatMessage("email.validation.failed", "en"),
      );
    }
  });

  test("region and unsupported locale fallback behavior is stable", () => {
    expect(formatMessage("email.syntax.too_many_at", "es-MX")).toBe(
      formatMessage("email.syntax.too_many_at", "es"),
    );
    expect(formatMessage("email.syntax.too_many_at", "zz-ZZ")).toBe(
      formatMessage("email.syntax.too_many_at", "en"),
    );
  });
});
