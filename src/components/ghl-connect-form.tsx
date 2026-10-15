"use client";

import { useState } from "react";
import { Field } from "./ui";
import { SubmitButton } from "@/components/submit-button";
import { GHL_HELP } from "@/lib/engine/connect-copy";
import { LOCATION_SHAPE, isLocationId } from "@/lib/engine/ghl-location";

/**
 * The key and the Location ID boxes (H-240): the Location ID's shape is checked as it is typed, the line under the box says
 * what it should be, and Connect stays off until it passes, so a browser's autofill (an email address) never reaches
 * GoHighLevel. Autofill is off on both boxes. The action checks the shape again before any call.
 */
export function GhlConnectForm({ action, locationId, hasToken, ghlUserId }: { action: (formData: FormData) => Promise<void>; locationId: string; hasToken: boolean; ghlUserId: string }) {
  const [location, setLocation] = useState(locationId);
  const trimmed = location.trim();
  const shapeOk = isLocationId(trimmed);
  return (
    <form action={action} className="space-y-3 text-sm" data-testid="ghl-connect-form">
      <Field label="Your GoHighLevel key" hint="Stored encrypted. Never shown again.">
        <input className="field" name="manualToken" type="password" autoComplete="off" data-1p-ignore="true" data-lpignore="true" placeholder="pit-…" required={!hasToken} data-testid="ghl-token" />
      </Field>
      <Field label="Location ID" hint={GHL_HELP.location}>
        <input
          className={`field${trimmed && !shapeOk ? " border-danger" : ""}`}
          name="locationId"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          required
          autoComplete="off"
          data-1p-ignore="true"
          data-lpignore="true"
          spellCheck={false}
          placeholder="ve9EPM428h8vShlRW1KT"
          aria-invalid={trimmed && !shapeOk ? true : undefined}
          aria-describedby={trimmed && !shapeOk ? "ghl-location-shape" : undefined}
          data-testid="ghl-location"
        />
        {trimmed && !shapeOk ? (
          <span id="ghl-location-shape" className="mt-1 block text-xs text-danger" role="alert" data-testid="ghl-location-shape">
            {LOCATION_SHAPE}
          </span>
        ) : null}
      </Field>
      <input type="hidden" name="ghlUserId" value={ghlUserId} />
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton className="btn btn-primary btn-sm" pendingText="Connecting…" disabled={!shapeOk} data-testid="ghl-connect">
          Connect
        </SubmitButton>
        <span className="text-xs text-ink-3">One small test call, and you&apos;ll know right away.</span>
      </div>
    </form>
  );
}
