/* ==========================================================================
   PROPERTY — Quantum Property Deal Check
   A property turned into an investor-grade financial model: true acquisition
   cost, financing, rent, vacancy, maintenance, cash flow, yield, exit costs
   and a like-for-like comparison against equities.
   All project data is synthetic sample data, and nothing here is a valuation
   in the regulated sense — that requires a registered valuer.
   ========================================================================== */

/* Sample projects. Sarawak first, matching the stated pilot geography. */
/* Each carries the city it belongs to, because the selector used to offer all
   four regardless of where the reader said the property was: choosing Sibu
   still listed two Kuching projects, one in Miri and one in Kuala Lumpur, and
   nothing in Sibu at all. A comparable from another city is not a weak
   comparable, it is a different market. */
const PROJECTS = [
  { id:'p1', city:'kuching', name:'Riveria Park Residences', area:'Kuching, Sarawak', type:'Condominium', tenure:'Leasehold',
    psfLo:480, psfMid:545, psfHi:610, rentLo:1500, rentMid:1850, rentHi:2200, sqft:1050,
    txns:[['Q4 2025', 552, 3], ['Q3 2025', 541, 5], ['Q2 2025', 536, 4], ['Q1 2025', 528, 6], ['Q4 2024', 519, 4]],
    vacancyPct:9, maintPsf:0.28 },
  { id:'p2', city:'kuching', name:'Tabuan Heights Terraces', area:'Kuching, Sarawak', type:'2-storey terrace', tenure:'Freehold',
    psfLo:330, psfMid:372, psfHi:415, rentLo:1400, rentMid:1700, rentHi:2000, sqft:1600,
    txns:[['Q4 2025', 378, 7], ['Q3 2025', 371, 9], ['Q2 2025', 366, 6], ['Q1 2025', 359, 8], ['Q4 2024', 351, 5]],
    vacancyPct:6, maintPsf:0.12 },
  { id:'p3', city:'miri', name:'Miri Waterfront Suites', area:'Miri, Sarawak', type:'Serviced apartment', tenure:'Leasehold',
    psfLo:410, psfMid:462, psfHi:520, rentLo:1250, rentMid:1550, rentHi:1900, sqft:900,
    txns:[['Q4 2025', 458, 2], ['Q3 2025', 466, 3], ['Q2 2025', 471, 2], ['Q1 2025', 469, 4], ['Q4 2024', 474, 3]],
    vacancyPct:14, maintPsf:0.31 },
  { id:'p4', city:'outside', name:'Mont Kiara Vista', area:'Kuala Lumpur', type:'Condominium', tenure:'Freehold',
    psfLo:780, psfMid:880, psfHi:990, rentLo:3200, rentMid:3900, rentHi:4600, sqft:1200,
    txns:[['Q4 2025', 889, 11], ['Q3 2025', 878, 14], ['Q2 2025', 871, 9], ['Q1 2025', 866, 12], ['Q4 2024', 858, 10]],
    vacancyPct:11, maintPsf:0.42 },
];

/* Sibu, Bintulu and the smaller centres have no sample project, and one is not
   invented to fill the gap. Every city therefore also offers a custom entry,
   which attaches no comparable at all: the reader supplies the price and the
   rent, and the tool says plainly that it holds no transacted evidence for that
   city rather than lending them a Kuching median.

   The district and property type are separate controls immediately above, so a
   per-area entry here would be a third copy of the same state. */
const customProjectId = (cityId) => `custom-${cityId}`;
const isCustomProject = (id) => String(id || '').startsWith('custom-');

function projectsForCity(cityId) {
  return PROJECTS.filter(p => p.city === cityId);
}

/* Resolves whatever is selected into something dealModel can price. A custom
   entry carries no psf, no rent band and no transaction record — those fields
   are absent rather than zero, so nothing downstream can read them as an
   observation of a quiet market. */
function activeProject(d) {
  if (isCustomProject(d.projectId)) {
    const city = SARAWAK_CITIES.find(c => c.id === d.city) || SARAWAK_CITIES[0];
    return { id:d.projectId, city:city.id, custom:true,
             name:`Custom property — ${city.name}`, area:city.name,
             type:d.propertyType || 'Property', tenure:null,
             sqft:d.sqft, vacancyPct:d.vacancyPct, maintPsf:null,
             psfLo:null, psfMid:null, psfHi:null,
             rentLo:null, rentMid:null, rentHi:null, txns:[] };
  }
  return PROJECTS.find(p => p.id === d.projectId)
      || projectsForCity(d.city)[0]
      || { id:customProjectId(d.city), custom:true, city:d.city,
           name:'Custom property', area:'', type:d.propertyType || 'Property',
           sqft:d.sqft, vacancyPct:d.vacancyPct, maintPsf:null,
           psfLo:null, psfMid:null, psfHi:null, rentLo:null, rentMid:null, rentHi:null, txns:[] };
}

/* ==========================================================================
   SARAWAK GEOGRAPHY

   Location is asked first because in Sarawak it decides more than price does.
   Title class, transfer restriction, flood exposure and who the tenants are
   all follow from where the property is, and a calculator that starts at
   "purchase price" has already skipped the questions that matter most.
   ========================================================================== */
/* Each city carries its own areas and its own demand and risk prompts. All
   four used to lead into the same generic calculator, so choosing Sibu and
   choosing Miri produced an identical experience — which is wrong in the way
   that matters most here, because what moves rent in an oil town and what
   moves it in a river town are not the same forces.

   The factors are prompts, not assumptions. Nothing here adjusts a number on
   the user's behalf; they are the questions a local buyer would ask and an
   out-of-state model would miss. */
/* EVERY DIVISION, NOT FOUR TOWNS AND A SHRUG.
   ---------------------------------------------------------------------------
   This list held Kuching, Sibu, Miri, Bintulu and one entry called "Other
   Sarawak" whose districts were seven whole towns — Sri Aman, Kapit, Limbang,
   Mukah, Betong, Sarikei and "Elsewhere". A landowner in Mukah was being asked
   to file their property under Elsewhere, and every figure they recorded landed
   in a bucket shared with four other divisions, which makes a median of it
   meaningless.

   So the twelve administrative divisions are all here. That structure is public
   administrative fact, not market data: divisions and their districts are
   gazetted, and nothing about a town appearing in this list says a property
   market exists there.

   TWO KINDS OF `districts`, AND THE DIFFERENCE IS STATED.

   Kuching, Sibu, Miri and Bintulu carry NEIGHBOURHOOD names, because that is
   the granularity at which their property is actually discussed and it is what
   was already recorded against them. The rest carry the division's
   ADMINISTRATIVE DISTRICTS, because inventing neighbourhood names for towns
   whose streets this tool has never seen would be fabricating the one thing it
   promises not to. `localityKind` says which a given list is, and the recorder
   lets a reader add a locality of their own either way — a register has to be
   able to hold a place the list does not.

   `other-swk` stays, deprecated. Records already filed under it must keep
   resolving; nothing new should be filed there. */
const SARAWAK_CITIES = [
  { id:'kuching', name:'Kuching', division:'Kuching', localityKind:'neighbourhood',
    districts:['City centre','Tabuan','Stutong','Batu Kawa','Matang','Petra Jaya','Samarahan','Kota Samarahan'],
    factors:['Government employment','University demand','Medical and professional employment',
             'New suburban supply','Traffic and parking'] },
  { id:'bau', name:'Bau', division:'Kuching', localityKind:'district',
    districts:['Bau town','Krokong','Jagoi','Tondong','Buso'],
    factors:['Commuter distance to Kuching','Former mining ground','Limestone terrain','Thin transaction record'] },
  { id:'lundu', name:'Lundu', division:'Kuching', localityKind:'district',
    districts:['Lundu town','Sematan','Gunung Gading','Biawak'],
    factors:['Coastal frontage','Tourism seasonality','Distance from Kuching','Thin transaction record'] },

  { id:'kota-samarahan', name:'Kota Samarahan', division:'Samarahan', localityKind:'district',
    districts:['Samarahan town','Muara Tuang','Asajaya','Simunjan','Sebuyau'],
    factors:['University and teaching-hospital employment','Student rental demand',
             'Kuching commuter overflow','New suburban supply'] },

  { id:'serian', name:'Serian', division:'Serian', localityKind:'district',
    districts:['Serian town','Tebedu','Balai Ringin','Tarat'],
    factors:['Trunk-road position','Agricultural employment','Border trade at Tebedu','Thin transaction record'] },

  { id:'sri-aman', name:'Sri Aman', division:'Sri Aman', localityKind:'district',
    districts:['Sri Aman town','Lubok Antu','Engkilili','Pantu'],
    factors:['Batang Lupar tidal bore','Administrative employment','Thin transaction record','Financing availability'] },

  { id:'betong', name:'Betong', division:'Betong', localityKind:'district',
    districts:['Betong town','Saratok','Pusa','Kabong','Debak','Spaoh'],
    factors:['Coastal and riverine exposure','Agricultural employment','Thin transaction record'] },

  { id:'sarikei', name:'Sarikei', division:'Sarikei', localityKind:'district',
    districts:['Sarikei town','Meradong (Bintangor)','Julau','Pakan','Repok'],
    factors:['Rajang delta position','Agricultural processing','Shophouse liquidity','Thin transaction record'] },

  { id:'sibu', name:'Sibu', division:'Sibu', localityKind:'neighbourhood',
    districts:['Town centre','Rejang Park','Ulu Sungai Merah','Jalan Salim','Jalan Teku','Permai','Lanang','Sibujaya'],
    factors:['Flood history','River and drainage exposure','Shophouse liquidity','Population growth',
             'Local family rental demand','Lower transaction liquidity'] },
  { id:'kanowit', name:'Kanowit', division:'Sibu', localityKind:'district',
    districts:['Kanowit town','Ngemah','Machan'],
    factors:['River access','Timber and agriculture','Very thin transaction record'] },

  { id:'mukah', name:'Mukah', division:'Mukah', localityKind:'district',
    districts:['Mukah town','Dalat','Daro','Matu','Igan','Tanjung Manis','Balingian'],
    factors:['Deep peat ground conditions','Coastal exposure','Administrative-centre construction',
             'Tanjung Manis port activity','Thin transaction record'] },

  { id:'bintulu', name:'Bintulu', division:'Bintulu', localityKind:'neighbourhood',
    districts:['Town centre','Tanjung Batu','Kidurong','Samalaju','Jepak','Kemena','Parkcity','Sibiew'],
    factors:['LNG and industrial employment','Samalaju activity','Project-completion vacancy',
             'Contractor housing','Heavy-industry concentration'] },
  { id:'tatau', name:'Tatau', division:'Bintulu', localityKind:'district',
    districts:['Tatau town','Sebauh','Kuala Tatau'],
    factors:['Plantation employment','Bintulu commuter distance','Very thin transaction record'] },

  { id:'miri', name:'Miri', division:'Miri', localityKind:'neighbourhood',
    districts:['City centre','Marina','Pujut','Lutong','Permyjaya','Senadin','Tudan','Taman Tunku'],
    factors:['Oil and gas employment','Curtin student demand','Brunei-related activity','Rotation staff',
             'Industry-cycle vacancy'] },
  { id:'marudi', name:'Marudi', division:'Miri', localityKind:'district',
    districts:['Marudi town','Beluru','Bekenu','Niah','Sibuti'],
    factors:['Baram river access','Agricultural employment','Road connection to Miri','Very thin transaction record'] },

  { id:'limbang', name:'Limbang', division:'Limbang', localityKind:'district',
    districts:['Limbang town','Nanga Medamit','Batu Danau'],
    factors:['Brunei border trade','Two-border road access','Cross-border wage exposure','Thin transaction record'] },
  { id:'lawas', name:'Lawas', division:'Limbang', localityKind:'district',
    districts:['Lawas town','Trusan','Sundar','Merapok'],
    factors:['Sabah and Brunei border position','Coastal exposure','Very thin transaction record'] },

  { id:'kapit', name:'Kapit', division:'Kapit', localityKind:'district',
    districts:['Kapit town','Song','Belaga','Bukit Mabong','Nanga Merit'],
    factors:['River-only access for part of the year','Timber employment','Bakun catchment',
             'Financing availability','Very thin transaction record'] },

  /* DEPRECATED, KEPT SO OLD RECORDS RESOLVE. Anything filed here predates the
     division list above and should be refiled against a town. */
  { id:'other-swk', name:'Elsewhere in Sarawak (unfiled)', division:'—', localityKind:'legacy', deprecated:true,
    districts:['Sri Aman','Kapit','Limbang','Mukah','Betong','Sarikei','Elsewhere in Sarawak'],
    factors:['Thin transaction record','Financing availability','Local employment base'] },

  { id:'outside', name:'Outside Sarawak', division:'—', localityKind:'legacy',
    districts:['Peninsular Malaysia','Sabah','Labuan'],
    factors:['The Sarawak Land Code does not apply outside Sarawak — title questions here follow the National Land Code'] },
];
/* Towns grouped by division, for a picker that would otherwise be twenty flat
   entries. Derived, so adding a town above needs no second edit here. */
const SARAWAK_DIVISIONS = SARAWAK_CITIES.reduce((m, c) => {
  if (c.division && c.division !== '—') (m[c.division] = m[c.division] || []).push(c);
  return m;
}, {});

/* Sarawak land is classified under its own Land Code, not the National Land
   Code, and the class governs who may hold the title. This is the single most
   consequential thing about a Sarawak property and the one a calculator must
   never quietly decide — it is a question for a lawyer and the Land and Survey
   Department, so the tool raises it and stops there. */
const TITLE_TYPES = [
  { id:'mixed-zone',  label:'Mixed Zone Land',      note:'Generally transferable without a native-status restriction. Confirm the class on the title document itself.' },
  { id:'native-area', label:'Native Area Land',     note:'Transfer is restricted to persons of native status under the Sarawak Land Code. A non-native purchase is not a matter of price.', restricted:true },
  { id:'native-cust', label:'Native Customary Rights land', note:'NCR land carries restrictions and frequently unresolved documentation. Do not proceed on a calculator.', restricted:true },
  { id:'interior',    label:'Interior Area Land',   note:'Restricted class. Verify with the Land and Survey Department before anything else.', restricted:true },
  { id:'strata',      label:'Strata (parcel title)',note:'Common for apartments and condominiums. Check whether the strata title has actually issued or is still pending.' },
  { id:'unknown',     label:'Not yet verified',     note:'The class has not been established. Everything below is provisional until it is.', restricted:true },
];

const PROPERTY_TYPES = ['Condominium', 'Serviced apartment', 'Apartment / flat',
  'Terrace (single storey)', 'Terrace (2 storey)', 'Semi-detached', 'Detached / bungalow',
  'Shophouse', 'Commercial lot', 'Land'];

/* Every input carries where its number came from. A figure a developer quoted
   and a figure taken from a transacted comparable are not the same evidence,
   and a report that presents them identically is overstating what it knows. */
