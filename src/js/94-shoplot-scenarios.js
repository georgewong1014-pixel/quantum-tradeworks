/* ==========================================================================
   SHOPLOT STARTING SCENARIOS — SARAWAK (the owner, 1 Nov 2026: "Integrate
   this as Quantum Tradeworks default strategies for shop lots in Sarawak")
   --------------------------------------------------------------------------
   Three starting points for a 3-storey shoplot in each of five towns, opened
   in the Scenario Lab as A, B and C. A starting point, never advice: nothing
   here ranks a column, marks one out or says where to buy, and every figure
   is one of two kinds, said where it is shown —
     · from NAPIC's H1 2025 file: the middle of the schemes NAPIC sampled
       (the median of each scheme's midpoint), with the lowest and highest
       beside it and the number of schemes — schemes, never transactions;
     · illustrative: this tool's assumption, chosen by nobody for any
       property — rooms, room rents, vacancies, fit-out, compliance, the
       financing.
   Column A is always the conventional let (the shop and two office floors
   at NAPIC's figures), so every comparison has the plain case beside it.

   ONE RENT FOR THE BUILDING (the owner, 1 Nov 2026: option (a)). dealModel
   holds one rent and one vacancy allowance, and nothing here changes it:
   each column's parts are added into one rent, utilities and Wi-Fi taken off
   the room line's rent first (the calculator has no line for them), and
   their vacancies into the one allowance that gives the same rent after
   vacancy, to the hundredth of a per cent. The parts are listed beside the
   column (shoplotLabCard).

   LOADED AS THE SAMPLE IS. A scenario is a deal nobody has touched, so every
   figure reads Illustrative until the reader changes it, and none is marked
   theirs; NAPIC's figures are never tagged `public` (which reads as Yours).
   Column A is given to the calculator through propertyLoad, so a deal of
   the reader's not saved is kept aside first ("Restore my previous deal"),
   and nothing is written to a saved property until the reader saves.

   model-test (shoplot) recomputes every NAPIC figure below from
   data/napic-h1-2025.json, so the two cannot drift apart.
   ========================================================================== */

/* THE NAPIC FIGURES, H1 2025. Per town: the 3-storey shop's price (and the
   middle of its schemes' floor areas), the ground-floor shop's rent and the
   office-in-shop rent per floor, each for the area class named.
   THE ROW RULE (the owner, 1 Nov 2026): a "Prices of Shop · THREE STOREY
   SHOP" row whose floor area is under 200 m² or over 1,500 m² is left out,
   as not comparable to a whole 3-storey shoplot — it leaves out Kuching's
   Jalan Kwong Lee Bank (4,800 m²), Bintulu's One Garden City Residence
   (108.5 m²) and Miri's Miri Times Square (85 m²). Before the rule the
   middle was Kuching RM1,150,000 (19 schemes), Bintulu RM900,000 (9) and
   Miri RM1,050,000 (8); Samarahan and Sibu lose no row. Rent rows are
   taken whole. */
const SHOPLOT_NAPIC_PERIOD = 'H1 2025';
const SHOPLOT_PRICE_FLOOR_SQM = [200, 1500];
const SHOPLOT_NAPIC = {
  kuching:   { division: 'Kuching',
    price:  { mid: 1175000, lo: 680000, hi: 2500000, schemes: 18, floorSqm: 388.5 },
    shop:   { area: 'SUBURBAN PRIME AREA', mid: 2500, lo: 1700, hi: 4200, schemes: 14 },
    office: { area: 'SUBURBAN PRIME AREA', mid: 1250, lo: 800, hi: 1800, schemes: 9 } },
  samarahan: { division: 'Samarahan',
    price:  { mid: 950000, lo: 900000, hi: 1390000, schemes: 3, floorSqm: 344 },
    shop:   { area: 'SUBURBAN PRIME AREA', mid: 2050, lo: 1200, hi: 3300, schemes: 13 },
    office: { area: 'SUBURBAN PRIME AREA', mid: 850, lo: 500, hi: 1800, schemes: 7 } },
  sibu:      { division: 'Sibu',
    price:  { mid: 950000, lo: 700000, hi: 1250000, schemes: 7, floorSqm: 329 },
    shop:   { area: 'CENTRAL TOWN SECONDARY AREA', mid: 2075, lo: 1200, hi: 3000, schemes: 10 },
    office: { area: 'CENTRAL TOWN SECONDARY AREA', mid: 850, lo: 600, hi: 1200, schemes: 4 } },
  bintulu:   { division: 'Bintulu',
    price:  { mid: 975000, lo: 450000, hi: 1770000, schemes: 8, floorSqm: 354.57 },
    shop:   { area: 'SUBURBAN PRIME AREA', mid: 2650, lo: 1800, hi: 3600, schemes: 7 },
    office: { area: 'CENTRAL TOWN PRIME AREA', mid: 1300, lo: 900, hi: 2300, schemes: 9 } },
  miri:      { division: 'Miri',
    price:  { mid: 1150000, lo: 562500, hi: 2659200, schemes: 7, floorSqm: 326.43 },
    shop:   { area: 'CENTRAL TOWN PRIME AREA', mid: 2900, lo: 2500, hi: 8800, schemes: 5 },
    office: { area: 'CENTRAL TOWN PRIME AREA', mid: 1200, lo: 600, hi: 2500, schemes: 11 } },
};
const SHOPLOT_SQFT_PER_SQM = 10.7639;
const shoplotAreaWords = (a) => String(a || '').toLowerCase().replace(/ area$/, '').replace('central town', 'central-town');

