/**
 * A GoHighLevel Location ID (H-240): letters and digits, about 20 of them, no "@", no spaces. Joseph's box held his email
 * address (the browser's autofill), so every test call went to a location that doesn't exist. Checked in the browser before
 * Connect is live, and again in the action before any call is made. The rule is the shape GoHighLevel's ids have (and the
 * walks' fixture ids keep): one run of letters, digits, "-" or "_", six to forty long; an address, a name or an email never is.
 */
export const LOCATION_ID = /^[A-Za-z0-9_-]{6,40}$/;

export const isLocationId = (s: string): boolean => LOCATION_ID.test(s.trim());

export const LOCATION_SHAPE = "That's not a Location ID. In GoHighLevel: Settings → Business Profile → Location ID (copy button).";