const EVIDENCE = [
  { id:'verified',  label:'Verified transaction', rank:5, note:'A transacted price or a signed tenancy you have seen.' },
  { id:'public',    label:'Public data',          rank:4, note:'Published by an authority or a listed source.' },
  { id:'user',      label:'You supplied',         rank:3, note:'A figure you entered from your own knowledge.' },
  { id:'developer', label:'Developer supplied',   rank:2, note:'Quoted by a seller or their agent. Treat projections from this source with care.' },
  { id:'estimated', label:'Estimated',            rank:1, note:'Derived from a range or a comparable rather than observed directly.' },
  { id:'assumed',   label:'Assumed',              rank:0, note:'A default carried by this tool. Not evidence.' },
  /* Below "assumed", because an assumption is at least a position someone took.
     A seeded number is one nobody chose for this property.

     This class exists because the calculator opened every city with the same
     Kuching-derived price and rent and labelled them "You supplied" and
     "Estimated" — so a first-time reader in Sibu met RM572,000 attributed to
     themselves, having supplied nothing. That is not a display bug. It is the
     tool misstating where a figure came from, on the two numbers that drive
     every output on the page. */
  { id:'illustrative_default', label:'Illustrative default', rank:-1,
    note:'Carried by this tool as a starting number. Nobody chose it for this property and no market was consulted. Replace it before relying on any output.' },
];
const evidenceOf = (id) => EVIDENCE.find(e => e.id === id) || EVIDENCE[EVIDENCE.length - 1];

/* Which figures the reader has actually touched.
   ---------------------------------------------------------------------------
   Stored evidence cannot answer this on its own: a saved deal carries whatever
   label was written when it was created, and the defaults were written as
   "user" before anyone typed anything. So the answer comes from the edit
   itself. A field is the reader's when the reader changed it, and until then it
   is what this tool seeded, whatever the stored label says. */
const isTouched = (d, k) => !!d?.touched?.[k];
function markTouched(d, k) {
  d.touched = { ...(d.touched || {}), [k]: true };
  /* The evidence grade follows the edit for the driving figures, so the reader
     does not have to find a second control to say what they just did. They can
     still upgrade it to a verified transaction afterwards. */
  if (EVIDENCE_DRIVERS.includes(k) && (d.evidence?.[k] === 'illustrative_default' || !d.evidence?.[k]))
    d.evidence = { ...(d.evidence || {}), [k]: 'user' };
}
/* The figures whose provenance is displayed and whose grade drives the report's
   own evidence assessment. */
const EVIDENCE_DRIVERS = ['price', 'rent', 'maintenance', 'sqft'];

/* THE REVIEW QUEUE — ONE LIST, NOT TWENTY SCATTERED WARNINGS.
   ---------------------------------------------------------------------------
   Every seeded figure was already marked at the input and in the evidence card,
   which answers "is this one mine?" wherever a reader happens to be looking.
   It does not answer the question they actually arrive with, which is "how much
   of this answer is still the tool's?" — and that one cannot be answered by
   scrolling, because the fields are spread across nine numbered groups.

   `affects` is the point of each row. Knowing a figure is a sample is not
   useful on its own; knowing that the vacancy rate is a sample AND that it sets
   the break-even rent tells the reader whether to fix it before reading the
   result. Rows are ordered by how hard the figure pushes the outputs. */
/* `fmt` carries the unit. A bare "572000" beside "4.3" beside "9" is three
   numbers the reader has to decode before they can judge any of them, and the
   whole purpose of this list is to be judged at a glance. Maintenance is per
   month here because that is how it is entered — dealModel multiplies by 12. */
const PROPERTY_REVIEW = [
  { k:'price',       label:'Purchase price',   fmt:v => fmtMoney(v, 'MYR', 0),
    affects:'Every cash figure, the loan, the duty and the yield.' },
  { k:'rent',        label:'Expected rent',    fmt:v => `${fmtMoney(v, 'MYR', 0)} a month`,
    affects:'Monthly position, break-even rent and the whole income case.' },
  { k:'sqft',        label:'Built-up area',    fmt:v => `${fmtNum(v, 0)} sq ft`,
    affects:'Price per square foot and the maintenance charge derived from it.' },
  { k:'maintenance', label:'Maintenance',      fmt:v => `${fmtMoney(v, 'MYR', 0)} a month`,
    affects:'Monthly position and break-even rent.' },
  { k:'ratePct',     label:'Interest rate',    fmt:v => fmtPct(v, 2),
    affects:'The instalment, and through it the break-even rent and cover.' },
  { k:'vacancyPct',  label:'Vacancy',          fmt:v => fmtPct(v, 0),
    affects:'Effective rent and the rent needed to break even.' },
  { k:'downPct',     label:'Deposit',          fmt:v => `${fmtPct(v, 0)} of price`,
    affects:'Cash to complete, the loan and the margin of finance.' },
  { k:'apprecPct',   label:'Appreciation',     fmt:v => `${fmtPct(v, 1)} a year`,
    affects:'The exit value and every ten-year return figure.' },
  { k:'tenureYears', label:'Loan tenure',      fmt:v => `${fmtNum(v, 0)} years`,
    affects:'The instalment and the total interest paid.' },
  { k:'holdYears',   label:'Holding period',   fmt:v => `${fmtNum(v, 0)} years`,
    affects:'The exit case and the annualised return.' },
];

/* A field is on the queue when the reader has not touched it. Deliberately not
   "when it differs from the default" — a reader who types the seeded number
   themselves has made a decision about it, and a queue that kept nagging them
   would train them to ignore it. */
function propertyReviewQueue(d) {
  return PROPERTY_REVIEW.filter(f => !isTouched(d, f.k));
}

/* What to show for a figure the reader has not touched: what it actually is. */
const shownEvidence = (d, k) =>
  (EVIDENCE_DRIVERS.includes(k) && !isTouched(d, k) && !d?.userStarted)
    ? 'illustrative_default'
    : (d.evidence?.[k] || 'assumed');

/* Named rather than inline, so Reset restores exactly what a first visit sees.
   These are the seeded figures the review queue lists and the evidence card
   calls illustrative defaults — the two must not be able to disagree about
   what "default" is, which they would the moment there were two copies. */
const PROPERTY_DEFAULT_DEAL = {
  /* where */
  city:'kuching', district:'Tabuan', projectId:'p1',
  propertyType:'Condominium', titleType:'strata', remainingLease:88,
  /* size */
  sqft:1050, landSqft:0, parking:1,
  /* purchase */
  price:572000, bankValuation:0, renovation:25000, downPct:10, ratePct:4.30, tenureYears:35,
  /* Which value a lender lends against. The lower of price and valuation is
     the common default and not a universal rule; replace it with the selected
     lender's actual policy when one is known. */
  valuationRule:'lower_of',
  /* income */
  rent:1850, rentGrowthPct:2.5, vacancyPct:9,
  /* running costs, annual unless stated */
  maintenance:294, sinkingFund:0, assessment:800, quitRent:300, insurance:450,
  mgmtPct:0, repairReservePct:5,
  /* management operations — specification P1-7. A management fee percentage on
     its own says what the service costs and nothing about what it does, which
     is the half a landlord actually has to judge. */
  selfManaged:true, leasingFeeMonths:1, renewalFeeMonths:0.5, mgmtMinMonthly:0,
  tenancyMonths:24, daysToFirstTenant:60, repairApprovalLimit:500,
  inspectionsPerYear:2, arrearsChaseDays:7, ownerReportCadence:'monthly',
  tenantPaysUtilities:true, depositMonths:2,
  /* exit */
  holdYears:10, apprecPct:3.0, sellMonths:6, agentPct:2.0, exitLegalPct:0.5,
  /* comparison */
  equityReturnPct:7.0,
  /* provenance per figure */
  evidence: { price:'user', rent:'estimated', maintenance:'developer', vacancyPct:'assumed',
              apprecPct:'assumed', sqft:'developer', titleType:'assumed' },
  /* answers to the Sarawak checklist, keyed by check id */
  checks: {},
};
/* A deep-ish copy on boot: `evidence` and `checks` are objects, and handing the
   live default out by reference would let the first edit rewrite the constant
   that Reset restores from. */
State.deal = store.read('deal', null) || {
  ...PROPERTY_DEFAULT_DEAL,
  evidence: { ...PROPERTY_DEFAULT_DEAL.evidence },
  checks: { ...PROPERTY_DEFAULT_DEAL.checks },
};
const saveDeal = () => store.write('deal', State.deal);

/* ---------------------------------------------------------- shareable state */
/* The city used to be read out of the URL and then deleted from it, because
   re-reading it on every render locked the page to whatever the link said and
   undid the reader's next change. Deleting it fixed the lock and broke sharing:
   /property/calculator?city=sibu loaded Sibu and then showed a bare path, so a
   refresh, a bookmark or a pasted link no longer reproduced what was on screen.

   Both problems come from treating the URL as an inbox. It is state. It is read
   on arrival, and written whenever a control changes — and because the write
   happens before the re-render, what the next render reads back already agrees
   with the deal. No flag, no consumed parameter, and no lock. */
const slugParam = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const matchBySlug = (list, want) => list.find(x => slugParam(x) === slugParam(want));

function syncPropertyUrl(d) {
  const p = new URLSearchParams(location.search);
  p.set('city', d.city);
  if (d.district) p.set('district', slugParam(d.district)); else p.delete('district');
  if (d.propertyType) p.set('type', slugParam(d.propertyType)); else p.delete('type');
  const q = p.toString();
  const next = location.pathname + (q ? `?${q}` : '');
  if (next === location.pathname + location.search) return;
  history.replaceState(history.state, '', next);
}

/* Applies a link's parameters to the deal. Returns true when something actually
   changed, so the caller can persist only on a real change. */
function readPropertyUrl(d) {
  const p = new URLSearchParams(location.search);
  let changed = false;
  const city = p.get('city');
  if (city) {
    const hit = SARAWAK_CITIES.find(c => c.id === slugParam(city));
    if (hit && d.city !== hit.id) {
      d.city = hit.id;
      d.district = hit.districts[0];
      /* A Kuching project under Sibu would be worse than no project. */
      if (!projectsForCity(hit.id).some(x => x.id === d.projectId)) d.projectId = customProjectId(hit.id);
      changed = true;
    }
  }
  const cityDef = SARAWAK_CITIES.find(c => c.id === d.city);
  const district = p.get('district');
  if (district && cityDef) {
    const hit = matchBySlug(cityDef.districts, district);
    if (hit && d.district !== hit) { d.district = hit; changed = true; }
  }
  const type = p.get('type');
  if (type) {
    const hit = matchBySlug(PROPERTY_TYPES, type);
    if (hit && d.propertyType !== hit) { d.propertyType = hit; changed = true; }
  }
  return changed;
}

/* CARRYING A COMPANY INTO A WORKSPACE
   ---------------------------------------------------------------------------
   The Strategy Lens grades a company and then linked to two blank workspaces,
   so the reader retyped the symbol and the plan they saved had no idea which
   research produced it.

   `from` carries the company id and is the only parameter that resolves
   anything — through companyFromSlug, which already understands -SEC ids, bare
   tickers and Bursa codes. `symbol` is readable decoration re-derived from the
   resolved record and never trusted, exactly as companyPath treats its readable
   tail. A `symbol` with no `from` prefills nothing: a plan that cannot name its
   company is not a plan, and refusing is better than half-filling one.

   NOTHING IS APPLIED WITHOUT A CLICK. The banner offers; the reader accepts. A
   workspace that silently rewrote itself from a URL would be indistinguishable
   from one the reader had filled in, which is the whole problem with prefill. */
function readWorkspaceUrl() {
  const q = new URLSearchParams(location.search);
  const from = q.get('from');
  if (!from) return null;
  const id = companyFromSlug(from);
  const row = id ? BY_ID.get(id) : null;
  if (!row) return { row: null, asked: from };
  return { row, asked: from, ticker: row.c.tk || row.c.code || row.c.id };
}

/* Offered, not applied. Returns null when there is nothing to offer. */
function workspaceLinkBanner(kind, plan, save) {
  /* NOT WHILE THE FILINGS ARE IN FLIGHT.
     The skeleton gate covers the universe views, and this banner reached past
     it: ?from=MSFT-SEC resolves through companyFromSlug, which before the load
     falls back to the illustrative MSFT and reported "Illustrative sample
     figures" for about half a second before becoming "SEC-filed statements".
     Same one-URL-two-companies mechanism, arriving through a different door.

     A source that changes after the reader has read it is worse here than
     anywhere else, because this card exists to state provenance. */
  if (realPending && new URLSearchParams(location.search).get('from')) {
    const w = el('div', { class: 'card' });
    w.append(cardHead('Checking which company this is',
      'The link names a company and the audited filings are still loading. Nothing is shown until the source is settled — a sample company and a filed one can share a ticker, and they are not the same record.'));
    return w;
  }

  const link = readWorkspaceUrl();
  if (!link) return null;

  const card = el('div', { class: 'card', style: 'border-left:3px solid var(--brand)' });
  if (!link.row) {
    card.append(cardHead('That link names a company this build does not hold',
      `The link asked for “${link.asked}”, which is not in the universe. Nothing has been filled in — a plan that cannot name its company is not one worth saving.`));
    return card;
  }

  const c = link.row.c;
  const already = plan.sourceCompanyId === c.id;
  card.append(cardHead(already ? `Linked to ${c.name}` : `Start from ${c.name}?`,
    already
      ? `This plan records that it came from the ${c.tk || c.code} research page. Nothing below was filled in from it beyond the identity.`
      : `You arrived from the ${c.tk || c.code} research page. Only the identity would be filled in — every figure, attestation and risk input stays yours to enter.`));

  const kv = el('dl', { class: 'kv', style: 'margin-top:var(--md)' });
  const rows = kind === 'wheel'
    ? [['Symbol', c.tk || c.code], ['Market', c.mkt], ['Research source', c.real ? 'SEC-filed statements' : 'Illustrative sample figures']]
    : [['Symbol', c.tk || c.code],
       ['Venue', /^SEC\b/i.test(c.exch || '') ? 'not known — read it off your chart' : (c.exch || '—')],
       ['Quote currency', c.ccy || '—'],
       ['Research source', c.real ? 'SEC-filed statements' : 'Illustrative sample figures']];
  rows.forEach(([k, v]) => { kv.append(el('dt', {}, k)); kv.append(el('dd', {}, String(v))); });
  card.append(kv);

  if (!already) {
    card.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md)' }, [
      el('button', { class: 'btn btn-primary btn-sm', onclick: () => {
        plan.symbol = c.tk || c.code || '';
        plan.sourceCompanyId = c.id;
        plan.sourceTicker = c.tk || c.code || '';
        plan.sourceLinkedAt = new Date().toISOString();
        if (kind === 'qtti') {
          plan.instrumentType = 'ordinary_share';
          /* c.exch reads "SEC filer" on a filed company — that is where the
             STATEMENTS came from, not where the share trades. Filling it in as
             a venue would put a data source in a field that means exchange, on
             the one card whose job is to say what the chart shows. Left blank
             for the reader, who can see it on their own chart. */
          plan.venue = /^SEC\b/i.test(c.exch || '') ? '' : (c.exch || '');
          plan.quoteCurrency = c.ccy || '';
        }
        /* Deliberately absent: any strike, any collateral figure, any price.
           A strike seeded from a last close would make the collateral gate —
           required cash, coverage, the MYR buffer, the whole refusal — compute
           from a number the reader never entered and might never have agreed. */
        save(); toast(`Identity filled from ${c.tk || c.code}`);
      } }, 'Fill in the identity'),
      el('a', { class: 'btn btn-ghost btn-sm', href: href(companyPath(c)),
        onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
          e.preventDefault(); navigate(companyPath(c)); } }, `Back to ${c.tk || c.code}`),
    ]));
  }
  card.append(el('p', { class: 'metaline', style: 'margin-top:10px' },
    'No price, strike, collateral or attestation is carried across. Those decide whether this workspace refuses you, and a figure you did not enter must never be one of them.'));
  return card;
}