/* THE ILLUSTRATIVE ASSUMPTIONS, each said where it is used. */
const SHOPLOT_ILLUS = {
  shopVacancyPct: 10,             /* a shop or office floor let to a tenant */
  utilitiesPerRoom: 60,           /* RM a room a month, owner-paid */
  wifi: 150,                      /* RM a month, owner-paid */
  fitOutPerFloor: 32500, fitOutRange: [25000, 40000],      /* converting a floor to rooms */
  compliance: 37500, complianceRange: [15000, 60000],      /* approvals and fire upgrades for the upper floors */
  furnishPerFloor: 8000,          /* furnishing for stays of a month to six */
  downPct: 20, ratePct: 4.8, tenureYears: 25,
};

/* ONE SENTENCE EACH, said once where it applies. */
const SHOPLOT_STATEMENT = 'Starting points built from the middle of the schemes NAPIC sampled in H1 2025 and illustrative assumptions — not a recommendation.';
const SHOPLOT_NOTES = {
  oneRent: 'The calculator holds one rent and one vacancy allowance for the building: the parts are added into one rent, and their vacancies into the allowance that gives the same rent after vacancy.',
  napic: `NAPIC figures are the middle of the schemes it sampled in ${SHOPLOT_NAPIC_PERIOD}, with the lowest and highest beside them — schemes, not transactions. Price rows under ${SHOPLOT_PRICE_FLOOR_SQM[0]} m² or over ${fmtNum(SHOPLOT_PRICE_FLOOR_SQM[1], 0)} m² of floor area are left out as not a whole 3-storey shoplot.`,
  partial: 'Cash required is partial: on a commercial property the fee rulebook leaves out the lines it has not checked for the class, and names them.',
  finance: `Financing is illustrative: a ${100 - SHOPLOT_ILLUS.downPct}% loan over ${SHOPLOT_ILLUS.tenureYears} years at ${SHOPLOT_ILLUS.ratePct}% — the calculator holds no commercial lender’s terms, so enter the ones you are offered.`,
  costs: 'Assessment, quit rent and insurance are the calculator’s defaults, written for a condominium: replace them with the council’s and the insurer’s figures. No maintenance charge is entered — a shoplot on its own title has no strata fee (illustrative).',
  utilities: `Utilities and Wi-Fi (RM${SHOPLOT_ILLUS.utilitiesPerRoom} a room and RM${SHOPLOT_ILLUS.wifi} a month, illustrative) are taken off the room rent before it is added in: the calculator has no line for them.`,
  compliance: 'Rooms upstairs need the council’s change-of-use approval (amended plans and an occupation permit) and a Bomba fire certificate or support letter; nightly stays also need a lodging or hotel licence, and 21 rooms or more make it a Bomba designated premises. Check with the council and Bomba before buying.',
  noConversion: 'No conversion is entered: tenants fit out their own floors (illustrative).',
  lodge: 'A budget lodge is an operating business — nightly rates, booking-site commission, staff — which this tool does not model. Here it is a long let of the upper floors to an operator, at NAPIC’s office-in-shop figure as a stand-in.',
  laundry: 'The laundry is a business you would run: its takings and costs are not modelled. The ground floor is entered at the rent a tenant would pay for it — what the floor gives up.',
  anchor: 'The anchor’s rent is NAPIC’s ground-floor figure: no premium for a clinic or pharmacy is assumed.',
  company: 'One company tenant: if it leaves, both upper floors are empty at once — the lease-down in the commercial section shows the months.',
  stays: 'Weekend and mid-stay income varies month to month: the figure is an illustrative monthly average, not a booking record.',
  dosm: 'DOSM district population, 2020–2026: Miri’s 20–34 group −4.6%.',
  curtin: 'Curtin lies in Miri’s suburbs: NAPIC’s suburban prime ground-floor figure there is RM2,350 — move the rent if the building is near it.',
  bintuluClasses: 'NAPIC has no office-in-shop figure for Bintulu’s suburban prime areas, so the ground floor is suburban prime and the offices central-town prime — different classes.',
};

/* The rooms on a floor of a 3-storey shoplot: four or five, illustrative. */
const SL_ROOMS_2F = 9, SL_ROOMS_1F = 4;
const slShop = (label = 'Ground-floor shop') => ({ label, napic: 'shop', vacancyPct: SHOPLOT_ILLUS.shopVacancyPct });
const slOffice = (label) => ({ label, napic: 'office', vacancyPct: SHOPLOT_ILLUS.shopVacancyPct });
const slOffices = () => [slOffice('First-floor office'), slOffice('Second-floor office')];
const slRooms = (label, rooms, per, range, vacancyPct) => ({ label, rooms, per, range, vacancyPct, utilities: true });
/* The works, by what they are: floors converted to rooms, the compliance
   for sleeping upstairs, and furnishing for short stays. */
const slWorks = (floors, { furnish = false } = {}) => ({ floors, compliance: floors > 0, furnish: furnish ? floors : 0 });

