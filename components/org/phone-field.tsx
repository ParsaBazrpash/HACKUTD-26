"use client";

import { fieldChrome } from "@/components/incidents/form-ui";
import { PHONE_PREFIX, usPhoneDigits } from "@/components/org/org-link";

/** Phone input with a fixed, uneditable +1. The caller keeps only the typed digits. */
export function PhoneField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (digits: string) => void;
}) {
  return (
    <div className="flex items-stretch gap-2">
      <span
        aria-hidden="true"
        className={`${fieldChrome} flex w-14 shrink-0 select-none items-center justify-center text-muted`}
      >
        {PHONE_PREFIX}
      </span>
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        value={value}
        required
        placeholder="5555550123"
        autoComplete="tel-national"
        maxLength={32}
        aria-label="Phone number, +1 is added for you"
        onChange={(event) => onChange(usPhoneDigits(event.target.value))}
        className={`${fieldChrome} min-w-0 flex-1`}
      />
    </div>
  );
}