/* ------------------------------------------------------- Sarawak checklist */
/* Questions, not verdicts. Each names who can actually answer it, because the
   honest output of a calculator on a legal or physical question is "ask this
   person", not a score. */
const SARAWAK_CHECKS = [
  { id:'title-restricted', q:'Is the title Native Area Land, NCR or another restricted class?',
    who:'Lawyer and the Land and Survey Department', sev:'serious',
    steps:[
      'Instruct the lawyer to conduct an official title search at the Land and Survey Department, rather than relying on what the seller or agent states the class to be.',
      'Obtain a copy of the title document and read the class from it.',
      'Confirm any endorsements, caveats, charges or restrictions in interest recorded against it.',
      'Confirm in writing that a transfer to a buyer of your status is permitted — before any deposit is paid.',
    ],
    affects:['Whether the purchase can complete at all', 'Financing', 'Resale pool'],
    why:'Transfer of restricted classes is limited by the Sarawak Land Code. If it applies, no financial model matters until it is resolved.' },
  { id:'lease-remaining', q:'If leasehold, how many years remain and has extension been applied for?',
    who:'Lawyer, Land and Survey Department', sev:'warning',
    why:'Short remaining leases can reduce financing availability and resale demand. Confirm applicable thresholds with the intended lender.' },
  { id:'strata-issued', q:'For an apartment: has the strata title issued, or is it still a master title?',
    who:'Lawyer, developer', sev:'warning',
    why:'A pending strata title may affect transfer, financing and transaction timing. Confirm the title status and implications with the lawyer and lender.' },
  { id:'flood', q:'Is the site in an area with a known flood history?',
    steps:[
      'Ask the Department of Irrigation and Drainage (Jabatan Pengairan dan Saliran) for flood records covering the locality.',
      'Ask the local council about past events and any drainage works planned or completed.',
      'Ask neighbours and nearby shophouses about the last three flood events and how high the water reached.',
      'Read the insurance policy: flood cover is commonly an add-on rather than part of a standard fire policy. Confirm what is actually covered and at what premium.',
      'Ask the intended lender whether flood history affects their valuation or their margin of finance.',
    ],
    affects:['Insurance cost and availability', 'Vacancy between tenancies', 'Resale time', 'Financing terms'],
    who:'Local council, neighbours, DID flood maps', sev:'serious',
    basis:'General observation. No flood record, depth or return period is held for any address in this tool.',
    why:'Flooding is widely reported in parts of Kuching, Sibu and the Rajang basin, and where it recurs it can affect insurance cost and availability, tenant retention and resale. Establish the record for this specific site.' },
  { id:'single-employer', q:'Does rental demand here depend on one employer or one industry?',
    who:'Local agents, your own observation', sev:'serious',
    basis:'General observation. This tool holds no vacancy series for any Sarawak locality.',
    why:'Locations that depend heavily on one project or one employer may see higher vacancy when contracts end. Bintulu and Miri rental demand is commonly described as tracking oil, gas and heavy industry — confirm against current occupancy locally.' },
  { id:'transient-demand', q:'Is demand driven by students, O&G rotation staff or construction workers?',
    who:'Local agents', sev:'warning',
    why:'Transient demand is real demand, but it is shorter, more seasonal and more sensitive to one contract than a family tenancy.' },
  { id:'parking', q:'Is the unit hard to rent without parking?',
    who:'Local agents', sev:'warning',
    basis:'General observation. No parking-related rental differential has been measured for any Sarawak locality.',
    why:'Limited parking may reduce tenant demand in car-dependent locations. Confirm against comparable listings, recent tenancies and local agents.' },
  { id:'supply', q:'Is there substantial unsold or newly completed supply nearby?',
    who:'Developer sales offices, NAPIC data', sev:'warning',
    basis:'General observation. This tool holds no completions or unsold-stock counts.',
    why:'Competing new stock may cap achievable rent and lengthen the void period before the market absorbs it. Check what is completing nearby over your holding period.' },
  { id:'comparables', q:'Have you verified comparable rental transactions, not asking prices?',
    who:'Agents, existing tenants', sev:'serious',
    why:'The rent assumption drives every output on this page. An asking price is not a transaction.' },
  { id:'resale-time', q:'How long would a resale realistically take in this district?',
    who:'Local agents', sev:'warning',
    basis:'General observation. No time-on-market series is held for any Sarawak district.',
    why:'Secondary markets outside the main centres are commonly reported as slower to transact. Whatever that period turns out to be, its carrying cost falls on you — the exit assumption below sets it explicitly.' },
];

/* Malaysian acquisition costs. Rates are editable elsewhere in a real build;
   here they are the published scales, labelled illustrative. */
/* ==========================================================================
   FEE AND DUTY REGISTRY

   Section 46 of the migration specification: every rate, threshold and fee
   carries an effective date and a review owner. Section 29.4: fee tables are
   versioned by effective date and transaction type, and one legal-fee number
   cannot serve developer/HDA, secondary-market, auction and commercial cases.

   THE RULE THAT MAKES THIS SAFE

   An unfilled line returns null, never zero. A fee table that quietly returns
   zero for a cost nobody has entered understates the cash a buyer needs on
   completion day, which is the single most damaging thing this calculator could
   get wrong — and it would do it silently, because zero looks like an answer.
   Every consumer of this registry must handle null by showing the line as unset
   rather than by adding nothing to a total.

   THREE STATUSES, AND THEY MEAN DIFFERENT THINGS

     verified     someone checked this against the cited source on a date, and
                  their name is against it
     unverified   a working figure inherited from the prototype. It computes,
                  and nobody has checked it against the source.
     placeholder  a commonly-quoted approximation, entered so the calculator
                  runs end to end. It computes and it is NOT evidence.
     unset        no value. Returns null and reports itself as missing.

   ON PLACEHOLDERS, WHICH ARE THE DANGEROUS ONES

   An unset line is safe because it is visibly absent. A placeholder is the
   opposite: it is plausible, it produces a total that looks finished, and a
   reader has no way to tell it from a checked figure unless the product keeps
   telling them. So every placeholder is marked at every appearance, the total
   states what share of it rests on placeholders, and no placeholder can ever be
   reported as verified. They exist to make the workflow testable, not to make
   the number usable.

   The values below are approximations in general circulation. They are not
   quotations, not read off the current schedules, and several — mortgage
   protection above all — vary so widely per case that the placeholder should be
   understood as a shape rather than an amount.

   Nothing here is marked verified. Verification is a person reading the
   Solicitors' Remuneration Order 2023, the current rate orders and a lender's
   actual quote, and recording that they did.
   ========================================================================== */
const FEE_TABLE = {
  id: 'my-property-fees',
  version: '0.1.0-unverified',
  jurisdiction: 'MY',
  /* Fill these two first. Without an owner, nothing below gets re-checked when
     a schedule changes, and a stale fee table is worse than an empty one
     because it looks maintained. */
  reviewOwner: null,
  nextReviewDue: null,

  lines: {
    transferStampDuty: {
      label: 'Transfer stamp duty (MOT)',
      basis: 'scale',
      appliesTo: 'price',
      status: 'unverified',
      /* Inherited from the prototype: 1% first 100k, 2% next 400k, 3% next
         500k, 4% above 1m. Widely quoted and not verified here against the
         current Stamp Act schedule or any exemption order in force. */
      scale: [[100000, 0.01], [400000, 0.02], [500000, 0.03], [Infinity, 0.04]],
      source: 'Stamp Act 1949, First Schedule',
      sourceUrl: null,
      effectiveFrom: null, verifiedAt: null, verifiedBy: null,
      note: 'Check whether any first-home or threshold exemption applies to the buyer and the price before relying on this.',
    },
    purchaseLegal: {
      label: 'Purchase legal fees (SPA and transfer)',
      basis: 'scale',
      appliesTo: 'price',
      status: 'placeholder',
      /* The prototype used max(500, price x 1.1%) as a single flat rate. A flat
         percentage cannot reproduce a banded order at any price, so this is a
         band structure rather than a rate — and the BOUNDARIES need checking as
         much as the rates. If the real bands differ, filling correct rates into
         wrong boundaries produces a confidently wrong fee. */
      scale: [[500000, 0.0125], [500000, 0.01], [2000000, 0.007], [2000000, 0.006], [Infinity, 0.005]],
      minimumFee: 500,
      permittedDiscountPct: null,
      source: "Solicitors' Remuneration Order 2023, First Schedule",
      sourceUrl: 'https://www.malaysianbar.org.my/article/members/laws-bc-rulings-and-practice-directions/other-laws/solicitors-remuneration-order-2023/sro-2023',
      effectiveFrom: null, verifiedAt: null, verifiedBy: null,
      note: 'Scales and any permitted discount differ by transaction type. Record HDA/developer, secondary market, auction and commercial separately rather than reusing one set.',
    },
    loanLegal: {
      label: 'Loan legal fees',
      basis: 'scale',
      appliesTo: 'loan',
      status: 'placeholder',
      scale: [[500000, 0.0125], [500000, 0.01], [2000000, 0.007], [2000000, 0.006], [Infinity, 0.005]],
      minimumFee: 500,
      source: "Solicitors' Remuneration Order 2023",
      sourceUrl: 'https://www.malaysianbar.org.my/article/members/laws-bc-rulings-and-practice-directions/other-laws/solicitors-remuneration-order-2023/sro-2023',
      effectiveFrom: null, verifiedAt: null, verifiedBy: null,
      note: 'Charged on the loan amount, not the purchase price. Absent entirely from the prototype, which understated completion cash on every financed purchase.',
    },
    loanStampDuty: {
      label: 'Loan agreement stamp duty',
      basis: 'percent',
      appliesTo: 'loan',
      status: 'unverified',
      percent: 0.5,
      source: 'Stamp Act 1949',
      sourceUrl: null,
      effectiveFrom: null, verifiedAt: null, verifiedBy: null,
      note: 'Inherited from the prototype as a flat 0.5% of the loan.',
    },
    valuationFee: {
      label: 'Valuation fee',
      basis: 'scale',
      appliesTo: 'price',
      status: 'placeholder',
      scale: [[100000, 0.0025], [2000000, 0.002], [Infinity, 0.00167]],
      minimumFee: 300,
      source: 'Valuers, Appraisers, Estate Agents and Property Managers Rules',
      sourceUrl: 'https://lppeh.gov.my/',
      effectiveFrom: null, verifiedAt: null, verifiedBy: null,
      note: 'Usually required by the lender and paid by the buyer. Confirm whether the selected lender absorbs it.',
    },
    disbursements: {
      label: 'Registration, searches and disbursements',
      basis: 'fixed',
      appliesTo: null,
      status: 'placeholder',
      fixed: 1200,
      source: 'Land and Survey Department Sarawak, and the acting firm',
      sourceUrl: null,
      effectiveFrom: null, verifiedAt: null, verifiedBy: null,
      note: 'Title search, registration, land-office and firm disbursements. Ask the acting firm for a written quotation rather than estimating.',
    },
    professionalServiceTax: {
      label: 'Service tax on professional fees',
      basis: 'percentOfFees',
      appliesTo: 'legalFees',
      status: 'placeholder',
      percent: 8,
      source: 'Service Tax Act 2018 and current rate orders',
      sourceUrl: null,
      effectiveFrom: null, verifiedAt: null, verifiedBy: null,
      note: 'Applies to the professional fee, not to the purchase price. Confirm the current rate and which of the fees above it attaches to.',
    },
    mortgageProtection: {
      label: 'Mortgage protection (MRTA/MLTA)',
      basis: 'quote',
      appliesTo: null,
      status: 'placeholder',
      fixed: 8000,
      financedByDefault: false,
      source: 'Insurer quotation',
      sourceUrl: null,
      effectiveFrom: null, verifiedAt: null, verifiedBy: null,
      note: 'Depends on age, sum assured, tenure and product. Record whether the premium is paid in cash or financed into the loan — the two produce very different completion cash.',
    },
    utilityDeposits: {
      label: 'Utility and management deposits',
      basis: 'fixed',
      appliesTo: null,
      status: 'placeholder',
      fixed: 1500,
      source: 'Utility providers and the management body',
      sourceUrl: null,
      effectiveFrom: null, verifiedAt: null, verifiedBy: null,
      note: 'Refundable, and still cash the buyer must have on completion day.',
    },
  },
};

/* Resolves one line to an amount, or to an explicit reason it has none.
   Returns { amount, status, label, why } — the amount is null unless the line
   can actually be computed, and callers must not coerce that null to zero. */
function resolveFee(lineId, bases = {}) {
  const line = FEE_TABLE.lines[lineId];
  if (!line) return { amount: null, status: 'unknown', label: lineId, why: 'No such fee line.' };
  const out = { amount: null, status: line.status, label: line.label, line,
                why: line.status === 'unset' ? 'No value has been entered for this line.' : null };
  if (line.status === 'unset') return out;

  const base = line.appliesTo ? bases[line.appliesTo] : null;
  if (line.basis === 'percent') {
    if (!isNum(base) || !isNum(line.percent)) { out.why = 'Rate or base is missing.'; return out; }
    out.amount = base * line.percent / 100;
  } else if (line.basis === 'percentOfFees') {
    if (!isNum(base) || !isNum(line.percent)) { out.why = 'Rate or fee base is missing.'; return out; }
    out.amount = base * line.percent / 100;
  } else if (line.basis === 'fixed' || line.basis === 'quote') {
    if (!isNum(line.fixed)) { out.why = 'No amount has been entered.'; return out; }
    out.amount = line.fixed;
  } else if (line.basis === 'scale') {
    if (!Array.isArray(line.scale) || !isNum(base)) { out.why = 'The scale has not been filled in.'; return out; }
    let left = base, total = 0;
    for (const [size, rate] of line.scale) {
      const slice = Math.min(left, size);
      total += slice * rate; left -= slice;
      if (left <= 0) break;
    }
    if (isNum(line.minimumFee)) total = Math.max(total, line.minimumFee);
    out.amount = total;
  }
  return out;
}