const SHOPLOT_TOWNS = [
  { id: 'kuching', name: 'Kuching', city: 'kuching', district: 'Batu Kawa', scenarios: [
    { key: 'A', title: 'Shop and two office floors', lines: [slShop(), ...slOffices()], works: slWorks(0), notes: ['noConversion'] },
    { key: 'B', title: 'Clinic or pharmacy below, co-living above', lines: [slShop('Ground floor — clinic or pharmacy'),
      slRooms('Co-living rooms, first and second floors', SL_ROOMS_2F, 500, [450, 550], 15)], works: slWorks(2), notes: ['anchor', 'utilities', 'compliance'] },
    { key: 'C', title: 'Anchor below, furnished mid-stay rooms above', lines: [slShop('Ground floor — anchor tenant'),
      slRooms('Furnished rooms for stays of 1–6 months, first and second floors', SL_ROOMS_2F, 700, [600, 800], 25)], works: slWorks(2, { furnish: true }), notes: ['anchor', 'utilities', 'compliance'] },
  ] },
  { id: 'samarahan', name: 'Samarahan', city: 'kota-samarahan', district: 'Samarahan town', scenarios: [
    { key: 'A', title: 'Shop and two office floors', lines: [slShop(), ...slOffices()], works: slWorks(0), notes: ['noConversion'] },
    { key: 'B', title: 'Your own self-service laundry below, co-living above', lines: [slShop('Ground floor — your laundry, at the rent it gives up'),
      slRooms('Co-living rooms, first and second floors', SL_ROOMS_2F, 425, [400, 450], 15)], works: slWorks(2), notes: ['laundry', 'utilities', 'compliance'] },
    { key: 'C', title: 'Convenience shop or café below, co-living above', lines: [slShop('Ground floor — convenience shop or café'),
      slRooms('Co-living rooms, first and second floors', SL_ROOMS_2F, 425, [400, 450], 15)], works: slWorks(2), notes: ['utilities', 'compliance'] },
  ] },
  { id: 'sibu', name: 'Sibu', city: 'sibu', district: 'Town centre', scenarios: [
    { key: 'A', title: 'Shop and two office floors', lines: [slShop(), ...slOffices()], works: slWorks(0), notes: ['noConversion'] },
    { key: 'B', title: 'Clinic, pharmacy or tuition below, rooms for students and hospital staff above', lines: [slShop('Ground floor — clinic, pharmacy or tuition'),
      slRooms('Rooms, first and second floors', SL_ROOMS_2F, 375, [350, 400], 15)], works: slWorks(2), notes: ['anchor', 'utilities', 'compliance'] },
    { key: 'C', title: 'Shop below, one office floor and one room floor', lines: [slShop(), slOffice('First-floor office'),
      slRooms('Rooms, second floor', SL_ROOMS_1F, 375, [350, 400], 15)], works: slWorks(1), notes: ['utilities', 'compliance'] },
  ] },
  { id: 'bintulu', name: 'Bintulu', city: 'bintulu', district: 'Town centre', scenarios: [
    { key: 'A', title: 'Shop and two office floors', lines: [slShop(), ...slOffices()], works: slWorks(0), notes: ['bintuluClasses', 'noConversion'] },
    { key: 'B', title: 'F&B below, upper floors leased to a company for staff', lines: [slShop('Ground floor — food and beverage'),
      { label: 'First and second floors, leased to a company for staff', floors: 2, per: 2300, range: [1800, 2800], vacancyPct: 10 }],
      works: slWorks(2), notes: ['company', 'compliance'] },
    { key: 'C', title: 'Shop below, a budget lodge of 20 rooms or fewer above, as a long let', lines: [slShop(),
      { label: 'First and second floors, let to a lodge operator', napic: 'office', floors: 2, vacancyPct: 10, standIn: true }],
      works: slWorks(2), notes: ['lodge', 'bintuluClasses', 'compliance'] },
  ] },
  { id: 'miri', name: 'Miri', city: 'miri', district: 'City centre', scenarios: [
    { key: 'A', title: 'City-centre shop and two office floors', lines: [slShop(), ...slOffices()], works: slWorks(0), notes: ['noConversion'] },
    { key: 'B', title: 'Shop below, weekend and weekday mid-stays above', lines: [slShop(),
      slRooms('Furnished rooms for weekend and weekday stays, first and second floors — a monthly figure', SL_ROOMS_2F, 900, [750, 1050], 35)],
      works: slWorks(2, { furnish: true }), notes: ['stays', 'utilities', 'compliance'] },
    { key: 'C', title: 'Shop below, rooms near Curtin above', lines: [slShop(),
      slRooms('Rooms, first and second floors', SL_ROOMS_2F, 450, [400, 500], 20)], works: slWorks(2), notes: ['dosm', 'curtin', 'utilities', 'compliance'] },
  ] },
];

/* ==========================================================================
   INDUSTRIAL STARTING SCENARIOS — SARAWAK (the owner, 1 Nov 2026: "integrate
   this as Quantum Tradeworks default strategies for industrial sites in
   Sarawak"). The same mechanism, labels and limits as the shoplots: three
   starting points a town, A always a whole unit on a long let; one rent for
   the building (option (a)); every figure untouched and Illustrative until
   the reader changes it. A commercial deal of the 'industrial' subtype.
   WHAT THE EVIDENCE HOLDS. NAPIC's H1 2025 file has industrial PRICES only —
   37 rows, no rents. Each price below is the middle of the schemes NAPIC
   sampled (the median of each scheme's midpoint), recomputed by model-test
   (industrial). The rents are illustrative: asking rents seen in public
   listings for Kuching, Oct 2026 (whole units about RM0.75–1.40 a sq ft a
   month, small subdivided units about RM1.80–2.70; no listing is named or
   copied); for the other four towns none was found, and the Kuching
   whole-unit low, RM0.75, stands in, said so.
   THE FLOOR AREA IS NAPIC'S. Its middle for Kuching's 2-storey semi-detached
   units is 205 m², about 2,207 sq ft, where warehouse listings run about
   4,000–18,000 sq ft. The rent is worked on NAPIC's own area; no larger
   area is assumed. */
