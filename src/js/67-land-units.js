/* ==========================================================================
   LAND AND FLOOR AREA — THE UNITS SARAWAK ACTUALLY DEALS IN
   --------------------------------------------------------------------------
   This product measured everything in square feet, because that is what a
   condominium brochure quotes. It is the wrong unit for half the transactions
   it is meant to help with.

   A Sarawak land dealing is quoted in POINTS. A point is one hundredth of an
   acre — 435.6 square feet, 40.4686 square metres — and it is the unit that
   appears on the title, in the agent's listing and in the conversation. A tool
   that cannot say "RM4,200 a point" is asking a landowner to do arithmetic
   before they can check their own deal.

   Square metres matter for a different reason: it is the unit a bank valuer,
   a quantity surveyor and every non-Malaysian comparison uses, and the one
   figure a reader is most likely to be asked for by someone outside the state.

   SO THE UNIT IS RECORDED, NOT ASSUMED.

   Every area is stored in square feet — one internal unit, so nothing has to
   be converted twice — but the unit the reader TYPED is stored beside it. A
   parcel entered as 12 points is redisplayed as 12 points, not as 5,227.2
   square feet, because a figure that comes back in a different unit from the
   one it went in as reads like the tool corrected you.

   EXACT FACTORS, NOT ROUNDED ONES.

   1 acre  = 43,560 sq ft exactly (an international acre, by definition)
   1 point = 1/100 acre = 435.6 sq ft exactly
   1 sq ft = 0.09290304 m² exactly (from the international foot, 0.3048 m)
   so 1 point = 40.468564224 m², and 1 hectare = 107,639.10416... sq ft

   The rounded 40.47 m² that circulates in listings is fine for conversation
   and wrong for a register: applied to a 60-point parcel it moves the area by
   nearly a square metre, and every price-per-unit derived from it inherits the
   error. Nothing here rounds until it is displayed.
   ========================================================================== */

const SQFT_PER_ACRE = 43560;              /* exact, by definition */
const SQFT_PER_POINT = SQFT_PER_ACRE / 100;   /* 435.6 exactly */
const SQM_PER_SQFT = 0.09290304;          /* exact, from the international foot */

const AREA_UNITS = [
  { id: 'sqft', label: 'square feet', short: 'sq ft', per: 1, dp: 0,
    why: 'What a brochure quotes for built-up area.' },
  { id: 'sqm', label: 'square metres', short: 'm²', per: 1 / SQM_PER_SQFT, dp: 1,
    why: 'What a valuer, a surveyor and every comparison outside Malaysia uses.' },
  { id: 'point', label: 'points', short: 'pt', per: SQFT_PER_POINT, dp: 2,
    why: 'One hundredth of an acre. The unit a Sarawak land dealing is quoted in.' },
  { id: 'acre', label: 'acres', short: 'ac', per: SQFT_PER_ACRE, dp: 3,
    why: 'Larger parcels, and what a point is defined against.' },
  { id: 'hectare', label: 'hectares', short: 'ha', per: 10000 / SQM_PER_SQFT, dp: 4,
    why: 'Plantation and estate scale. Used on gazette notices.' },
];
const AREA_UNIT_BY_ID = Object.fromEntries(AREA_UNITS.map(u => [u.id, u]));
const areaUnit = (id) => AREA_UNIT_BY_ID[id] || AREA_UNITS[0];

/* `per` is square feet per one of that unit, so both directions are one
   multiply and no conversion goes through a third unit picking up error. */
const toSqft = (v, unit) => (isNum(v) ? v * areaUnit(unit).per : null);
const fromSqft = (sqft, unit) => (isNum(sqft) ? sqft / areaUnit(unit).per : null);
const convertArea = (v, from, to) => fromSqft(toSqft(v, from), to);

function fmtArea(v, unit, { long = false } = {}) {
  if (!isNum(v)) return '—';
  const u = areaUnit(unit);
  return `${fmtNum(v, u.dp)} ${long ? u.label : u.short}`;
}

/* An area held in square feet, shown in whichever unit is being read. */
const fmtAreaFromSqft = (sqft, unit, opts) => fmtArea(fromSqft(sqft, unit), unit, opts);

/* PRICE PER UNIT OF AREA.
   Returns null rather than Infinity or NaN when the area is missing or zero —
   a price per square foot of a parcel whose size nobody recorded is not a large
   number, it is an unanswerable question, and this codebase withholds those. */
function pricePerArea(price, sqft, unit) {
  if (!isNum(price) || !isNum(sqft) || sqft <= 0) return null;
  const inUnit = fromSqft(sqft, unit);
  return inUnit > 0 ? price / inUnit : null;
}

/* Sensible decimal places for a rate: RM/point runs to thousands and wants
   none, RM/m² to hundreds and wants none, RM/sq ft to tens and wants one. */
const rateDp = (unit) => (unit === 'sqft' ? 1 : 0);
const fmtRate = (price, sqft, unit, ccy = 'MYR') => {
  const r = pricePerArea(price, sqft, unit);
  return isNum(r) ? `${fmtMoney(r, ccy, rateDp(unit))}/${areaUnit(unit).short}` : '—';
};

/* THE UNITS A GIVEN THING IS SENSIBLY MEASURED IN.
   A 1,050 sq ft apartment is 2.4 points, which is a true statement and a
   useless one; a 3-acre parcel in square feet is 130,680, which nobody says out
   loud. So the offer is narrowed by what is being measured rather than showing
   all five everywhere and letting the reader find the two that help. */
const BUILT_UP_UNITS = ['sqft', 'sqm'];
const LAND_UNITS = ['point', 'acre', 'sqft', 'sqm', 'hectare'];

/* One line stating the conversion, so the number is checkable rather than
   trusted. Shown wherever a point figure is displayed for the first time. */
const POINT_DEFINITION =
  'A point is one hundredth of an acre — 435.6 sq ft, or 40.4686 m². '
  + 'It is the unit Sarawak land dealings are quoted in and the one that appears on the title.';