/* What the registry still needs, so it can be reported rather than discovered. */
const feeLinesWith = (...statuses) => Object.entries(FEE_TABLE.lines)
  .filter(([, l]) => statuses.includes(l.status)).map(([id, l]) => ({ id, label: l.label, note: l.note }));
const unsetFeeLines = () => feeLinesWith('unset');
const unverifiedFeeLines = () => feeLinesWith('unverified');
const placeholderFeeLines = () => feeLinesWith('placeholder');
/* Anything that is not a checked figure. The distinction the reader needs is
   not which of the three unchecked statuses applies — it is checked or not. */
const unconfirmedFeeLines = () => feeLinesWith('unverified', 'placeholder', 'unset');

/* Kept as thin wrappers so existing callers keep working while the registry
   becomes the single source of the numbers. */
function stampDutyMOT(price) {
  const r = resolveFee('transferStampDuty', { price });
  return isNum(r.amount) ? r.amount : 0;
}
const loanStampDuty = (loan) => {
  const r = resolveFee('loanStampDuty', { loan });
  return isNum(r.amount) ? r.amount : 0;
};
/* Deliberately NOT restored to a working percentage. The prototype's flat 1.1%
   could not reproduce any banded remuneration order, and leaving it in place
   would keep a number on screen that nobody can check against the cited
   source — which is the defect, not the size of the number. It returns null
   until the scale is filled, and the ledger shows the line as unset. */
const legalFeesBuy = (price) => {
  const r = resolveFee('purchaseLegal', { price });
  return isNum(r.amount) ? r.amount : null;
};

/* RPGT for an individual Malaysian citizen, by completed years of holding. */
function rpgtRate(years) {
  if (years <= 3) return 30;
  if (years === 4) return 20;
  if (years === 5) return 15;
  return 0;
}

function monthlyInstalment(principal, annualRatePct, years) {
  const r = annualRatePct / 100 / 12, n = years * 12;
  if (r === 0) return principal / n;
  return principal * r / (1 - Math.pow(1 + r, -n));
}
function balanceAfter(principal, annualRatePct, years, monthsElapsed) {
  const r = annualRatePct / 100 / 12, n = years * 12;
  const pmt = monthlyInstalment(principal, annualRatePct, years);
  if (r === 0) return Math.max(0, principal - pmt * monthsElapsed);
  return Math.max(0, principal * Math.pow(1 + r, monthsElapsed) - pmt * (Math.pow(1 + r, monthsElapsed) - 1) / r);
}

/* ==========================================================================
   CITY AREA MAP

   A relative-position diagram, not a map. There is no basemap, no road, no
   coastline and no boundary — drawing one would need tiles, which means an
   external service on every page view, a licence for commercial use and a
   network dependency in a file that otherwise has none. What this shows is
   where the areas of one city sit in relation to each other, which is the
   question a buyer comparing Permyjaya with Senadin actually has.

   Every point carries the confidence its coordinate was graded with when it
   was cached. A locality is the mapped place; a named feature is the road or
   parcel carrying the area's own name; a landmark proxy is a building that
   happens to sit inside the area, and is drawn hollow because it is somewhere
   in the right neighbourhood and no more precise than that.
   ========================================================================== */
let sarawakGeo = null, sarawakIncome = null, geoLoadState = 'idle';

async function loadSarawakLayers() {
  if (geoLoadState !== 'idle') return;
  geoLoadState = 'loading';
  sarawakGeo = await fetchJson(dataUrl('sarawak-geo.json'));
  /* Git-ignored while its licence is unconfirmed, so absent is the normal
     case rather than an error. */
  sarawakIncome = await fetchJson(dataUrl('sarawak-income.json'));
  geoLoadState = 'done';
  /* Both views that draw localities, or the second one paints an empty map
     forever: the fetch resolves, the flag flips, and nothing asks again. */
  if (State.view === 'property' || State.view === 'areas') render();
}

/* ==========================================================================
   AREA ATTRIBUTES — WHAT IS TRUE OF A LOCALITY, AND WHO SAYS SO
   ==========================================================================
   A screening map wants to answer "which areas flood, and which let quickly".
   This tool holds no answer to either, and the honest response to that is not
   to shade a map with a plausible guess — a coloured polygon is the most
   persuasive thing a product can draw, and one drawn from nothing would be a
   lie a reader could act on with their deposit.

   So every attribute here is RECORDED, with a source, a date and a recorder,
   or it is absent. An area with nothing recorded is drawn as an outline, never
   as a colour on the scale, because "low risk" and "nobody has checked" must
   never look alike.

   Flood classes are ordered, so they take a sequential ramp rather than the
   status palette, which is reserved for system state. The classes come from
   how a purchaser can actually establish the fact — a DID/JPS record, a
   council record, an insurer's terms, or the neighbours' account of the last
   three events — not from a hazard model this product has no right to imply. */
/* ORDINAL CLASSES SHARE ONE COLOUR CONVENTION: DARKER IS MORE TO WORRY ABOUT.
   The tone is written on each class rather than derived from its position in
   the list, so a list can read in its natural order — none known, proposed,
   under construction, completed — while the shading still runs the way a
   reader's eye expects. Deriving tone from index would have forced drainage to
   be listed backwards to avoid shading "completed" as though it were a
   problem. */
const AREA_FLOOD = [
  { id:'none',       label:'No known history',  rank:0, tone:'--seq-2',
    note:'Checked, and no flood record or local account of flooding was found.' },
  { id:'occasional', label:'Occasional',        rank:1, tone:'--seq-4',
    note:'Flooding has happened, but not on a recurring or recent basis.' },
  { id:'recurrent',  label:'Recurrent',         rank:2, tone:'--seq-6',
    note:'Floods repeatedly, on a timescale a landlord would plan around.' },
  { id:'severe',     label:'Severe or deep',    rank:3, tone:'--seq-7',
    note:'Depth or duration sufficient to affect insurance, tenancy or resale.' },
];

const AREA_DRAINAGE = [
  { id:'none',     label:'None known',        rank:3, tone:'--seq-7',
    note:'No drainage or flood-mitigation scheme is known for this locality.' },
  { id:'proposed', label:'Proposed',          rank:2, tone:'--seq-6',
    note:'Announced or gazetted, but not started. A proposal is not a defence.' },
  { id:'building', label:'Under construction',rank:1, tone:'--seq-4',
    note:'Works have started. Disruption now, protection only when complete.' },
  { id:'done',     label:'Completed',         rank:0, tone:'--seq-2',
    note:'Works completed and in service. Record which scheme and when.' },
];

const AREA_INSURANCE = [
  { id:'ready',      label:'Readily available',   rank:0, tone:'--seq-2',
    note:'Flood cover quoted on ordinary terms.' },
  { id:'loaded',     label:'Available, loaded',   rank:1, tone:'--seq-4',
    note:'Quoted with a premium loading, a higher excess, or both.' },
  { id:'restricted', label:'Restricted',          rank:2, tone:'--seq-6',
    note:'Cover offered only with material exclusions or limits.' },
  { id:'declined',   label:'Declined',            rank:3, tone:'--seq-7',
    note:'An insurer declined flood cover for this locality. Lenders often ask.' },
];

/* TITLE CLASS IS NOMINAL, NOT ORDERED.
   Mixed Zone is not "more" than Native Area — they are different classes with
   different transfer restrictions, and a sequential ramp would invent a
   severity ordering the Sarawak Land Code does not have. So a categorical
   theme, validated for this exact five-slot subset: all six checks pass in
   both modes, worst adjacent CVD separation dE 11.3 protan in light and 9.8 in
   dark, every slot clearing 3:1 against its surface.

   `restricted` is carried as data and shown as text in the legend and the
   table. Restriction is a legal fact and may not rest on a hue. */
/* GROUND CONDITIONS — THE COST NOBODY PUTS IN THE SPREADSHEET.
   ---------------------------------------------------------------------------
   Roughly an eighth of Sarawak is peat, almost all of it in the coastal belt
   that runs from Kuching through Sarikei and Mukah to Bintulu — which is also
   where most of the state's people and most of its buildable land are. On deep
   peat a building is piled to a competent stratum and stands still; everything
   NOT piled — the driveway, the apron, the drains, the boundary wall, the
   service connections — sits on ground that keeps consolidating for decades
   after the drains go in.

   That is not a hazard in the flood sense. It is a cost, and it lands years
   after completion, on the exact line items a rental model treats as trivial.
   A calculator that models a 4.3% interest rate to two decimal places and says
   nothing about whether the plot needs 18-metre piles is precise about the
   wrong thing.

   The classes are what a soil investigation report says, in the words it says
   them. Nothing here is inferred from the map: a locality's ground is recorded
   from a borehole log, a neighbour's piling record, or the engineer who did the
   scheme next door, and until somebody records it the answer is that nobody
   here knows. */
const AREA_GROUND = [
  { id:'rock',        label:'Rock or dense residual', rank:0, tone:'--seq-2',
    note:'Competent stratum near the surface. Conventional footings; no settlement expected.' },
  { id:'residual',    label:'Residual soil',          rank:1, tone:'--seq-3',
    note:'Weathered in place, typically on higher ground. Conventional foundations usually adequate; slope stability becomes the question instead.' },
  { id:'alluvial',    label:'Soft alluvial clay',     rank:2, tone:'--seq-4',
    note:'River or coastal deposit. Piling generally required for anything above a single storey, and long-term settlement of unpiled ground is normal.' },
  { id:'peat-shallow',label:'Peat, under 3 m',        rank:3, tone:'--seq-5',
    note:'Piled through to a competent stratum. The building stands; aprons, drives, drains and boundary walls settle around it and need re-levelling.' },
  { id:'peat-deep',   label:'Peat, 3 m or deeper',    rank:4, tone:'--seq-7',
    note:'Deep piling, and it is the dominant cost of building. Surrounding ground consolidates for decades after drainage; service connections and drainage falls are recurring maintenance, not one-off defects.' },
  { id:'fill',        label:'Filled or reclaimed',    rank:4, tone:'--seq-6',
    note:'Made ground of unrecorded origin and compaction. Until the fill is characterised, nothing about foundation cost can be assumed — this is the class that most often turns out worse than expected.' },
];

/* COASTAL AND SUBSIDENCE EXPOSURE — WHAT IS OBSERVED, NOT WHAT IS FORECAST.
   ---------------------------------------------------------------------------
   Deliberately separate from ground conditions, because the two answer
   different questions and a reader needs both. Ground conditions say what the
   soil IS. This says what is currently happening to the site because of where
   it sits: tide, shoreline, salt, or ground going down.

   Sarawak's subsidence is overwhelmingly peat consolidation following drainage,
   not tectonic movement — which matters, because it means the cause is usually
   a drainage scheme somebody built, the rate is highest in the first years
   after it, and it is a thing a neighbour can describe. So it is recorded as an
   observation with a date, and the date is load-bearing: "settling" in 2009 and
   "settling" in 2026 are different statements about the same plot.

   No forecast is offered and none should be inferred. This product holds no
   subsidence model, no sea-level projection and no shoreline survey. */
const AREA_COASTAL = [
  { id:'none',      label:'None known',           rank:0, tone:'--seq-2',
    note:'Checked, and no tidal influence, shoreline retreat, salinity or settlement was found or reported.' },
  { id:'tidal',     label:'Tidal influence',      rank:1, tone:'--seq-4',
    note:'Tide backs up the drainage on spring tides, whether or not the site has ever flooded. Sets a floor under how well the site can ever drain.' },
  { id:'saline',    label:'Saline intrusion',     rank:2, tone:'--seq-5',
    note:'Salt in groundwater or supply. Attacks reinforcement and shortens the life of concrete and buried services; a durability cost rather than an event.' },
  { id:'settling',  label:'Ground settling',      rank:3, tone:'--seq-6',
    note:'Ground movement observed — stepped cracking, doors out of square, aprons parting from the building, services pulled apart. Record when it was observed; the rate matters more than the fact.' },
  { id:'erosion',   label:'Shoreline or bank erosion', rank:4, tone:'--seq-7',
    note:'Active loss of land at the coast or riverbank. The only class here where the parcel itself can shrink, and the one to verify against a survey rather than an account.' },
];

const AREA_TITLE = TITLE_TYPES.filter(t => t.id !== 'unknown').map((t, i) => ({
  id: t.id, label: t.label, note: t.note, restricted: !!t.restricted,
  tone: `--s${i + 1}`,
}));

const FLOOD_BY_ID = Object.fromEntries(AREA_FLOOD.map(f => [f.id, f]));

/* Where an area fact can legitimately come from. Anything else is hearsay and
   is recorded as such rather than refused — a half-remembered account is worth
   writing down before it is lost, provided it is never shown as a finding. */
const AREA_SOURCES = [
  { id:'did',       label:'DID / JPS flood record', verified:true },
  { id:'council',   label:'Local council record',   verified:true },
  { id:'insurer',   label:'Insurer terms or quote', verified:true },
  { id:'valuer',    label:'Valuer or agent report', verified:true },
  { id:'site',      label:'Own site visit',         verified:true },
  /* ADDED WITH GROUND CONDITIONS AND TITLE, BECAUSE NEITHER HAD A SOURCE TO
     NAME. The list was written for flood and insurance and covered those well;
     a borehole log had to be filed as "own site visit" and a title search as a
     "local council record", which is not where either comes from. A provenance
     ladder that cannot name the actual authority quietly turns every reading
     into an approximation of itself. */
  { id:'landsurvey', label:'Land and Survey Department', verified:true },
  { id:'soil',      label:'Soil investigation or borehole log', verified:true },
  { id:'engineer',  label:'Engineer or piling contractor record', verified:true },
  { id:'surveyor',  label:'Licensed land surveyor',   verified:true },
  { id:'neighbour', label:'Neighbour or occupier account', verified:false },
  { id:'unstated',  label:'Not stated',             verified:false },
];
const AREA_SOURCE_BY_ID = Object.fromEntries(AREA_SOURCES.map(s => [s.id, s]));

/* THE FIVE RECORDABLE FACTS ABOUT A LOCALITY.
   Each is stored the same way — a class or a number, a source, a date, a
   reference — so the recorder, the map, the table and the filters are written
   once rather than five times, and a sixth attribute is a row here rather than
   a new subsystem. `caveat` prints wherever the attribute is shown; the title
   one is not optional wording. */