const INDUSTRIAL_NAPIC = {
  kuching:   { division: 'Kuching',   semid: { type: 'DOUBLE STOREY SEMI-DETACHED', mid: 1250000, lo: 700000, hi: 1650000, schemes: 8, floorSqm: 205 } },
  samarahan: { division: 'Samarahan', semid: { type: 'DOUBLE STOREY SEMI-DETACHED', mid: 975000, lo: 900000, hi: 1080000, schemes: 4, floorSqm: 201.5 } },
  sibu:      { division: 'Sibu',      semid: { type: 'DOUBLE STOREY SEMI-DETACHED', mid: 1107500, lo: 850000, hi: 1280000, schemes: 2, floorSqm: 169 } },
  bintulu:   { division: 'Bintulu',   semid: { type: 'DOUBLE STOREY SEMI-DETACHED', mid: 1212500, lo: 1050000, hi: 2225000, schemes: 4, floorSqm: 168.86 } },
  miri:      { division: 'Miri',      semid: { type: 'DOUBLE STOREY SEMI-DETACHED', mid: 1000000, lo: 655000, hi: 1550000, schemes: 5, floorSqm: 271.685 },
    terrace: { type: 'DOUBLE STOREY TERRACE', mid: 620000, lo: 540000, hi: 700000, schemes: 2, floorSqm: 236.1675 } },
};
const INDUSTRIAL_TYPE_WORDS = { semid: '2-storey semi-detached industrial', terrace: '2-storey terraced industrial' };
/* RM a sq ft a month, illustrative. */
const INDUSTRIAL_RENT = {
  whole: { psf: 1.05, range: [0.75, 1.40] },   /* asking, public listings, Kuching, Oct 2026: the middle of the range, to 5 sen */
  bays:  { psf: 2.15, range: [1.80, 2.50] },   /* subdivided bays, the brief's range within the listings' 1.80–2.70 */
  placeholder: 0.75,                           /* no evidence found: the Kuching whole-unit low */
  wholeVacancyPct: 10, baysVacancyPct: 15,
};
const INDUSTRIAL_NOTES = {
  checks: 'Before buying, check the title’s industrial use and its remaining lease years, the council’s approval for any subdivision or change of use, Bomba’s requirements for storage, and the site’s flood history.',
  evidence: 'Rents are illustrative: asking rents in public listings, Kuching, October 2026 — whole units about RM0.75–1.40 a sq ft a month, small subdivided units about RM1.80–2.70. An asking rent is not a rent paid.',
  placeholder: (town) => `No public rent evidence found for ${town} — replace with a local quote. RM0.75 a sq ft a month stands in: the Kuching whole-unit low.`,
  own: 'Owner-occupied: the rent entered is what you would otherwise pay for the space — an opportunity cost, not income. Your business’s takings and costs are not modelled.',
  storage: 'Self-storage and fulfilment are an operating business — unit rentals, insurance, staff — which this tool does not model. Here they are a long let of the space to an operator.',
  projectTerm: 'Project-term leases end with the project: the vacancy allowance is 20% (illustrative).',
  act446: 'Worker accommodation needs a certificate under Act 446 (the Employees’ Minimum Standards of Housing, Accommodations and Amenities Act), the council’s approval and Bomba’s. Check with the Labour Department, the council and Bomba before buying.',
  concentration: 'A few company tenants on project work: when a project ends, the building can empty at once.',
  lease33: 'A 3+3-year lease is in the words only: the calculator holds one rent and its growth, not a lease schedule.',
  terrace: 'A different building from A and B: priced at NAPIC’s 2-storey industrial terrace in Miri, on that terrace’s own floor area.',
  floorArea: 'NAPIC’s floor areas for these units are small — Kuching’s middle is 205 m², about 2,207 sq ft, where warehouse listings run about 4,000–18,000 sq ft. The rent is worked on NAPIC’s own area; none larger is assumed.',
  napic: `NAPIC figures are the middle of the schemes it sampled in ${SHOPLOT_NAPIC_PERIOD}, with the lowest and highest beside them — schemes, not transactions. NAPIC publishes no industrial rents.`,
  costs: 'Assessment, quit rent and insurance are the calculator’s defaults, written for a condominium: replace them with the council’s and the insurer’s figures. No maintenance charge is entered — a unit on its own title has no strata fee (illustrative).',
};
const inWhole = (label = 'The whole unit, let on a long lease', share = 1, vacancyPct = INDUSTRIAL_RENT.wholeVacancyPct) => ({ label, share, rent: 'whole', vacancyPct });
const inBays = (label, share = 1, bays = null) => ({ label, share, rent: 'bays', vacancyPct: INDUSTRIAL_RENT.baysVacancyPct, bays });
const inOwn = (label, share = 1) => ({ label, share, rent: 'whole', vacancyPct: 0, own: true });
const inFitOut = (label, amount, range) => ({ label, amount, range });
const IN_BAYS_FIT = (amount = 60000) => inFitOut('Subdividing into bays — partitions, doors and services', amount, [40000, 80000]);
const INDUSTRIAL_TOWNS = [
  { id: 'ind-kuching', napicTown: 'kuching', name: 'Kuching', city: 'kuching', district: 'Batu Kawa', evidence: true, scenarios: [
    { key: 'A', title: 'Whole unit on a long let', napic: 'semid', lines: [inWhole()], works: [], notes: [] },
    { key: 'B', title: 'Subdivided SME bays', napic: 'semid', lines: [inBays('Six bays (four to eight), let to small firms', 1, 6)], works: [IN_BAYS_FIT()], notes: [] },
    { key: 'C', title: 'Self-storage and fulfilment for online sellers, as a long let', napic: 'semid', lines: [{ ...inBays('The bays, let whole to a storage and fulfilment operator'), vacancyPct: INDUSTRIAL_RENT.wholeVacancyPct }], works: [IN_BAYS_FIT()], notes: ['storage'] },
  ] },
  { id: 'ind-samarahan', napicTown: 'samarahan', name: 'Samarahan', city: 'kota-samarahan', district: 'Samarahan town', evidence: false, scenarios: [
    { key: 'A', title: 'Whole unit on a long let', napic: 'semid', lines: [inWhole()], works: [], notes: [] },
    { key: 'B', title: 'Your own fabrication and fit-out base', napic: 'semid', lines: [inOwn('The whole unit, used by your own business — at the rent it gives up')], works: [], notes: ['own'] },
    { key: 'C', title: 'Student and household self-storage, with three trade bays', napic: 'semid', lines: [{ ...inBays('Self-storage, let to an operator — six-tenths of the floor'), share: 0.6 }, inBays('Three trade bays — four-tenths of the floor', 0.4, 3)], works: [IN_BAYS_FIT()], notes: ['storage'] },
  ] },
  { id: 'ind-sibu', napicTown: 'sibu', name: 'Sibu', city: 'sibu', district: 'Town centre', evidence: false, scenarios: [
    { key: 'A', title: 'Whole unit on a long let', napic: 'semid', lines: [inWhole()], works: [], notes: [] },
    { key: 'B', title: 'Subdivided workshops for timber, marine and repair firms', napic: 'semid', lines: [inBays('Workshops, let to small firms', 1, 4)], works: [IN_BAYS_FIT()], notes: [] },
    { key: 'C', title: 'Your own central-Sarawak depot, its surplus bays let', napic: 'semid', lines: [inOwn('Half the unit, your depot — at the rent it gives up', 0.5), inBays('Half the unit, surplus bays let', 0.5, 2)],
      works: [inFitOut('Subdividing half the unit into bays', 30000, [20000, 40000])], notes: ['own'] },
  ] },
  { id: 'ind-bintulu', napicTown: 'bintulu', name: 'Bintulu', city: 'bintulu', district: 'Kidurong', evidence: false, scenarios: [
    { key: 'A', title: 'Whole unit on a long let', napic: 'semid', lines: [inWhole()], works: [], notes: [] },
    { key: 'B', title: 'Contractor yard and semi-logistics on project-term leases', napic: 'semid', lines: [inWhole('The unit and its yard, let for a project’s term', 1, 20)], works: [], notes: ['projectTerm'] },
    { key: 'C', title: 'Worker accommodation leased to companies, as a long let', napic: 'semid', lines: [inWhole('The unit, leased to companies for their workers')],
      works: [inFitOut('Converting to accommodation', 60000, [40000, 80000]), inFitOut('Compliance — Act 446, approvals and fire upgrades', 37500, [15000, 60000])], notes: ['act446', 'concentration'] },
  ] },
  { id: 'ind-miri', napicTown: 'miri', name: 'Miri', city: 'miri', district: 'Lutong', evidence: false, scenarios: [
    { key: 'A', title: 'Whole unit on a long let', napic: 'semid', lines: [inWhole()], works: [], notes: [] },
    { key: 'B', title: 'Oil and gas support workshop on a long lease (3+3 years)', napic: 'semid', lines: [inWhole('The unit, let to a support workshop')], works: [], notes: ['lease33'] },
    { key: 'C', title: 'Entry-level SME bays in a 2-storey terrace', napic: 'terrace', lines: [inBays('Bays in the terrace, let to small firms', 1, 3)], works: [inFitOut('Subdividing into bays', 40000, [40000, 80000])], notes: ['terrace'] },
  ] },
];
const IN_SQFT = (fig) => Math.round(fig.floorSqm * SHOPLOT_SQFT_PER_SQM);
const inPsf = (v) => `RM${Number(v).toFixed(2)}`;
function industrialLines(r) {
  const fig = INDUSTRIAL_NAPIC[r.town.napicTown][r.sc.napic], sqft = IN_SQFT(fig);
  return r.sc.lines.map(l => {
    const R = INDUSTRIAL_RENT[l.rent], psf = r.town.evidence ? R.psf : INDUSTRIAL_RENT.placeholder;
    const area = Math.round(sqft * l.share), gross = Math.round(area * psf);
    const basis = r.town.evidence ? `${inPsf(psf)} a sq ft a month (${inPsf(R.range[0])}–${inPsf(R.range[1])}, asking rents in public listings, Kuching, Oct 2026)`
      : `${inPsf(psf)} a sq ft a month — no public rent evidence found for ${r.town.name}: replace with a local quote`;
    const words = `${fmtNum(area, 0)} sq ft${l.bays ? ` in ${l.bays} bays` : ''} × ${basis}${l.own ? ' — what you would otherwise pay for it, not income' : ''}`;
    return { label: l.label, gross, costs: 0, net: gross, vacancyPct: l.vacancyPct, kind: 'illustrative', words };
  });
}

