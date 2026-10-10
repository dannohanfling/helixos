/**
 * The leaderboard walk's eLoyalty customers (rev 639): invented people in the shape the WalletPush REST API documents, with
 * the fields that must never reach a feed (email, phone, serial, pass link) and every kind that must be left out.
 */
export const ELOYALTY_KEY = "elk_walk_admin_key_7f3a9c2e5b1d4f60";
export const TEMPLATES = [
  { id: "89fd70bc-1111-4222-8333-944455556666", name: "Legacy - The Compounding Kindness Pass" },
  { id: "bc3fe237-aaaa-4bbb-8ccc-ddddeeeeffff", name: "Compounding Kindness Pass redesign" },
  { id: "0f0f0f0f-0000-4000-8000-000000000000", name: "Test" },
];
const c = (id: string, first: string, last: string, earned: number, balance: number, tier: string | null, active = true) => ({ id, first_name: first, last_name: last, email: `${first.toLowerCase()}.${id}@example.com`, phone: "+15550001234", serial: `SER-${id}`, pass_url: `https://pass.example/${id}`, points_earned: earned, points_balance: balance, membership_tier: tier, is_active: active, template_id: TEMPLATES[0].id });
/** Two pages' worth, so paging by cursor is walked. */
export const CUSTOMERS = [
  c("cus_001", "maria jose", "santos", 2450, 900, "Gold"),
  c("cus_002", "Ben", "Okafor", 1300, 300, "Silver"),
  c("cus_003", "Ina", "Lund", 900, 10, null),
  c("cus_004", "Old", "Member", 5000, 0, "Gold", false),
  c("cus_005", "Zero", "Points", 0, 0, null),
  c("cus_006", "John", "Doe", 100, 100, null),
  c("cus_007", "Tess", "Testing", 100, 100, null),
  c("cus_008", "Rafa", "Diaz", 640, 640, "Bronze"),
];