const AREA_ATTRS = [
  { id:'flood', label:'Flood exposure', short:'Flood', kind:'class', classes:AREA_FLOOD,
    why:'Recorded from a DID/JPS record, a council record, an insurer or a site account. Nothing is inferred.' },
  { id:'title', label:'Predominant title class', short:'Title', kind:'class', classes:AREA_TITLE,
    why:'The class most of this locality is held under. Individual titles vary and only the title document is authoritative.',
    caveat:'Title classification recorded from user input. Eligibility has not been verified. Confirm with a Sarawak property lawyer and the Land and Survey Department.' },
  { id:'drainage', label:'Drainage or mitigation works', short:'Drainage', kind:'class', classes:AREA_DRAINAGE,
    why:'Whether a drainage or flood-mitigation scheme exists for this locality, and how far along it is.' },
  { id:'insurance', label:'Flood cover appetite', short:'Insurance', kind:'class', classes:AREA_INSURANCE,
    why:'What an insurer actually quoted for this locality. Record the insurer and the date — appetite moves after a flood year.' },
  { id:'ground', label:'Ground conditions', short:'Ground', kind:'class', classes:AREA_GROUND,
    why:'Recorded from a soil investigation report, a piling record, or the engineer on a neighbouring scheme. Never inferred from the map.',
    caveat:'Ground conditions are recorded from user input and have not been verified. A soil investigation is the only authority on what a site will cost to build on.' },
  { id:'coastal', label:'Coastal and subsidence exposure', short:'Coastal', kind:'class', classes:AREA_COASTAL,
    why:'What is observed at the site now — tide, salt, settlement or erosion. This product holds no subsidence model and no shoreline survey, and offers no forecast.' },
  { id:'lease', label:'Typical remaining lease', short:'Lease', kind:'number', unit:'years', invert:true,
    why:'Years remaining on the predominant title in this locality. Shorter terms shade darker, because a short residue affects both financing and resale.' },
];
const ATTR_BY_ID = Object.fromEntries(AREA_ATTRS.map(a => [a.id, a]));
const attrClass = (attr, id) => (attr.classes || []).find(c => c.id === id) || null;

State.areaProfiles = store.read('areaProfiles', {});
const saveAreaProfiles = () => store.write('areaProfiles', State.areaProfiles);
const areaKey = (city, area) => `${city}|${area}`;
const areaProfile = (city, area) => State.areaProfiles[areaKey(city, area)] || null;
const areaAttr = (city, area, attrId) => areaProfile(city, area)?.[attrId] || null;

/* One writer for all five. `rec` null removes the attribute, and an area whose
   last attribute is removed leaves no empty husk behind in storage. */