/* ---------------------------------------------------------------- lookups */
/* Shoplot towns by their own id ('kuching'), industrial ones by 'ind-<town>'. */
const shoplotTown = (id) => [...SHOPLOT_TOWNS, ...INDUSTRIAL_TOWNS].find(t => t.id === id) || null;
const slIndustrial = (town) => !!town?.napicTown;
/* 'kuching/B' → { town, sc } */
function shoplotRef(ref) {
  const m = /^([a-z-]+)\/([ABC])$/.exec(String(ref || ''));
  const town = m ? shoplotTown(m[1]) : null;
  const sc = town ? town.scenarios.find(s => s.key === m[2]) : null;
  return sc ? { town, sc, ref: `${town.id}/${sc.key}` } : null;
}
const shoplotChip = (ref) => { const r = shoplotRef(ref) || { town: shoplotTown(String(ref).split('/')[0]) }; return `Illustrative starting scenario — ${r.town?.name || 'Sarawak'}${slIndustrial(r.town) ? ', industrial' : ''}`; };
const shoplotTitle = (ref) => shoplotRef(ref)?.sc.title || 'Starting scenario no longer offered';
const slMoney = (v) => fmtMoney(v, 'MYR', 0);
const slRange = ([lo, hi]) => `${slMoney(lo)}–${slMoney(hi)}`;

