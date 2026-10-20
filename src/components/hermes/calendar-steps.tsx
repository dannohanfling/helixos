"use client";

import { useActionState, useState } from "react";
import { testCalendarsAction, writeCalendarsAction, type TestState, type WriteState } from "@/lib/hermes/calendars-actions";
import { SubmitButton } from "@/components/submit-button";

/** Steps 2 and 3 of Coach → Booking calendars: the two buttons Danno presses, and what came back. */
export function CalendarWrite({ users }: { users: { id: string; name: string }[] }) {
  const [state, action] = useActionState<WriteState, FormData>(writeCalendarsAction, null);
  // Held here, not in the form: React clears a form after its action, and a refusal shouldn't make Danno pick again.
  const [userId, setUserId] = useState("");
  const [sure, setSure] = useState(false);
  return (
    <form action={action} className="space-y-3" data-testid="cal-write-form">
      <label className="block">
        <span className="label">Which user are you?</span>
        <select name="userId" className="input min-h-[44px]" value={userId} onChange={(e) => setUserId(e.target.value)} required data-testid="cal-user">
          <option value="" disabled>
            Pick yourself
          </option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </label>
      {users.length ? null : <p className="text-sm text-warn" data-testid="cal-no-users">GoHighLevel didn&apos;t list the sub-account&apos;s users, so there&apos;s nobody to pick. Your key needs users.readonly too.</p>}
      <label className="flex min-h-[44px] items-center gap-2 text-sm">
        <input type="checkbox" name="sure" checked={sure} onChange={(e) => setSure(e.target.checked)} data-testid="cal-sure" /> I&apos;ve read the fields above. Write them to GoHighLevel.
      </label>
      <SubmitButton pendingText="Writing…" data-testid="cal-write">
        Write Academy Conversation and Elite Conversation
      </SubmitButton>
      {state && !state.ok ? (
        <p className="text-sm text-danger" role="alert" data-testid="cal-write-error">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <ul className="space-y-2 text-sm" data-testid="cal-written">
          {state.rows.map((r) => (
            <li key={r.id} className="rounded-lg border border-line p-3" data-testid={`cal-written-${r.name.split(" ")[0].toLowerCase()}`}>
              <div className="font-semibold">
                {r.name}: {r.made ? "created" : "updated"}
              </div>
              <div className="break-all text-ink-2">Id: {r.id}</div>
              <div className="break-all">
                Booking link: <a href={r.link} target="_blank" rel="noreferrer">{r.link}</a>
              </div>
              <div className="break-all text-ink-3">By its slug: {r.slugLink}</div>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

export function CalendarTest() {
  const [state, action] = useActionState<TestState, FormData>(testCalendarsAction, null);
  const [contactId, setContactId] = useState("");
  return (
    <form action={action} className="space-y-3" data-testid="cal-test-form">
      <label className="block">
        <span className="label">Test contact&apos;s GoHighLevel id (from the booking follow-up notes, not a member)</span>
        <input name="contactId" value={contactId} onChange={(e) => setContactId(e.target.value)} className="input min-h-[44px]" maxLength={40} autoComplete="off" spellCheck={false} data-testid="cal-contact" />
      </label>
      <SubmitButton pendingText="Booking and cancelling…" data-testid="cal-test">
        Book one test call on each, then cancel both
      </SubmitButton>
      {state && !state.ok ? (
        <p className="text-sm text-danger" role="alert" data-testid="cal-test-error">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <ul className="space-y-2 text-sm" data-testid="cal-tested">
          {state.rows.map((r) => (
            <li key={r.calendarId} className="rounded-lg border border-line p-3" data-testid={`cal-tested-${r.name.split(" ")[0].toLowerCase()}`}>
              <div className="font-semibold">{r.name}</div>
              <div>Booking: {r.appointmentId ? `made (${r.appointmentId})` : "not made"}{r.slot ? `, for ${r.slot}` : ""}</div>
              <div>Zoom link: {r.zoom ? `yes, ${r.zoom}` : "none came back"}</div>
              <div>Cancelled: {r.cancelled ? "yes" : "no"}</div>
              {r.error ? <div className="text-danger">{r.error}</div> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