function setAreaAttr(city, area, attrId, rec) {
  const k = areaKey(city, area);
  const prev = { ...(State.areaProfiles[k] || {}) };
  const was = prev[attrId] || null;
  if (rec) prev[attrId] = { ...rec, recordedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') };
  else delete prev[attrId];
  /* Logged BEFORE the projection is written. If the write throws — a full
     localStorage quota is the realistic case — the history still says what was
     attempted, which is the more useful of the two records to keep. */
  recordAreaAttr(k, attrId, was, rec ? prev[attrId] : null);
  if (Object.keys(prev).length) State.areaProfiles[k] = prev;
  else delete State.areaProfiles[k];
  saveAreaProfiles();
}

/* WHAT THE REGISTER ALREADY KNOWS ABOUT AN AREA.
   Derived, never stored: the observations are the record, and a cached summary
   beside them is a second answer waiting to disagree with the first.

   `lettingWeeks` is the closest honest proxy for demand this tool holds — how
   long places actually stood empty. It is reported as what it is and never as
   a "demand score", because a score would imply a model that does not exist. */
function areaMetrics(city, area) {
  const rows = (State.observations || []).filter(o => o.city === city && o.area === area);
  const med = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const nums = (id, f) => rows.filter(o => o.kind === id && isNum(f(o))).map(f);
  const achieved = nums('let-rent', o => o.value);
  const asking   = nums('ask-rent', o => o.value);
  const sold     = nums('sold-price', o => o.value);
  const weeks    = nums('vacancy', o => o.value);

  /* RATES ARE HELD IN SQUARE FEET AND CONVERTED AT DISPLAY.
     One stored rate per measure, converted by the reader's chosen unit, so
     RM/m² and RM/sq ft can never disagree by a rounding step — they are the
     same number seen twice. */
  const perSqft = (kind, areaField) => rows
    .filter(o => o.kind === kind && isNum(o.value) && isNum(o[areaField]) && o[areaField] > 0)
    .map(o => o.value / o[areaField]);

  const psf      = perSqft('sold-price', 'sqft');          /* built-up, transacted */
  const landPsf  = perSqft('land-sold', 'landSqft');       /* land, transacted */
  /* A service charge is monthly, so its rate is monthly too. Stated in the
     column heading rather than folded into the number. */
  const mgmtPsf  = perSqft('mgmt-fee', 'sqft');

  /* THE LAST TRANSACTED PRICE — the one figure an owner asks for first.
     Chosen by the date the transaction happened, not the date it was keyed in:
     a record entered today about a 2019 sale is not the latest transaction, and
     sorting by recordedAt would say it was. Asking prices are excluded on
     purpose; a quote is not a transaction. */
  const lastOf = (kind) => rows
    .filter(o => o.kind === kind && isNum(o.value) && o.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;
  const lastSold = lastOf('sold-price');
  const lastLand = lastOf('land-sold');

  /* Which ownership classes the records themselves carry, as opposed to the one
     class recorded for the locality as a whole. A district recorded as mixed
     zone whose transactions are all native area land is telling you something
     the locality-level attribute cannot. */
  const titleMix = rows.reduce((m, o) => {
    if (o.titleType) m[o.titleType] = (m[o.titleType] || 0) + 1;
    return m;
  }, {});

  return {
    total: rows.length,
    achievedRent: med(achieved), achievedN: achieved.length,
    askingRent: med(asking), askingN: asking.length,
    soldN: sold.length, psf: med(psf), psfN: psf.length,
    landPsf: med(landPsf), landPsfN: landPsf.length,
    mgmtPsf: med(mgmtPsf), mgmtPsfN: mgmtPsf.length,
    lastSold, lastLand,
    titleMix,
    lettingWeeks: med(weeks), lettingN: weeks.length,
    verifiedN: rows.filter(o => observationStanding(o).id === 'verified').length,
    /* How many of the rows behind these medians are worked-example figures.
       The area screen shades a map from them, so it has to be able to say. */
    sampleN: rows.filter(o => o.sample).length,
  };
}

/* THE LAYERS THE MAP AND THE FILTERS SHARE.
   One definition, so a colour on the map and a column in the table can never
   disagree about what an area is. `value` returns null for "nothing recorded",
   which the map draws as an outline and the table prints as a dash — the two
   renderings of the same absence. */
/* WHICH UNIT RATES ARE READ IN.
   Two preferences, not one: floor area is discussed in square feet or square
   metres and land in points or acres, and a single control forcing both to the
   same unit would produce "0.06 points of floor area", which is true and
   useless. Persisted, because a reader who thinks in points thinks in points
   every time they open the page. */
State.rateUnits = {
  built: store.read('rateUnitBuilt', 'sqft'),
  land: store.read('rateUnitLand', 'point'),
};
const setRateUnit = (which, id) => {
  State.rateUnits[which] = id;
  store.write(which === 'built' ? 'rateUnitBuilt' : 'rateUnitLand', id);
};
const builtUnit = () => State.rateUnits.built;
const landUnit = () => State.rateUnits.land;

/* A rate stored per square foot, shown per whatever unit is selected. The
   stored figure never changes; only the divisor does. */
const rateInUnit = (perSqft, unit) => (isNum(perSqft) ? perSqft * areaUnit(unit).per : null);

const AREA_LAYERS = [
  /* The recorded attributes, in registry order, so adding one adds a layer. */
  ...AREA_ATTRS.map(attr => attr.kind === 'class' ? {
    id: attr.id, label: attr.label, kind:'class', attr, unit:'',
    why: attr.why, caveat: attr.caveat,
    value:(c, a) => areaAttr(c, a, attr.id)?.class || null,
    text:(c, a) => attrClass(attr, areaAttr(c, a, attr.id)?.class)?.label || null,
  } : {
    id: attr.id, label: attr.label, kind:'quantity', attr, unit: attr.unit,
    invert: attr.invert, why: attr.why, caveat: attr.caveat,
    value:(c, a) => { const v = areaAttr(c, a, attr.id)?.value; return isNum(v) ? v : null; },
    text:(c, a) => { const v = areaAttr(c, a, attr.id)?.value; return isNum(v) ? `${fmtNum(v, 0)} ${attr.unit}` : null; },
  }),
  { id:'achievedRent', label:'Achieved rent, median', kind:'quantity',
    unit:'RM/month', why:'Median of the achieved rents you have recorded for this area. Asking rents are excluded.',
    value:(c, a) => areaMetrics(c, a).achievedRent,
    text:(c, a) => { const v = areaMetrics(c, a).achievedRent; return isNum(v) ? fmtMoney(v, 'MYR', 0) : null; } },
  { id:'lettingWeeks', label:'Weeks vacant, median', kind:'quantity', invert:true,
    unit:'weeks', why:'Median weeks vacant from your own records. This is how long places actually stood empty — it is not a demand score, and no model produces one here.',
    value:(c, a) => areaMetrics(c, a).lettingWeeks,
    text:(c, a) => { const v = areaMetrics(c, a).lettingWeeks; return isNum(v) ? `${fmtNum(v, 1)} wks` : null; } },

  /* BUILT-UP PRICE, in whichever floor-area unit is selected. */
  { id:'psf', label:'Transacted price per unit of floor', kind:'quantity', rateUnit:'built',
    unit:'', why:'Median of transacted prices divided by recorded floor area. Asking prices are excluded, and a record with no floor area cannot contribute.',
    value:(c, a) => rateInUnit(areaMetrics(c, a).psf, builtUnit()),
    text:(c, a) => { const v = rateInUnit(areaMetrics(c, a).psf, builtUnit());
      return isNum(v) ? `${fmtMoney(v, 'MYR', rateDp(builtUnit()))}/${areaUnit(builtUnit()).short}` : null; } },

  /* LAND PRICE, in whichever land unit is selected — points by default, which
     is the unit the transaction was almost certainly negotiated in. */
  { id:'landPsf', label:'Transacted land price per unit', kind:'quantity', rateUnit:'land',
    unit:'', why:'Median of transacted LAND prices divided by recorded land area. A separate measure from the floor-area rate above, not a conversion of it — a shophouse has both and they are different numbers.',
    value:(c, a) => rateInUnit(areaMetrics(c, a).landPsf, landUnit()),
    text:(c, a) => { const v = rateInUnit(areaMetrics(c, a).landPsf, landUnit());
      return isNum(v) ? `${fmtMoney(v, 'MYR', rateDp(landUnit()))}/${areaUnit(landUnit()).short}` : null; } },

  /* MANAGEMENT CHARGE, per unit of floor per month. */
  { id:'mgmtPsf', label:'Management charge per unit of floor', kind:'quantity', invert:true, rateUnit:'built',
    unit:'', why:'Median monthly service charge divided by recorded floor area. Higher shades darker: this is a cost, and the one that most often makes a yield calculation wrong after completion.',
    value:(c, a) => rateInUnit(areaMetrics(c, a).mgmtPsf, builtUnit()),
    text:(c, a) => { const v = rateInUnit(areaMetrics(c, a).mgmtPsf, builtUnit());
      return isNum(v) ? `${fmtMoney(v, 'MYR', 2)}/${areaUnit(builtUnit()).short}/mo` : null; } },

  /* WHEN, not how much — the map shades by how stale the newest transaction is.
     An area whose last recorded sale was in 2019 is not comparable to one that
     transacted last month, and a price column alone hides that entirely. */
  { id:'lastSoldAge', label:'Age of the last transacted price', kind:'quantity', invert:true,
    unit:'months', why:'Months since the most recent transaction you have recorded, by the date it happened rather than the date it was keyed in. Nothing recorded means unexamined, not current.',
    value:(c, a) => { const m = areaMetrics(c, a); const l = m.lastSold || m.lastLand;
      return l ? monthsSince(l.date) : null; },
    text:(c, a) => { const m = areaMetrics(c, a); const l = m.lastSold || m.lastLand;
      if (!l) return null; const n = monthsSince(l.date);
      return isNum(n) ? `${fmtNum(n, 0)} mo` : null; } },

  { id:'evidence', label:'Records held', kind:'quantity',
    unit:'records', why:'How much evidence you hold for this area at all. An area with none is not a low-risk area; it is an unexamined one.',
    value:(c, a) => areaMetrics(c, a).total || null,
    text:(c, a) => { const v = areaMetrics(c, a).total; return v ? `${v}` : null; } },
];

/* Whole months between a recorded date and today. Null for an unparseable or
   future date rather than a negative age, which would shade a typo as the
   freshest evidence on the map. */
function monthsSince(iso) {
  if (!iso) return null;
  const then = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(then.getTime())) return null;
  const months = (Date.now() - then.getTime()) / (1000 * 60 * 60 * 24 * 30.4375);
  return months < 0 ? null : months;
}
const LAYER_BY_ID = Object.fromEntries(AREA_LAYERS.map(l => [l.id, l]));

/* Five steps of one hue. A quantity is banded against the range PRESENT IN
   THIS CITY rather than an absolute scale, because RM1,800 means something
   different in Kuching and in Bintulu, and the map is read one city at a time. */
const SEQ_STEPS = ['--seq-2', '--seq-3', '--seq-4', '--seq-6', '--seq-7'];
function layerBands(layer, cityId, areaNames) {
  if (layer.kind === 'class') return { kind:'class' };
  const vals = areaNames.map(n => layer.value(cityId, n)).filter(isNum);
  if (!vals.length) return null;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  return { kind:'quantity', lo, hi };
}
function layerColour(layer, bands, v) {
  if (v == null || !bands) return null;
  /* A class carries its own tone, whether it came from the sequential ramp
     (flood, drainage, insurance) or the categorical theme (title). One lookup
     for both, because the difference between them is which tokens the class
     list was given, not how a colour is found. */
  if (bands.kind === 'class') {
    const c = attrClass(layer.attr, v);
    return c ? `var(${c.tone})` : null;
  }
  if (!isNum(v)) return null;
  const span = bands.hi - bands.lo;
  let t = span > 0 ? (v - bands.lo) / span : 0.5;
  if (layer.invert) t = 1 - t;
  return `var(${SEQ_STEPS[Math.min(SEQ_STEPS.length - 1, Math.floor(t * SEQ_STEPS.length))]})`;
}

const AREA_CONFIDENCE = {
  'locality':       { r:6.5, fill:true,  label:'Mapped locality' },
  'named-feature':  { r:5.5, fill:true,  label:'Road or parcel of the same name' },
  'city-point':     { r:8,   fill:false, label:'City centre point' },
  'landmark-proxy': { r:5,   fill:false, label:'A landmark inside the area' },
};

/* Equirectangular, corrected for latitude. Over one city this is accurate to
   well under the precision the points themselves have. */
/* `paint` is optional. Without it this is the locality map it always was; with
   it, each point takes the layer's colour and an area with nothing recorded
   keeps a hollow, dashed mark. That distinction is the whole point: an
   unexamined area must never be able to look like a safe one. */
function cityMap(cityId, selectedArea, onPick, paint) {
  const city = sarawakGeo?.cities?.[cityId];
  const areas = Object.entries(city?.areas || {});
  const host = el('div', { style: 'width:100%' });
  if (!areas.length) return host;

  chartHost(host, (w) => {
    const pad = 40;
    const lats = areas.map(([, a]) => a.lat), lons = areas.map(([, a]) => a.lon);
    const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const kx = Math.cos(midLat * Math.PI / 180);
    const xs = lons.map(l => l * kx), ys = lats.map(l => -l);
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
    const spanX = (x1 - x0) || 0.01, spanY = (y1 - y0) || 0.01;
    /* One scale for both axes — a map with two is not a map — with the height
       following from the data rather than a chosen ratio, so a city that is
       long north-to-south gets a tall box instead of a wide empty one. */
    const inner = w - pad * 2;
    const MAXH = 460;
    /* Fit width first, then shrink if the resulting height would exceed the
       ceiling — a clamp applied after the scale was chosen pushed points
       outside the viewBox, which drew a map with areas missing off the top. */
    const scale = Math.min(inner / spanX, (MAXH - pad * 2) / spanY);
    const H = Math.round(Math.max(200, Math.min(MAXH, spanY * scale + pad * 2)));
    const sx = (v) => (v - (x0 + x1) / 2) * scale + Math.min(w, Math.round(spanX * scale + pad * 2)) / 2;
    const sy = (v) => pad + (v - (y0 + y1) / 2) * scale + (H - pad * 2) / 2;

    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    /* The box hugs the points: viewBox spans the content, and the element is
       centred rather than stretched. */
    const contentW = Math.min(w, Math.round(spanX * scale + pad * 2));
    svg.setAttribute('viewBox', `0 0 ${contentW} ${H}`);
    svg.setAttribute('width', String(contentW)); svg.setAttribute('height', String(H));
    svg.setAttribute('style', 'display:block;margin:0 auto;max-width:100%');
    svg.setAttribute('role', 'img');
    /* Built by hand rather than through the chart layer, so it needed the tab
       stop adding separately — and did not have one. */
    svg.setAttribute('tabindex', '0');
    svg.classList.add('chart-focusable');
    svg.setAttribute('aria-label',
      `Relative positions of ${areas.length} areas in ${city.name}. The table below lists the same information.`);

    const mk = (n, attrs = {}) => { const e = document.createElementNS(NS, n);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

    svg.append(mk('rect', { x:0, y:0, width:contentW, height:H, rx:10, fill:'var(--surface-sunk)' }));

    /* A scale bar, because a diagram with no basemap gives no sense of size. */
    const kmPerDeg = 111.32;
    /* scale is pixels per degree, so a bar of n km is n/111.32 degrees of it.
       Derived from scale rather than from a span variable, which is what broke
       this: the spans were split into x and y and the bar kept referencing the
       old single name, throwing inside a ResizeObserver callback where the
       error surfaced as an empty box rather than as a stack trace. */
    const targetKm = (w - pad * 2) / scale * kmPerDeg / 3;
    const niceKm = [1, 2, 5, 10, 20, 50, 100].find(v => v >= targetKm) || 100;
    const barPx = (niceKm / kmPerDeg) * scale;
    const by = H - 14;
    svg.append(mk('line', { x1:pad, y1:by, x2:pad + barPx, y2:by, stroke:'var(--ink-3)', 'stroke-width':2 }));
    const sl = mk('text', { x:pad + barPx + 6, y:by + 4, fill:'var(--ink-3)', 'font-size':12 });
    sl.textContent = `${niceKm} km`; svg.append(sl);

    /* Two adjacent areas put their labels in the same place — "Marina" and
       "City centre" overlapped and read as one word. Each label claims a box;
       a label whose box hits one already claimed flips beneath its point, and
       flips back only if that is clear too. */
    const claimed = [], unlabelled = [];
    /* Every marker is an obstacle from the start, so a label never lands on a
       point belonging to a different area. */
    areas.forEach(([, a]) => {
      const cf0 = AREA_CONFIDENCE[a.confidence] || AREA_CONFIDENCE['landmark-proxy'];
      const px = (a.lon * kx - (x0 + x1) / 2) * scale + Math.min(w, Math.round(spanX * scale + pad * 2)) / 2;
      const py = pad + (-a.lat - (y0 + y1) / 2) * scale + (H - pad * 2) / 2;
      /* Include the selection ring, which extends 5px beyond the marker. */
      const rr = cf0.r + 3 + (a === (city.areas[selectedArea]) ? 5 : 0);
      claimed.push({ x1:px - rr, x2:px + rr, y1:py - rr, y2:py + rr });
    });
    const hits = (b) => claimed.some(c => !(b.x2 < c.x1 || b.x1 > c.x2 || b.y2 < c.y1 || b.y1 > c.y2));

    areas.forEach(([name, a]) => {
      const cf = AREA_CONFIDENCE[a.confidence] || AREA_CONFIDENCE['landmark-proxy'];
      const cx = sx(a.lon * kx), cy = sy(-a.lat);
      const on = name === selectedArea;
      const g = mk('g', { tabindex:'0', role:'button', style:'cursor:pointer',
        'aria-label': name + '. ' + cf.label + '. '
          + (paint ? (paint.describe ? paint.describe(name) + '. ' : '') : '')
          + (State.observations || []).filter(o => o.city === cityId && o.area === name).length
          + ' observation(s) recorded. ' + (on ? 'Currently selected.' : 'Select this area.') });

      /* AN INVISIBLE HIT CIRCLE, FIRST IN THE GROUP.
         The visible point is 6.5px and the whole group measured 11x11 — a
         target a fingertip cannot reliably land on, and there are eight of
         them packed into one map. Enlarging the mark would turn a locality map
         into a scatter of blobs and destroy the spatial reading it exists for,
         so the target grows and the mark does not: r=22 gives the 44px
         diameter the standard asks for. Painted first so it sits beneath the
         real circles, and fill 'transparent' rather than 'none' because a hit
         test ignores an unfilled shape. */
      g.append(mk('circle', { cx, cy, r:22, fill:'transparent', stroke:'none' }));

      /* A ring behind the selected point rather than a colour change, so the
         selection survives a colourblind reading. */
      if (on) g.append(mk('circle', { cx, cy, r:cf.r + 5, fill:'none',
        stroke:'var(--brand)', 'stroke-width':2 }));
      const shade = paint ? paint(name) : null;
      if (shade) {
        /* Painted larger than the plain locality dot, because when the map is
           carrying a measurement the measurement is the subject and the point
           is only where it sits. */
        g.append(mk('circle', { cx, cy, r: cf.r + 2.5, fill: shade,
          stroke:'var(--surface)', 'stroke-width':1.5 }));
      } else if (paint) {
        /* Nothing recorded. Hollow and dashed — the same treatment the tool
           uses everywhere for "not tested", and deliberately not a pale step
           of the ramp, which would read as a low value. */
        g.append(mk('circle', { cx, cy, r: cf.r + 1, fill:'none',
          stroke:'var(--ink-3)', 'stroke-width':1.4, 'stroke-dasharray':'3 2' }));
      } else {
        g.append(mk('circle', { cx, cy, r:cf.r,
          fill: cf.fill ? 'var(--brand)' : 'var(--surface)',
          stroke:'var(--brand)', 'stroke-width': cf.fill ? 1 : 1.6,
          'stroke-dasharray': a.confidence === 'landmark-proxy' ? '3 2' : 'none' }));
      }
      /* A count badge where something has been recorded. The map is the
         natural place to see which areas you have evidence for and which are
         still blank. */
      const obsN = (State.observations || []).filter(o => o.city === cityId && o.area === name).length;
      if (obsN) {
        g.append(mk('circle', { cx:cx + cf.r + 4, cy:cy - cf.r - 2, r:7,
          fill:'var(--bronze)', stroke:'var(--surface)', 'stroke-width':1.5 }));
        const bt = mk('text', { x:cx + cf.r + 4, y:cy - cf.r + 1.5, 'text-anchor':'middle',
          'font-size':12, 'font-weight':700, fill:'var(--surface)' });
        bt.textContent = String(obsN); g.append(bt);
      }

      const halfW = name.length * 3.05 + 4, lh = 13, gap = cf.r + 4;
      /* Tried in order of legibility: centred above, centred below, then to
         either side. The first placement that collides with nothing wins; if
         all four are taken the label goes above anyway, because a slightly
         crowded label is better than a missing one. */
      const places = [
        { x:cx, y:cy - gap - 3, anchor:'middle', box:{ x1:cx - halfW, x2:cx + halfW, y1:cy - gap - 3 - lh, y2:cy - gap } },
        { x:cx, y:cy + gap + 11, anchor:'middle', box:{ x1:cx - halfW, x2:cx + halfW, y1:cy + gap, y2:cy + gap + 13 } },
        { x:cx + gap + 4, y:cy + 4, anchor:'start', box:{ x1:cx + gap + 4, x2:cx + gap + 4 + halfW * 2, y1:cy - 6, y2:cy + 7 } },
        { x:cx - gap - 4, y:cy + 4, anchor:'end', box:{ x1:cx - gap - 4 - halfW * 2, x2:cx - gap - 4, y1:cy - 6, y2:cy + 7 } },
        /* Diagonals, for clusters where the four cardinal slots are all taken —
           Bintulu packs six areas around the town with Samalaju far out, and
           four placements left three labels overlapping. */
        { x:cx + gap, y:cy - gap, anchor:'start', box:{ x1:cx + gap, x2:cx + gap + halfW * 2, y1:cy - gap - lh, y2:cy - gap + 2 } },
        { x:cx - gap, y:cy - gap, anchor:'end',   box:{ x1:cx - gap - halfW * 2, x2:cx - gap, y1:cy - gap - lh, y2:cy - gap + 2 } },
        { x:cx + gap, y:cy + gap + 8, anchor:'start', box:{ x1:cx + gap, x2:cx + gap + halfW * 2, y1:cy + gap - 2, y2:cy + gap + 11 } },
        { x:cx - gap, y:cy + gap + 8, anchor:'end',   box:{ x1:cx - gap - halfW * 2, x2:cx - gap, y1:cy + gap - 2, y2:cy + gap + 11 } },
      ];
      const inside = (b) => b.x1 >= 2 && b.x2 <= contentW - 2 && b.y1 >= 2 && b.y2 <= H - 2;
      const place = places.find(pl => !hits(pl.box) && inside(pl.box));

      /* Bintulu spans 0.9km to 62km — Samalaju is 57km from a town centre that
         has six areas within two kilometres of it. At a scale that fits the
         outlier those six are a few pixels apart, and no placement rule can
         separate their labels because the geometry does not separate them.
         Printing overlapping text would be worse than printing none: the
         selected area is always labelled, the rest stay clickable and remain in
         the table, and the caption reports how many were left off. */
      if (place || on) {
        const put = place || places[0];
        claimed.push(put.box);
        const t = mk('text', { x:put.x, y:put.y,
          'text-anchor':put.anchor, 'font-size':12, 'font-weight': on ? 640 : 500,
          fill: on ? 'var(--ink)' : 'var(--ink-2)' });
        t.textContent = name;
        g.append(t);
      } else unlabelled.push(name);

      const pick = () => onPick && onPick(name);
      g.addEventListener('click', pick);
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      svg.append(g);
    });

    if (unlabelled.length) {
      const note = mk('text', { x:contentW / 2, y:16, 'text-anchor':'middle',
        'font-size':12, fill:'var(--ink-3)' });
      note.textContent = `${unlabelled.length} label${unlabelled.length > 1 ? 's' : ''} hidden — areas too close to separate`;
      svg.append(note);
    }
    return svg;
  });
  return host;
}

/* ==========================================================================
   METRIC DICTIONARY — ONE DEFINITION, THREE LANGUAGES

   English carries the full analytical product. Bahasa Malaysia and Chinese
   carry the property calculator's summary, which is where a Sarawak buyer
   most needs to read in their own language and least needs the surrounding
   equity apparatus.

   The rule that matters: one dictionary, not three. A term translated
   separately in three places drifts, and a metric that means one thing in
   English and a slightly different thing in Bahasa is a worse failure than
   leaving it untranslated — the reader cannot see the discrepancy. Formulas
   are never restated per language; only the label moves.
   ========================================================================== */
const LANGUAGES = [
  { id:'en', label:'English',          native:'English' },
  { id:'ms', label:'Bahasa Malaysia',  native:'Bahasa Malaysia' },
  { id:'zh', label:'Chinese',          native:'简体中文' },
];

const METRIC_DICTIONARY = {
  grossYield:      { en:'Gross yield',              ms:'Hasil sewa kasar',        zh:'租金毛回报率' },
  netCashFlow:     { en:'Net cash flow',            ms:'Aliran tunai bersih',     zh:'净现金流' },
  breakEvenRent:   { en:'Break-even rent',          ms:'Sewa pulang modal',       zh:'收支平衡租金' },
  dataCompleteness:{ en:'Data completeness',        ms:'Kelengkapan data',        zh:'数据完整度' },
  baseCaseModel:   { en:'Base-case model estimate', ms:'Anggaran model kes asas', zh:'基准情景模型估值' },
  netYield:        { en:'Net yield',                ms:'Hasil sewa bersih',       zh:'租金净回报率' },
  totalInitialCash:{ en:'Total initial cash',       ms:'Jumlah tunai permulaan',  zh:'初始现金总额' },
  monthlyInstalment:{ en:'Monthly instalment',      ms:'Ansuran bulanan',         zh:'每月供款' },
  vacancy:         { en:'Vacancy',                  ms:'Kekosongan',              zh:'空置率' },
  evidenceQuality: { en:'Evidence quality',         ms:'Kualiti bukti',           zh:'证据质量' },
};

/* The property workflow itself, not only its summary.
   ---------------------------------------------------------------------------
   The summary was translated and the reasoning behind it was not, which meant a
   Bahasa or Chinese reader could see the outputs and not the assumptions
   producing them — the least useful half to translate first, in a product whose
   argument is that the assumptions are the point.

   Sarawak statutory land classes keep the English term alongside the local one,
   because a buyer has to match what they read here against what is printed on a
   title document. Malaysian tax terms use the words that appear on the actual
   bill — cukai pintu for assessment, cukai tanah for quit rent — rather than a
   literal rendering nobody would recognise on a council notice. */
const PROPERTY_I18N = {
  /* evidence quality */
  'ev.verified':  { en:'Verified transaction', ms:'Transaksi disahkan', zh:'已核实交易' },
  'ev.public':    { en:'Public data', ms:'Data awam', zh:'公开数据' },
  'ev.user':      { en:'You supplied', ms:'Daripada anda', zh:'您提供' },
  'ev.developer': { en:'Developer supplied', ms:'Daripada pemaju', zh:'发展商提供' },
  'ev.estimated': { en:'Estimated', ms:'Anggaran', zh:'估算' },
  'ev.assumed':   { en:'Assumed', ms:'Andaian', zh:'假设' },
  /* the ten risk questions */
  'chk.title-restricted': { en:'Is the title Native Area Land, NCR or another restricted class?', ms:'Adakah hakmilik ini Tanah Kawasan Bumiputera (Native Area Land), NCR atau kelas terhad lain?', zh:'地契是否属土著地区土地（Native Area Land）、土著习俗地（NCR）或其他受限地类？' },
  'chk.lease-remaining':  { en:'If leasehold, how many years remain and has extension been applied for?', ms:'Jika pajakan, berapa tahun berbaki dan adakah lanjutan tempoh dipohon?', zh:'若属租赁地契，尚余多少年？是否已申请延长年限？' },
  'chk.strata-issued':    { en:'For an apartment: has the strata title issued, or is it still a master title?', ms:'Bagi apartmen: adakah hakmilik strata telah dikeluarkan, atau masih hakmilik induk?', zh:'公寓单位：分层地契是否已发出，还是仍属总地契？' },
  'chk.flood':            { en:'Is the site in an area with a known flood history?', ms:'Adakah tapak ini terletak di kawasan yang ada sejarah banjir?', zh:'该地点是否位于已知有水灾记录的地区？' },
  'chk.single-employer':  { en:'Does rental demand here depend on one employer or one industry?', ms:'Adakah permintaan sewa di sini bergantung pada satu majikan atau satu industri?', zh:'这里的租赁需求是否依赖单一雇主或单一行业？' },
  'chk.transient-demand': { en:'Is demand driven by students, O&G rotation staff or construction workers?', ms:'Adakah permintaan didorong oleh pelajar, pekerja rotasi O&G atau pekerja binaan?', zh:'需求是否由学生、油气（O&G）轮班员工或建筑工人带动？' },
  'chk.parking':          { en:'Is the unit hard to rent without parking?', ms:'Adakah unit ini sukar disewakan tanpa tempat letak kereta?', zh:'没有停车位，这个单位是否难以出租？' },
  'chk.supply':           { en:'Is there substantial unsold or newly completed supply nearby?', ms:'Adakah banyak unit belum terjual atau baru siap berhampiran?', zh:'附近是否有大量未售出或刚竣工的单位？' },
  'chk.comparables':      { en:'Have you verified comparable rental transactions, not asking prices?', ms:'Adakah anda telah mengesahkan transaksi sewa setanding, bukan kadar sewa yang diminta?', zh:'是否已核实同类单位的实际成交租金，而非叫价？' },
  'chk.resale-time':      { en:'How long would a resale realistically take in this district?', ms:'Secara realistik, berapa lama jualan semula mengambil masa di daerah ini?', zh:'在这个县转售，实际上需要多久？' },
  /* calculator inputs */
  'in.sqft':      { en:'Built-up area (sq ft)', ms:'Keluasan binaan (sq ft)', zh:'建筑面积 (sq ft)' },
  'in.landSqft':  { en:'Land area (sq ft, 0 if none)', ms:'Keluasan tanah (sq ft, 0 jika tiada)', zh:'土地面积 (sq ft，无则填 0)' },
  'in.parking':   { en:'Allocated parking bays', ms:'Petak letak kereta diperuntukkan', zh:'分配的停车位' },
  'in.price':     { en:'Purchase price (RM)', ms:'Harga belian (RM)', zh:'购买价格 (RM)' },
  'in.bankValuation': { en:'Bank or valuer estimate (RM, 0 if not yet known)', ms:'Nilaian bank atau penilai (RM, 0 jika belum diketahui)', zh:'银行或估价师估值 (RM，未知则填 0)' },
  'in.renovation':{ en:'Renovation and furnishing (RM)', ms:'Ubah suai dan perabot (RM)', zh:'装修与家具 (RM)' },
  'in.downPct':   { en:'Deposit (%)', ms:'Deposit (%)', zh:'头期 (%)' },
  'in.ratePct':   { en:'Loan interest rate (%)', ms:'Kadar faedah pinjaman (%)', zh:'贷款利率 (%)' },
  'in.tenureYears':{ en:'Loan tenure (years)', ms:'Tempoh pinjaman (tahun)', zh:'贷款期限 (年)' },
  'in.rent':      { en:'Expected monthly rent (RM)', ms:'Jangkaan sewa bulanan (RM)', zh:'预计月租 (RM)' },
  'in.rentGrowthPct':{ en:'Annual rent growth (%)', ms:'Pertumbuhan sewa tahunan (%)', zh:'年租金涨幅 (%)' },
  'in.vacancyPct':{ en:'Vacancy allowance (%)', ms:'Peruntukan kekosongan (%)', zh:'空置预留 (%)' },
  'in.maintenance':{ en:'Monthly maintenance (RM)', ms:'Penyelenggaraan bulanan (RM)', zh:'每月维修费 (RM)' },
  'in.sinkingFund':{ en:'Monthly sinking fund (RM)', ms:'Sinking fund bulanan (RM)', zh:'每月储备金 (RM)' },
  'in.assessment':{ en:'Annual assessment (RM)', ms:'Cukai pintu tahunan (RM)', zh:'每年门牌税 (RM)' },
  'in.quitRent':  { en:'Annual quit rent (RM)', ms:'Cukai tanah tahunan (RM)', zh:'每年地税 (RM)' },
  'in.insurance': { en:'Annual insurance (RM)', ms:'Insurans tahunan (RM)', zh:'每年保险费 (RM)' },
  'in.mgmtPct':   { en:'Letting and management fee (% of rent)', ms:'Fi sewaan dan pengurusan (% sewa)', zh:'出租与管理费 (占租金 %)' },
  'in.repairReservePct':{ en:'Repair reserve (% of rent)', ms:'Rizab pembaikan (% sewa)', zh:'维修储备 (占租金 %)' },
  'in.holdYears': { en:'Holding period (years)', ms:'Tempoh pegangan (tahun)', zh:'持有期 (年)' },
  'in.apprecPct': { en:'Annual capital growth (%)', ms:'Pertumbuhan modal tahunan (%)', zh:'年资本增值 (%)' },
  'in.sellMonths':{ en:'Expected months to sell', ms:'Jangkaan bulan untuk menjual', zh:'预计出售月数' },
  'in.agentPct':  { en:'Agent commission on exit (%)', ms:'Komisen ejen semasa jualan (%)', zh:'出售时经纪佣金 (%)' },
  'in.exitLegalPct':{ en:'Legal costs on exit (%)', ms:'Kos guaman semasa jualan (%)', zh:'出售时律师费 (%)' },
  'in.equityReturnPct':{ en:'Assumed equity return (% a year)', ms:'Andaian pulangan ekuiti (% setahun)', zh:'假设股票回报 (每年 %)' },
  /* acquisition costs and the limitation statements */
  'c.deposit':      { en:'Deposit', ms:'Deposit', zh:'头期款' },
  'c.transferDuty': { en:'Transfer stamp duty', ms:'Duti setem pindah milik', zh:'转名印花税' },
  'c.purchaseLegal':{ en:'Purchase legal fees', ms:'Yuran guaman pembelian', zh:'购屋律师费' },
  'c.loanDuty':     { en:'Loan stamp duty', ms:'Duti setem pinjaman', zh:'贷款印花税' },
  'c.emergencyReserve':{ en:'Emergency reserve', ms:'Simpanan kecemasan', zh:'应急储备金' },
  'c.totalInitialCash':{ en:'Total initial cash', ms:'Jumlah tunai permulaan', zh:'初期现金总额' },
  'c.reserveNote':  { en:'The emergency reserve is not spent. It stays in your account.', ms:'Simpanan kecemasan ini tidak dibelanjakan. Ia kekal dalam akaun anda.', zh:'应急储备金不会被动用，它留在你的户头里。' },
  'c.notValuation': { en:'This is not an official property valuation. In Malaysia that must be carried out by a registered valuer.', ms:'Ini bukan penilaian hartanah rasmi. Di Malaysia, penilaian rasmi mesti dijalankan oleh penilai berdaftar.', zh:'这不是正式的产业估价。在马来西亚，正式估价必须由注册估价师进行。' },
  'c.noModelChange':{ en:'This tool changes no figure on the strength of your answers.', ms:'Alat ini tidak mengubah sebarang angka berdasarkan jawapan anda.', zh:'本工具不会因你的回答而改动任何数字。' },
  'c.titleUnverified':{ en:'Title classification is recorded from what you entered. Eligibility has not been verified.', ms:'Klasifikasi hakmilik direkodkan daripada maklumat yang anda masukkan. Kelayakan belum disahkan.', zh:'地契类别是按你输入的资料记录的，资格尚未核实。' },
  'c.confirmLawyer':{ en:'Confirm with a Sarawak property lawyer and the Land and Survey Department.', ms:'Sahkan dengan peguam hartanah Sarawak dan Jabatan Tanah dan Survei.', zh:'请向砂拉越产业律师及土地与测量局（Land and Survey Department）核实。' },
  'c.noComparable': { en:'No transacted price or rental band is held for this location.', ms:'Tiada harga transaksi atau julat sewa direkodkan untuk lokasi ini.', zh:'此地点没有成交价或租金区间的资料。' },
};

const lang = () => State.lang || 'en';
/* Same fallback rule as tr(): English, never the key. */
const ptr = (key, fallback) => PROPERTY_I18N[key]?.[lang()] || PROPERTY_I18N[key]?.en || fallback || key;
/* Falls back to English rather than to a key. A missing translation should
   read as the English term, never as "breakEvenRent". */
const tr = (key) => METRIC_DICTIONARY[key]?.[lang()] || METRIC_DICTIONARY[key]?.en || key;

/* The calculator's own summary, in the reader's language. Deliberately the
   figures and their names only — the surrounding explanation stays in English
   because a half-translated argument is harder to trust than an English one. */
const SUMMARY_COPY = {
  en: { title:'Summary', note:'Input labels, evidence grades and the ten risk questions are translated. The longer explanations remain in English.',
        forEvery:'For every ringgit of rent you collect', afterAll:'after every cost modelled here' },
  ms: { title:'Ringkasan', note:'Label input, gred bukti dan sepuluh soalan risiko telah diterjemah. Penjelasan yang lebih panjang kekal dalam bahasa Inggeris.',
        forEvery:'Bagi setiap ringgit sewa yang dikutip', afterAll:'selepas semua kos yang dimodelkan di sini' },
  zh: { title:'摘要', note:'输入项名称、证据等级与十道风险问题已翻译，较长的说明仍为英文。',
        forEvery:'每收取一令吉租金', afterAll:'扣除此处模型中的所有成本后' },
};

/* ==========================================================================
   SARAWAK ECONOMY WATCH

   A research collection, not a recommended-stock list, and explicitly not a
   list this product asserts.

   The obvious way to build this would be to write out the Sarawak-linked Bursa
   companies from memory — the Kuching conglomerates, the Miri oil services
   names, the Samalaju smelter. That would be inventing the exposure data the
   collection exists to record. Whether a company is incorporated in Sarawak is
   checkable; what share of its order book is Sarawak state contracts, which
   concessions it depends on, how concentrated its state customer base is —
   none of that is in any source this product can reach, and a list of names
   with empty exposure fields dressed as a research collection would be worse
   than no collection.

   So the structure is here and the evidence is the user's to record, against
   any company already in the universe, with the same evidence grades and the
   same refusal to average across incompatible things that the property
   observations use. It fills up as it is researched, and what has not been
   researched reads as absent rather than as zero.
   ========================================================================== */
const SARAWAK_THEMES = [
  { id:'infrastructure', label:'Infrastructure and construction', note:'State and federal works, roads, bridges, water and utilities delivery.' },
  { id:'energy',         label:'Renewable and conventional energy', note:'Hydropower, gas, and the generation and transmission built around them.' },
  { id:'ogservices',     label:'Oil and gas services', note:'Offshore and onshore services to the fields off Sarawak, and the Miri and Bintulu bases.' },
  { id:'ports',          label:'Ports and logistics', note:'Bintulu, Kuching and the river ports, and what moves through them.' },
  { id:'plantation',     label:'Plantations', note:'Oil palm estates and mills within the state.' },
  { id:'timber',         label:'Timber', note:'Licences, concessions and downstream processing.' },
  { id:'materials',      label:'Building materials', note:'Cement, steel and aggregates supplying state construction.' },
  { id:'industrial',     label:'Industrial development and SCORE', note:'Samalaju and the corridor: smelting, processing and the power that supports them.' },
  { id:'consumer',       label:'Tourism and local consumption', note:'Businesses whose revenue follows Sarawak households and visitors.' },
];

/* Every field section 19.2 asks for, each recorded or explicitly not. */
const EXPOSURE_FIELDS = [
  { k:'nature',      label:'Nature of Sarawak exposure', kind:'text' },
  { k:'assets',      label:'Sarawak assets',             kind:'text' },
  { k:'orderbook',   label:'Sarawak contracts and order book', kind:'text' },
  { k:'stateCustomer', label:'State or federal customer exposure', kind:'text' },
  { k:'commodity',   label:'Commodity sensitivity',      kind:'text' },
  { k:'projects',    label:'Major project status',       kind:'text' },
  { k:'concession',  label:'Concession or policy dependency', kind:'text' },
  { k:'concentration', label:'Customer concentration',   kind:'text' },
  { k:'balance',     label:'Balance-sheet capacity',     kind:'text' },
  { k:'liquidity',   label:'Liquidity and free float',   kind:'text' },
  { k:'announcements', label:'Latest relevant announcements', kind:'text' },
];

/* How a record was established, as distinct from what it says.
   ---------------------------------------------------------------------------
   The eleven fields above record the exposure. None of them records where it
   came from, when it was last checked, or whether it is a measured figure or a
   described one — so a record assembled from a company's own annual report and
   a record assembled from memory looked identical, and the collection could
   reach "100% complete" while being entirely unsourced.

   That is the difference between a research collection and a notepad, and it is
   the thing this product claims to be for. A qualitative record with a source
   and a date is worth more than a quantitative one without them. */
const EXPOSURE_META = [
  { k:'sources', label:'Evidence sources', kind:'text',
    hint:'Which document, and where in it. "FY2024 annual report, segment note p.87" can be checked. "Company website" cannot.' },
  { k:'verified', label:'Last verified', kind:'date',
    hint:'The date you last read the source, not the date you wrote the record.' },
];

/* Whether the exposure is measured or described. Both are legitimate; treating
   them as the same thing is not. */
const EXPOSURE_BASIS = [
  { id:'quantitative', label:'Quantitative', note:'A reported figure — a segment revenue, a stated order book, a disclosed customer concentration.' },
  { id:'qualitative',  label:'Qualitative',  note:'Described rather than measured. Legitimate, and must not be read as a number nobody has.' },
  { id:'unstated',     label:'Not stated',   note:'The basis has not been recorded, so the record cannot be read as either.' },
];

const saveExposures = () => store.write('sarawakExposure', State.sarawakExposure);

/* Who can be recorded against a theme.
   ---------------------------------------------------------------------------
   This used to be the research universe alone, which quietly made the Watch
   useless for its own subject: the universe holds SEC filers and illustrative
   Malaysian placeholders, and not one Sarawak company was in it. So the page
   asked the reader to record Sarawak exposure and then offered them Apple.

   The coupling was wrong in principle too. What a company does in Sarawak —
   which ports it operates, which concessions it holds, whose contracts it is
   building against — is a question about the company, not about whether this
   product happens to hold its income statement. Requiring fundamentals before
   exposure can be recorded confuses two independent kinds of knowing.

   So the picker is the union: companies in the universe, plus the Sarawak-
   flagged entries in the instrument registry, which carry identity and price
   but no financial statements. Registry entries are marked as such, because a
   record against one cannot later be cross-read against a scorecard that does
   not exist. */
function sarawakCandidates() {
  const out = [];
  const seen = new Set();
  const reg = instruments?.instruments || [];

  /* Sarawak-flagged registry entries lead: this is the Sarawak Watch, and the
     companies it exists for should not be below Apple in an alphabetical list. */
  reg.filter(i => i.sarawak).forEach(i => {
    const key = `MY:${i.symbol}`;
    if (seen.has(key)) return; seen.add(key);
    out.push({ id:`reg:${i.symbol}`, tk:i.symbol, name:i.name, sarawak:true,
               theme:i.sarawakTheme || null, source:'registry', hasFundamentals:false });
  });

  U.forEach(r => {
    const key = `${r.c.mkt}:${r.c.tk || r.c.code}`;
    if (seen.has(key)) return; seen.add(key);
    out.push({ id:r.c.id, tk:r.c.tk || r.c.code, name:r.c.name, sarawak:false,
               theme:null, source:'universe', hasFundamentals:!!r.c.real });
  });

  return out;
}

/* Completeness against the eleven fields, so a thin record cannot pass for a
   researched one — the same rule the company scores follow. */
function exposureCompleteness(rec) {
  if (!rec) return 0;
  const filled = EXPOSURE_FIELDS.filter(f => String(rec.fields?.[f.k] || '').trim().length > 2).length;
  return Math.round(filled / EXPOSURE_FIELDS.length * 100);
}

/* Sourcing is scored separately and NOT folded into completeness, because they
   answer different questions and averaging them would let a well-sourced thin
   record and a fully-written unsourced one land on the same number. A reader
   deciding whether to trust a record needs both, side by side. */
function exposureSourcing(rec) {
  if (!rec) return { score: 0, missing: ['everything'] };
  const missing = [];
  if (String(rec.sources || '').trim().length < 4) missing.push('no source given');
  if (!rec.verified) missing.push('never verified');
  if (!rec.basis || rec.basis === 'unstated') missing.push('basis not stated');
  return { score: Math.round((3 - missing.length) / 3 * 100), missing };
}

/* A record nobody has looked at for a year is not wrong, but it is old, and on
   an order book or a project status a year is a long time. */
function exposureStale(rec) {
  if (!rec?.verified) return null;
  const days = Math.floor((Date.now() - new Date(rec.verified).getTime()) / 86400000);
  return Number.isFinite(days) ? days : null;
}

/* ==========================================================================
   AREA OBSERVATIONS

   The layer no source can supply. There is no neighbourhood-level rental or
   transaction dataset for Sarawak — NAPIC would not respond, listing sites
   carry asking prices under terms that forbid scraping, and asking is not
   achieved in any case. So the only route to that data is to record it, one
   observation at a time, from what a buyer actually sees.

   Three rules make the difference between a dataset and a pile of numbers:

   Asking and achieved are never mixed. A quoted rent and a signed tenancy are
   different facts, and averaging them produces a figure describing neither.

   Every observation carries the evidence grade the rest of the calculator
   already uses, so a figure from a signed tenancy and one remembered from a
   conversation stay distinguishable for as long as they are kept.

   A count is always shown beside a summary. Two observations are two
   observations; presenting their midpoint as an area's rent would be inventing
   the market rate this whole layer exists because nobody publishes.

   It stays in this browser. It is the user's own record, it is not sent
   anywhere, and it carries no redistribution right — the same position as
   every other screen-derived figure in this product.
   ========================================================================== */
/* WHAT CAN BE RECORDED ABOUT A PLACE.
   ---------------------------------------------------------------------------
   `area` says which area field a record's rate is derived against — 'built' for
   floor area, 'land' for the parcel. That distinction is the whole reason
   RM/point and RM/m² can coexist without lying: a shophouse transacted at
   RM900,000 on 4 points of land with 3,000 sq ft of floor is RM225,000 a point
   AND RM3,229 a square metre, and neither figure is the other one converted.

   A management charge is stored as the MONTHLY AMOUNT, not as a rate. Malaysian
   service charges are quoted per square foot per month, the question asked here
   was per square metre, and a register that stores whichever unit was typed can
   answer neither reliably. Storing the charge and the area separately means both
   rates are derived, both are right, and the reader can be shown the one they
   asked for. */
const OBSERVATION_KINDS = [
  { id:'ask-rent',   label:'Asking rent',          unit:'RM/month', family:'rent',  asking:true },
  { id:'let-rent',   label:'Achieved rent',        unit:'RM/month', family:'rent',  asking:false },
  { id:'ask-price',  label:'Asking price',         unit:'RM',       family:'price', asking:true,  area:'built' },
  { id:'sold-price', label:'Transacted price',     unit:'RM',       family:'price', asking:false, area:'built' },
  { id:'land-ask',   label:'Asking land price',    unit:'RM',       family:'land',  asking:true,  area:'land' },
  { id:'land-sold',  label:'Transacted land price',unit:'RM',       family:'land',  asking:false, area:'land' },
  { id:'mgmt-fee',   label:'Management or service charge', unit:'RM/month', family:'cost', asking:false, area:'built' },
  { id:'vacancy',    label:'Weeks vacant',         unit:'weeks',    family:'other', asking:false },
];
const OBS_BY_ID = Object.fromEntries(OBSERVATION_KINDS.map(k => [k.id, k]));
const EVIDENCE_BY_ID = Object.fromEntries(EVIDENCE.map(e => [e.id, e]));

const saveObservations = () => store.write('observations', State.observations);

/* THE COMPARABLES REGISTER IS THIS, EXTENDED — NOT A SECOND STORE.
   ---------------------------------------------------------------------------
   The obvious way to answer "add a Sarawak comparables register" was a new
   `comparables` key with its own record and its own view. It would also have
   been wrong: this subsystem already keeps asking apart from achieved, and
   asking apart from transacted, already keys to city and district, already
   carries a source class from the same evidence ladder, and already refuses to
   average across kinds. Two stores holding the same evidence would leave the
   calculator choosing which to believe, which is the defect this codebase keeps
   finding in itself.

   So the record gains the fields a comparable needs and the register is a view
   over what was already being collected. Existing rows keep working: every new
   field is optional and absent reads as unrecorded, never as zero.

   WHAT MAKES ONE COUNT

   A figure with no reference to where it came from is a recollection. It can be
   recorded — a half-remembered number is still worth writing down before it is
   lost — but it can never be verified evidence, and the register says which of
   the two it is rather than presenting a list of equals. */
function addObservation(o) {
  const rec = {
    address:'', propertyType:'', sqft:null, sourceRef:'', reviewedBy:'', reviewedAt:'',
    /* Land area is a separate field from built-up, not a reinterpretation of
       it: a shophouse has both and they are different numbers. areaUnit keeps
       whatever the reader typed in, so 4 points comes back as 4 points rather
       than 1,742.4 square feet. */
    landSqft:null, areaUnit:'sqft', landUnit:'point', titleType:'',
    ...o,
    id: `obs-${State.observations.length + 1}-${o.date}-${Math.floor(performance.now())}`,
    recordedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
  };
  recordObservationAdded(rec);
  State.observations = [rec, ...State.observations];
  saveObservations();
  return rec;
}

/* Three states, because "verified" and "recorded" are different claims and a
   register that shows them as one list is not evidence, it is a pile. */
function observationStanding(o) {
  /* FIRST, and deliberately so. A worked-example row is complete in every field
     a real one has, which means every other test below would pass it and hand a
     figure nobody observed the same standing as a transaction someone saw. */
  if (o.sample)
    return { id:'sample', label:'Worked example', tone:'chip chip-bronze',
             why:'Part of the worked example. This figure was invented to demonstrate the tool — there is no property, no document and no transaction behind it. Remove the worked example from the comparables register when you no longer need it.' };
  const ev = evidenceOf(o.evidence);
  if (!o.sourceRef || !String(o.sourceRef).trim())
    return { id:'unsourced', label:'No source recorded', tone:'chip chip-bronze',
             why:'Nothing says where this figure came from, so it cannot be checked by anyone else. It is a note, not evidence.' };
  if (ev.rank < 4)
    return { id:'sourced', label:`Sourced — ${ev.label.toLowerCase()}`, tone:'chip',
             why:'A source is recorded, and the source class is below published or transacted. Usable as context; not enough on its own to lift a grade.' };
  if (!o.reviewedBy || !String(o.reviewedBy).trim())
    return { id:'awaiting_review', label:'Awaiting review', tone:'chip',
             why:'Sourced at a class that could support a grade, but nobody has checked it against the source yet.' };
  return { id:'verified', label:'Verified', tone:'chip chip-ok',
           why:`Sourced, at ${ev.label.toLowerCase()}, and checked against the source by ${o.reviewedBy}.` };
}

/* WHICH RECORDED EVIDENCE ACTUALLY SPEAKS TO THIS DEAL.
   ---------------------------------------------------------------------------
   observationsFor below matches on city and district only, which is right for
   the district panel's summary and far too loose to move a grade. A shophouse
   sale and a condominium sale in the same district would otherwise clear the
   same gate, and a 2019 transaction would count like last month's.

   For anything that changes a grade, a comparable has to be the same property
   type, in the same district, dated inside the window, and VERIFIED — sourced,
   at a class that can carry it, and checked against that source by a named
   person. Everything weaker is reported beside it and clears nothing.

   COMPARABLE_WINDOW_MONTHS is stated on the page rather than buried, because a
   reader is entitled to disagree with it. */
const COMPARABLE_WINDOW_MONTHS = 24;

function comparableSupport(d) {
  const all = State.observations || [];
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - COMPARABLE_WINDOW_MONTHS);

  const matches = all.filter(o =>
    o.city === d.city && o.area === d.district &&
    o.propertyType && o.propertyType === d.propertyType &&
    o.date && new Date(o.date) >= cutoff);

  const pick = (kind) => {
    const rows = matches.filter(o => o.kind === kind);
    const verified = rows.filter(o => observationStanding(o).id === 'verified');
    const vals = verified.map(o => o.value).filter(isNum).sort((a, b) => a - b);
    return {
      all: rows.length, verified: verified.length,
      median: vals.length ? (vals.length % 2 ? vals[(vals.length - 1) / 2]
              : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2) : null,
      lo: vals.length ? vals[0] : null, hi: vals.length ? vals[vals.length - 1] : null,
    };
  };

  const price = pick('sold-price');
  const rent = pick('let-rent');
  /* Excluded by kind, not by accident: an asking figure is what somebody hoped
     for. It is recorded, it is summarised in the district panel, and it never
     supports a grade. */
  const askingSeen = matches.filter(o => OBS_BY_ID[o.kind] && OBS_BY_ID[o.kind].asking).length;

  return {
    windowMonths: COMPARABLE_WINDOW_MONTHS,
    matched: matches.length, askingSeen,
    price, rent,
    hasVerifiedPrice: price.verified > 0,
    hasVerifiedRent: rent.verified > 0,
    /* Where the entered figures sit against what was actually recorded. Null
       when there is nothing to compare against — never zero, which would read
       as "exactly on the median". */
    priceVsMedian: isNum(price.median) && price.median > 0 && isNum(d.price)
      ? (d.price - price.median) / price.median * 100 : null,
    rentVsMedian: isNum(rent.median) && rent.median > 0 && isNum(d.rent)
      ? (d.rent - rent.median) / rent.median * 100 : null,
  };
}

/* Summarised per area and per kind, never across kinds. Returns the median
   rather than the mean: with a handful of observations one unusual figure
   moves a mean and does not move a median. */
function observationsFor(city, area) {
  const rows = State.observations.filter(o => o.city === city && (!area || o.area === area));
  const groups = {};
  for (const o of rows) {
    const g = (groups[o.kind] = groups[o.kind] || { kind: OBS_BY_ID[o.kind], values: [], best: null, latest: null });
    if (isNum(o.value)) g.values.push(o.value);
    const rank = EVIDENCE_BY_ID[o.evidence]?.rank ?? 0;
    if (g.best == null || rank > g.best) g.best = rank;
    if (!g.latest || o.date > g.latest) g.latest = o.date;
  }
  for (const g of Object.values(groups)) {
    const v = g.values.slice().sort((a, b) => a - b);
    g.n = v.length;
    g.median = v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null;
    g.lo = v[0] ?? null; g.hi = v[v.length - 1] ?? null;
  }
  return { total: rows.length, groups, rows };
}

/* City-level affordability, stated as city-level. The income series is one
   figure for the whole district, so it cannot distinguish Petra Jaya from Batu
   Kawa, and a band drawn beside per-area points would otherwise read as though
   it could. */
function affordabilityPanel(cityName) {
  if (!sarawakIncome?.districts) return null;
  const series = sarawakIncome.districts[cityName];
  if (!series?.length) return null;
  const latest = series[series.length - 1];
  if (!isNum(latest.median)) return null;

  const card = el('div', { class: 'panel' });
  card.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, `${cityName} district household income`));
  card.append(el('div', { class: 'row', style: 'gap:var(--lg);flex-wrap:wrap' }, [
    el('div', {}, [el('div', { style:'font-size:20px;font-weight:700' }, `RM${latest.median.toLocaleString()}`),
                   el('div', { class:'metaline' }, `median, ${latest.year}`)]),
    el('div', {}, [el('div', { style:'font-size:20px;font-weight:700' }, `RM${latest.mean.toLocaleString()}`),
                   el('div', { class:'metaline' }, `mean, ${latest.year}`)]),
  ]));

  /* A quarter to a third of household income is the conventional sustainable
     range for rent. It is a rule of thumb, not a measurement, and it is the
     only rent-shaped number any source here supports. */
  const lo = Math.round(latest.median * 0.25 / 10) * 10;
  const hi = Math.round(latest.median * 0.30 / 10) * 10;
  card.append(el('p', { class: 'body', style: 'font-size:13px;margin-top:10px' },
    `A household on the median here sustains roughly RM${lo.toLocaleString()}–${hi.toLocaleString()} a month in rent.`));
  card.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
    'Derived from published income at a quarter to a third of it — a convention, not a measurement, and not an observed rent. No source consulted carries transacted rents for Sarawak. It describes the whole district, so it cannot tell one area here from another.'));

  if (series.length > 1) {
    const first = series[0];
    const chg = ((latest.median - first.median) / first.median) * 100;
    card.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      `Median income ${chg >= 0 ? 'rose' : 'fell'} ${Math.abs(chg).toFixed(0)}% between ${first.year} and ${latest.year}.`));
  }
  card.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
    `Source: ${sarawakIncome.source}. Retrieved ${sarawakIncome.retrieved}.`));
  return card;
}