/* Each line of a scenario, worked: its rent before and after what the owner
   pays for it, its vacancy, its kind and the words that say where it is
   from. */
function shoplotLines(ref) {
  const r = shoplotRef(ref);
  if (!r) return [];
  if (slIndustrial(r.town)) return industrialLines(r);
  const N = SHOPLOT_NAPIC[r.town.id];
  return r.sc.lines.map(l => {
    const count = l.floors || 1;
    const fig = l.napic ? N[l.napic] : null;
    const gross = fig ? fig.mid * count : l.rooms ? l.rooms * l.per : count * l.per;
    const costs = l.utilities ? l.rooms * SHOPLOT_ILLUS.utilitiesPerRoom + SHOPLOT_ILLUS.wifi : 0;
    const kind = fig && !l.standIn ? 'napic' : 'illustrative';
    const what = l.napic === 'shop' ? 'ground-floor shop rent' : 'office-in-shop rent a floor';
    const words = fig
      ? `${count > 1 ? `${count} × ` : ''}${slMoney(fig.mid)} — the middle of the ${fig.schemes} ${fig.schemes === 1 ? 'scheme' : 'schemes'} NAPIC sampled, ${SHOPLOT_NAPIC_PERIOD} (${what}, ${shoplotAreaWords(fig.area)}; ${slMoney(fig.lo)}–${slMoney(fig.hi)})${l.standIn ? ', as a stand-in for an operator’s rent' : ''}`
      : l.rooms ? `${l.rooms} rooms × ${slMoney(l.per)} (${slRange(l.range)} a room), less ${slMoney(costs)} of utilities and Wi-Fi`
        : `${count} × ${slMoney(l.per)} a floor (${slRange(l.range)})`;
    return { label: l.label, gross, costs, net: gross - costs, vacancyPct: l.vacancyPct, kind, words };
  });
}
/* The parts added into the one rent and the one allowance: the rent is the
   lines' rents after what the owner pays for them; the allowance gives the
   same rent after vacancy, to the hundredth of a per cent. */
function shoplotBlend(lines) {
  const rent = lines.reduce((t, l) => t + l.net, 0);
  const effective = lines.reduce((t, l) => t + l.net * (1 - l.vacancyPct / 100), 0);
  const vacancyPct = rent > 0 ? +((1 - effective / rent) * 100).toFixed(2) : 0;
  return { rent, effective, vacancyPct };
}
/* The works, in ringgit, with what each is. */
function shoplotWorks(ref) {
  const r = shoplotRef(ref);
  if (!r) return { total: 0, parts: [] };
  if (slIndustrial(r.town)) {
    const parts = r.sc.works.map(w => ({ label: w.label, amount: w.amount, words: `${slMoney(w.amount)} (${slRange(w.range)})` }));
    return { total: parts.reduce((t, p) => t + p.amount, 0), parts };
  }
  const w = r.sc.works, I = SHOPLOT_ILLUS;
  const parts = [
    ...(w.floors ? [{ label: `Converting ${w.floors === 1 ? 'one floor' : `${w.floors} floors`} to rooms`, amount: w.floors * I.fitOutPerFloor, words: `${w.floors} × ${slMoney(I.fitOutPerFloor)} (${slRange(I.fitOutRange)} a floor at market rates)` }] : []),
    ...(w.compliance ? [{ label: 'Upper-floor compliance — approvals and fire upgrades', amount: I.compliance, words: `${slMoney(I.compliance)} (${slRange(I.complianceRange)})` }] : []),
    ...(w.furnish ? [{ label: 'Furnishing for stays', amount: w.furnish * I.furnishPerFloor, words: `${w.furnish} × ${slMoney(I.furnishPerFloor)} a floor` }] : []),
  ];
  return { total: parts.reduce((t, p) => t + p.amount, 0), parts };
}

/* THE DEAL A SCENARIO IS: the sample's shape, every figure untouched and so
   the tool's illustrative default until the reader changes it. The NAPIC
   figures are evidence 'assumed' and 'estimated' while they stand — never
   'public', which the badges read as Yours. */
function shoplotDeal(ref) {
  const r = shoplotRef(ref);
  if (!r) return null;
  const ind = slIndustrial(r.town);
  const fig = ind ? INDUSTRIAL_NAPIC[r.town.napicTown][r.sc.napic] : SHOPLOT_NAPIC[r.town.id].price;
  const b = shoplotBlend(shoplotLines(r.ref));
  return {
    ...PROPERTY_DEFAULT_DEAL,
    city: r.town.city, district: r.town.district, projectId: customProjectId(r.town.city),
    propertyType: ind ? 'Commercial lot' : 'Shophouse', commercialSubtype: ind ? 'industrial' : 'whole-shoplot', titleType: 'unknown',
    sqft: Math.round(fig.floorSqm * SHOPLOT_SQFT_PER_SQM), landSqft: 0,
    price: fig.mid, renovation: shoplotWorks(r.ref).total,
    downPct: SHOPLOT_ILLUS.downPct, ratePct: SHOPLOT_ILLUS.ratePct, tenureYears: SHOPLOT_ILLUS.tenureYears,
    rent: b.rent, vacancyPct: b.vacancyPct, maintenance: 0, sinkingFund: 0,
    evidence: { price: 'assumed', rent: 'assumed', maintenance: 'assumed', vacancyPct: 'assumed', apprecPct: 'assumed', sqft: 'estimated', titleType: 'assumed' },
    checks: {}, touched: {},
    /* Which starting scenario this is: named by the Lab and the calculator
       while nobody has touched it (shoplotOf). */
    shoplot: r.ref,
  };
}
/* The scenario a deal still is: one nobody has touched, not saved as a
   property — else null, and it is the reader's deal like any other. */
const shoplotOf = (d) => (d && d.shoplot && !d.modelId && !dealIsTheReaders(d) ? shoplotRef(d.shoplot) : null);
/* An untouched scenario is the tool's, as the sample is: rebuilt on demand,
   so it is never kept aside or rescued as a property of the reader's. */
const shoplotUntouched = (d) => { const r = shoplotOf(d); return !!r && pmSame(pmNormalInputs(d), pmNormalInputs(shoplotDeal(r.ref))); };

/* ---------------------------------------------------------------- opening */
/* Column A to the calculator, as a new deal is (propertyLoad: a deal of the
   reader's not saved is kept aside first), and B and C beside it in the Lab,
   from the address. Nothing is saved. */
function shoplotStart(townId) {
  const town = shoplotTown(townId);
  if (!town) return false;
  const kept = propertyLoad(shoplotDeal(`${town.id}/A`));
  delete LAB.deal;
  if (labSubject === 'deal') labSubject = null;
  labUrlSeen = null;
  navigate(`/property/lab?cols=tpl:${town.id}/B,tpl:${town.id}/C`);
  toast(`${shoplotChip(town.id)}: A, B and C are open in the Lab to edit and compare — nothing is saved.${pmKeptNote(kept)}`);
  return true;
}
/* THE ENTRY, beside the commercial choice (propertyQuestions, 83): a town,
   and one button. */
let SL_PICK = 'kuching', SL_KIND = 'shoplot';
function shoplotEntry(prefix) {
  const sid = `${prefix}-sl-town`, kid = `${prefix}-sl-kind`;
  const sel = el('select', { class: 'select sl-town', id: sid, onchange: (e) => { SL_PICK = e.target.value; } },
    SHOPLOT_TOWNS.map(t => el('option', { value: t.id, selected: t.id === SL_PICK ? '' : null }, t.name)));
  /* The owner, 1 Nov 2026: "Shoplot" or "Industrial", then the town. */
  const kind = el('select', { class: 'select sl-kind', id: kid, onchange: (e) => { SL_KIND = e.target.value; } },
    [['shoplot', 'Shoplot'], ['industrial', 'Industrial']].map(([v, w]) => el('option', { value: v, selected: v === SL_KIND ? '' : null }, w)));
  return el('div', { class: 'sl-entry', id: `${prefix}-sl`, 'data-note': 'shoplot' }, [
    el('p', { class: 'pq-note' }, [el('strong', {}, 'Starting scenarios — Sarawak.'), ' Three starting points for a 3-storey shoplot or an industrial unit in a town, opened in the Lab as A, B and C to edit and compare.']),
    el('div', { class: 'sl-entry-row' }, [
      el('label', { class: 'sl-town-label', for: kid }, 'Kind'), kind,
      el('label', { class: 'sl-town-label', for: sid }, 'Town'), sel,
      el('button', { type: 'button', class: 'btn btn-ghost sl-go', id: `${prefix}-sl-go`, onclick: () => shoplotStart(kind.value === 'industrial' ? `ind-${sel.value}` : sel.value) }, 'Start from a scenario')]),
    el('p', { class: 'pq-note sl-statement' }, SHOPLOT_STATEMENT),
  ]);
}

/* ---------------------------------------------------- the parts, in the Lab */
/* The scenario a Lab column shows: its own ('tpl:<ref>'), a copy of one, or
   the calculator's deal while it is an untouched scenario. */
function shoplotColRef(c) {
  if (String(c?.source).startsWith('tpl:')) return c.source.slice(4);
  if (String(c?.prop).startsWith('tpl:')) return c.prop.slice(4);
  if (c?.source === 'deal') return shoplotOf(State.deal)?.ref || null;
  return null;
}
/* A note's words: an industrial scenario's own, else the shoplots'. */
function slNote(r, k) {
  const v = slIndustrial(r?.town) && Object.hasOwn(INDUSTRIAL_NOTES, k) ? INDUSTRIAL_NOTES[k] : SHOPLOT_NOTES[k];
  return typeof v === 'function' ? v(r.town.name) : v;
}
function industrialPriceWords(r) {
  const N = INDUSTRIAL_NAPIC[r.town.napicTown], fig = N[r.sc.napic];
  return `Price: ${slMoney(fig.mid)} — the middle of the ${fig.schemes} ${INDUSTRIAL_TYPE_WORDS[r.sc.napic]} schemes NAPIC sampled in the ${N.division} Division, ${SHOPLOT_NAPIC_PERIOD} (${slMoney(fig.lo)}–${slMoney(fig.hi)}); its floor area, the middle of the same schemes, is ${fmtNum(fig.floorSqm, 1)} m² (${fmtNum(IN_SQFT(fig), 0)} sq ft), and the rent is worked on it; placed in ${r.town.district} for the place line only.`;
}
const slKindBadge = (kind) => (kind === 'napic' ? kindBadge('derived', { fine: `From NAPIC’s ${SHOPLOT_NAPIC_PERIOD} file` }) : kindBadge('illustrative', { fine: 'A starting scenario’s assumption' }));
function shoplotLabCard(P, lab) {
  const cols = lab.cols.map(c => ({ c, ref: shoplotColRef(c) })).filter(x => x.ref && shoplotRef(x.ref));
  if (!cols.length) return null;
  const towns = [...new Set(cols.map(x => shoplotRef(x.ref).town.name))];
  const fams = [...new Set(cols.map(x => (slIndustrial(shoplotRef(x.ref).town) ? 'Industrial' : 'Shoplot')))];
  const indOnly = fams.length === 1 && fams[0] === 'Industrial';
  const card = el('section', { class: 'card ls-section sl-card', id: labId(P, 'slcard'), 'aria-labelledby': labId(P, 'sl-h') });
  card.append(el('h2', { class: 'h-card', id: labId(P, 'sl-h') }, `${fams.length === 1 ? `${fams[0]} starting` : 'Starting'} scenarios — ${towns.length === 1 ? towns[0] : 'Sarawak'}`));
  card.append(el('p', { class: 'metaline sl-statement' }, SHOPLOT_STATEMENT));
  for (const { c, ref } of cols) {
    const r = shoplotRef(ref), lines = shoplotLines(ref), b = shoplotBlend(lines), works = shoplotWorks(ref);
    const moved = labMoveCount(c) > 0 || c.source === 'variant' || (c.source === 'deal' && !shoplotOf(State.deal));
    const body = el('div', { class: 'pc-more-body sl-body' });
    body.append(el('ul', { class: 'sl-parts' }, [
      ...lines.map(l => el('li', { class: 'sl-part', 'data-kind': l.kind }, [el('strong', {}, `${l.label}: ${slMoney(l.net)} a month`), ' ', slKindBadge(l.kind),
        el('span', { class: 'sl-part-words' }, ` ${l.words}; ${l.vacancyPct}% vacancy`), ' ', kindBadge('illustrative', { fine: 'The vacancy is a starting scenario’s assumption' })])),
      el('li', { class: 'sl-part sl-sum' }, [el('strong', {}, `Rent entered: ${slMoney(b.rent)} a month, vacancy allowance ${b.vacancyPct}%`),
        ` — ${slMoney(Math.round(b.effective))} a month after vacancy, as the parts give it.`]),
      ...works.parts.map(p => el('li', { class: 'sl-part' }, [el('strong', {}, `${p.label}: ${slMoney(p.amount)}`), ' ', kindBadge('illustrative', { fine: 'A starting scenario’s assumption' }), ` ${p.words}`])),
      slIndustrial(r.town) ? el('li', { class: 'sl-part' }, industrialPriceWords(r)) : el('li', { class: 'sl-part' }, `Price: ${slMoney(SHOPLOT_NAPIC[r.town.id].price.mid)} — the middle of the ${SHOPLOT_NAPIC[r.town.id].price.schemes} 3-storey shop schemes NAPIC sampled in the ${SHOPLOT_NAPIC[r.town.id].division} Division, ${SHOPLOT_NAPIC_PERIOD} (${slMoney(SHOPLOT_NAPIC[r.town.id].price.lo)}–${slMoney(SHOPLOT_NAPIC[r.town.id].price.hi)}); placed in ${r.town.district} for the place line only.`),
    ]));
    const keys = slIndustrial(r.town) ? [...r.sc.notes, r.town.evidence ? 'evidence' : 'placeholder', 'checks', 'partial'] : [...r.sc.notes, 'partial'];
    for (const k of keys) body.append(el('p', { class: 'sl-note', 'data-note': k }, slNote(r, k)));
    card.append(el('details', { class: 'pc-more ls-l3 sl-col', id: labId(P, `sl-${c.key}`), 'data-sl': ref }, [
      el('summary', { class: 'pc-more-sum' }, `${c.key} — ${r.sc.title}: ${slMoney(b.rent)} a month, ${b.vacancyPct}% vacancy${moved ? ' (as loaded — not your moves)' : ''}`),
      body]));
  }
  card.append(el('details', { class: 'pc-more ls-l3 sl-col', id: labId(P, 'sl-how') }, [
    el('summary', { class: 'pc-more-sum' }, 'How these starting points are built'),
    el('div', { class: 'pc-more-body' }, (indOnly ? ['oneRent', 'napic', 'floorArea', 'finance', 'costs'] : ['oneRent', 'napic', 'finance', 'costs'])
      .map(k => el('p', { class: 'sl-note', 'data-note': k }, slNote(indOnly ? { town: { napicTown: 'any' } } : null, k))))]));
  return card;
}
/* On the calculator, under its status line, while its deal is an untouched
   scenario: which one, and the one limit. */
function shoplotCalcNote(d) {
  const r = shoplotOf(d);
  if (!r) return null;
  return el('p', { class: 'metaline sl-calc', id: 'pm-sl' }, [`${r.sc.key}: ${r.sc.title}. ${SHOPLOT_STATEMENT} `,
    el('a', { href: href(`/property/lab?cols=tpl:${r.town.id}/B,tpl:${r.town.id}/C`), onclick: (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return; e.preventDefault(); navigate(`/property/lab?cols=tpl:${r.town.id}/B,tpl:${r.town.id}/C`);
    } }, 'Its parts and notes, beside B and C in the Lab')]);
}
