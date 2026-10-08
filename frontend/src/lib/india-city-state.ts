/**
 * Reusable Indian State → City dataset + helpers.
 *
 * Single source of truth for every address form in the application
 * (Sales Orders, Purchase Orders, Customers, Suppliers, billing / shipping /
 * company addresses, …). Do NOT hardcode separate state/city lists inside
 * individual form components — import from here instead.
 *
 * Values are standardized canonical names (e.g. always "Maharashtra", never
 * free-text variants), so the same state always has the same value across
 * every module.
 */

// ─── Complete list: 28 States + 8 Union Territories ──────────────────────────
export const INDIAN_STATES: string[] = [
  // States
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  // Union Territories
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
];

// ─── Cities per State/UT (major cities; searchable in the dropdown) ─────────
export const CITIES_BY_STATE: Record<string, string[]> = {
  "Andhra Pradesh": ["Visakhapatnam", "Vijayawada", "Guntur", "Tirupati", "Nellore", "Kurnool", "Rajahmundry", "Kakinada", "Anantapur", "Chittoor"],
  "Arunachal Pradesh": ["Itanagar", "Naharlagun", "Tawang", "Pasighat", "Ziro"],
  Assam: ["Guwahati", "Silchar", "Dibrugarh", "Jorhat", "Nagaon", "Tinsukia", "Tezpur", "Dispur"],
  Bihar: ["Patna", "Gaya", "Bhagalpur", "Muzaffarpur", "Darbhanga", "Purnia", "Arrah", "Begusarai"],
  Chhattisgarh: ["Raipur", "Bhilai", "Bilaspur", "Korba", "Durg", "Rajnandgaon", "Jagdalpur"],
  Goa: ["Panaji", "Margao", "Vasco da Gama", "Mapusa", "Ponda"],
  Gujarat: ["Ahmedabad", "Surat", "Vadodara", "Rajkot", "Gandhinagar", "Bhavnagar", "Jamnagar", "Junagadh", "Anand", "Morbi"],
  Haryana: ["Gurugram", "Faridabad", "Panipat", "Ambala", "Rohtak", "Hisar", "Karnal", "Sonipat", "Yamunanagar"],
  "Himachal Pradesh": ["Shimla", "Manali", "Dharamshala", "Solan", "Mandi", "Kullu", "Bilaspur"],
  Jharkhand: ["Ranchi", "Jamshedpur", "Dhanbad", "Bokaro", "Hazaribagh", "Deoghar", "Daltonganj"],
  Karnataka: ["Bengaluru", "Mysuru", "Mangaluru", "Hubballi", "Belagavi", "Davanagere", "Shivamogga", "Kalaburagi", "Tumakuru", "Udupi"],
  Kerala: ["Thiruvananthapuram", "Kochi", "Kozhikode", "Thrissur", "Kollam", "Alappuzha", "Palakkad", "Kannur", "Ernakulam"],
  "Madhya Pradesh": ["Indore", "Bhopal", "Jabalpur", "Gwalior", "Ujjain", "Sagar", "Satna", "Ratlam", "Rewa"],
  Maharashtra: ["Mumbai", "Pune", "Nagpur", "Nashik", "Aurangabad", "Solapur", "Kolhapur", "Thane", "Navi Mumbai", "Amravati", "Sangli", "Jalgaon", "Latur", "Nanded", "Akola", "Ahmednagar"],
  Manipur: ["Imphal", "Thoubal", "Bishnupur", "Churachandpur"],
  Meghalaya: ["Shillong", "Tura", "Nongstoin", "Jowai"],
  Mizoram: ["Aizawl", "Lunglei", "Saiha", "Champhai"],
  Nagaland: ["Kohima", "Dimapur", "Mokokchung", "Tuensang"],
  Odisha: ["Bhubaneswar", "Cuttack", "Rourkela", "Berhampur", "Sambalpur", "Puri", "Balasore"],
  Punjab: ["Ludhiana", "Amritsar", "Jalandhar", "Patiala", "Bathinda", "Mohali", "Pathankot", "Batala"],
  Rajasthan: ["Jaipur", "Jodhpur", "Udaipur", "Kota", "Ajmer", "Bikaner", "Bhilwara", "Alwar", "Sikar"],
  Sikkim: ["Gangtok", "Namchi", "Gyalshing", "Mangan"],
  "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Salem", "Tirunelveli", "Tiruppur", "Erode", "Vellore", "Thoothukudi", "Hosur"],
  Telangana: ["Hyderabad", "Secunderabad", "Warangal", "Nizamabad", "Karimnagar", "Khammam"],
  Tripura: ["Agartala", "Udaipur", "Dharmanagar", "Kailashahar"],
  "Uttar Pradesh": ["Lucknow", "Kanpur", "Ghaziabad", "Agra", "Varanasi", "Noida", "Meerut", "Prayagraj", "Bareilly", "Aligarh", "Moradabad", "Gorakhpur", "Greater Noida", "Mathura"],
  Uttarakhand: ["Dehradun", "Haridwar", "Roorkee", "Haldwani", "Nainital", "Rudrapur", "Rishikesh"],
  "West Bengal": ["Kolkata", "Howrah", "Siliguri", "Durgapur", "Asansol", "Darjeeling", "Haldia", "Kharagpur"],
  "Andaman and Nicobar Islands": ["Port Blair", "Diglipur", "Mayabunder"],
  Chandigarh: ["Chandigarh"],
  "Dadra and Nagar Haveli and Daman and Diu": ["Silvassa", "Daman", "Diu", "Dadra"],
  Delhi: ["New Delhi", "Delhi", "Dwarka", "Rohini", "Saket"],
  "Jammu and Kashmir": ["Srinagar", "Jammu", "Anantnag", "Baramulla", "Kathua"],
  Ladakh: ["Leh", "Kargil"],
  Lakshadweep: ["Kavaratti", "Agatti", "Minicoy"],
  Puducherry: ["Puducherry", "Karaikal", "Mahe", "Yanam"],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalize(v: string): string {
  return v.trim().toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Cities belonging to a state (canonical name). Returns [] for unknown
 * states so the City dropdown can render its empty state gracefully.
 */
export function getCitiesForState(state: string | null | undefined): string[] {
  if (!state) return [];
  const key = normalize(state);
  if (!key) return [];
  const direct = Object.keys(CITIES_BY_STATE).find((s) => normalize(s) === key);
  if (direct) return CITIES_BY_STATE[direct];
  // Legacy / alias spellings resolve to their canonical state first, so old
  // records still load the right city list in edit mode.
  const aliased = STATE_ALIASES[key];
  if (aliased && CITIES_BY_STATE[aliased]) return CITIES_BY_STATE[aliased];
  return [];
}

/** Legacy / alias spellings mapped to their canonical state name. */
const STATE_ALIASES: Record<string, string> = {
  orissa: "Odisha",
  uttaranchal: "Uttarakhand",
  pondicherry: "Puducherry",
  nct: "Delhi",
  ncr: "Delhi",
  newdelhi: "Delhi",
  dadra: "Dadra and Nagar Haveli and Daman and Diu",
  daman: "Dadra and Nagar Haveli and Daman and Diu",
  diu: "Dadra and Nagar Haveli and Daman and Diu",
  dadraandnagarhaveli: "Dadra and Nagar Haveli and Daman and Diu",
  damananddiu: "Dadra and Nagar Haveli and Daman and Diu",
  jammuandkashmir: "Jammu and Kashmir",
  andaman: "Andaman and Nicobar Islands",
  nicobar: "Andaman and Nicobar Islands",
  portblair: "Andaman and Nicobar Islands",
};

/**
 * Resolve any stored / typed state value to its canonical name.
 * Returns null when the value matches no known state (legacy custom values
 * are left untouched by callers so old records keep displaying).
 */
export function resolveStandardState(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = normalize(value);
  if (!key) return null;
  const exact = INDIAN_STATES.find((s) => normalize(s) === key);
  if (exact) return exact;
  return STATE_ALIASES[key] ?? null;
}

// ─── Back-compat: city → state lookup (used by debtor address auto-fill) ────
// Kept in sync with CITIES_BY_STATE above, plus common spelling / alias
// variants. The field stays manually editable, so an unknown city is simply
// left untouched.

const CITY_TO_STATE: Record<string, string> = {
  // Andhra Pradesh
  visakhapatnam: "Andhra Pradesh", vizag: "Andhra Pradesh", vijayawada: "Andhra Pradesh",
  guntur: "Andhra Pradesh", tirupati: "Andhra Pradesh", nellore: "Andhra Pradesh",
  kurnool: "Andhra Pradesh", rajahmundry: "Andhra Pradesh",
  // Assam
  guwahati: "Assam", dispur: "Assam", silchar: "Assam", dibrugarh: "Assam", jorhat: "Assam",
  // Bihar
  patna: "Bihar", gaya: "Bihar", bhagalpur: "Bihar", muzaffarpur: "Bihar", darbhanga: "Bihar",
  // Chhattisgarh
  raipur: "Chhattisgarh", bhilai: "Chhattisgarh", bilaspur: "Chhattisgarh", korba: "Chhattisgarh",
  // Goa
  panaji: "Goa", panjim: "Goa", margao: "Goa", vasco: "Goa",
  // Gujarat
  ahmedabad: "Gujarat", surat: "Gujarat", vadodara: "Gujarat", baroda: "Gujarat",
  rajkot: "Gujarat", gandhinagar: "Gujarat", bhavnagar: "Gujarat", jamnagar: "Gujarat",
  junagadh: "Gujarat",
  // Haryana
  gurugram: "Haryana", gurgaon: "Haryana", faridabad: "Haryana", panipat: "Haryana",
  ambala: "Haryana", rohtak: "Haryana", hisar: "Haryana", karnal: "Haryana",
  // Himachal Pradesh
  shimla: "Himachal Pradesh", manali: "Himachal Pradesh", dharamshala: "Himachal Pradesh",
  solan: "Himachal Pradesh",
  // Jharkhand
  ranchi: "Jharkhand", jamshedpur: "Jharkhand", dhanbad: "Jharkhand", bokaro: "Jharkhand",
  // Karnataka
  bengaluru: "Karnataka", bangalore: "Karnataka", mysuru: "Karnataka", mysore: "Karnataka",
  mangaluru: "Karnataka", mangalore: "Karnataka", hubli: "Karnataka", hubballi: "Karnataka",
  belagavi: "Karnataka", belgaum: "Karnataka", davanagere: "Karnataka", shivamogga: "Karnataka",
  gulbarga: "Karnataka", kalaburagi: "Karnataka",
  // Kerala
  thiruvananthapuram: "Kerala", trivandrum: "Kerala", kochi: "Kerala", cochin: "Kerala",
  ernakulam: "Kerala", kozhikode: "Kerala", calicut: "Kerala", thrissur: "Kerala",
  kollam: "Kerala", alappuzha: "Kerala",
  // Madhya Pradesh
  indore: "Madhya Pradesh", bhopal: "Madhya Pradesh", jabalpur: "Madhya Pradesh",
  gwalior: "Madhya Pradesh", ujjain: "Madhya Pradesh", sagar: "Madhya Pradesh", satna: "Madhya Pradesh",
  // Maharashtra
  mumbai: "Maharashtra", bombay: "Maharashtra", thane: "Maharashtra", navimumbai: "Maharashtra",
  pune: "Maharashtra", nagpur: "Maharashtra", nashik: "Maharashtra", aurangabad: "Maharashtra",
  solapur: "Maharashtra", kolhapur: "Maharashtra", sangli: "Maharashtra", amravati: "Maharashtra",
  akola: "Maharashtra", jalgaon: "Maharashtra", latur: "Maharashtra", ahmednagar: "Maharashtra",
  nanded: "Maharashtra",
  // Manipur / Meghalaya / Mizoram / Nagaland / Sikkim / Tripura
  imphal: "Manipur", shillong: "Meghalaya", aizawl: "Mizoram", kohima: "Nagaland",
  dimapur: "Nagaland", gangtok: "Sikkim", agartala: "Tripura",
  // Odisha
  bhubaneswar: "Odisha", cuttack: "Odisha", rourkela: "Odisha", berhampur: "Odisha",
  sambalpur: "Odisha",
  // Punjab
  ludhiana: "Punjab", amritsar: "Punjab", jalandhar: "Punjab", patiala: "Punjab",
  bathinda: "Punjab", mohali: "Punjab", pathankot: "Punjab",
  // Rajasthan
  jaipur: "Rajasthan", jodhpur: "Rajasthan", udaipur: "Rajasthan", kota: "Rajasthan",
  ajmer: "Rajasthan", bikaner: "Rajasthan", bhilwara: "Rajasthan", alwar: "Rajasthan",
  // Tamil Nadu
  chennai: "Tamil Nadu", madras: "Tamil Nadu", coimbatore: "Tamil Nadu", madurai: "Tamil Nadu",
  tiruchirappalli: "Tamil Nadu", trichy: "Tamil Nadu", salem: "Tamil Nadu",
  tirunelveli: "Tamil Nadu", tiruppur: "Tamil Nadu", erode: "Tamil Nadu", vellore: "Tamil Nadu",
  thoothukudi: "Tamil Nadu",
  // Telangana
  hyderabad: "Telangana", secunderabad: "Telangana", warangal: "Telangana",
  nizamabad: "Telangana", karimnagar: "Telangana",
  // Uttar Pradesh
  lucknow: "Uttar Pradesh", kanpur: "Uttar Pradesh", ghaziabad: "Uttar Pradesh",
  agra: "Uttar Pradesh", varanasi: "Uttar Pradesh", noida: "Uttar Pradesh", meerut: "Uttar Pradesh",
  allahabad: "Uttar Pradesh", prayagraj: "Uttar Pradesh", bareilly: "Uttar Pradesh",
  aligarh: "Uttar Pradesh", moradabad: "Uttar Pradesh", gorakhpur: "Uttar Pradesh",
  // Uttarakhand
  dehradun: "Uttarakhand", haridwar: "Uttarakhand", roorkee: "Uttarakhand",
  haldwani: "Uttarakhand", nainital: "Uttarakhand",
  // West Bengal
  kolkata: "West Bengal", calcutta: "West Bengal", howrah: "West Bengal",
  siliguri: "West Bengal", durgapur: "West Bengal", asansol: "West Bengal",
  darjeeling: "West Bengal",
  // Union territories / others
  newdelhi: "Delhi", delhi: "Delhi", chandigarh: "Chandigarh",
  puducherry: "Puducherry", pondicherry: "Puducherry",
  srinagar: "Jammu and Kashmir", jammu: "Jammu and Kashmir", leh: "Ladakh",
  portblair: "Andaman and Nicobar Islands",
};

/**
 * Resolve an Indian state name from a city. Returns null when the city is
 * unknown (the caller leaves the user's State value untouched).
 */
export function stateForCity(city: string | null | undefined): string | null {
  const key = normalize(String(city ?? ""));
  if (!key) return null;
  const hit = CITY_TO_STATE[key];
  if (hit) return hit;
  const state = INDIAN_STATES.find((s) => normalize(s) === key);
  return state ?? null;
}

/** Canonical Indian state / UT names (alias of INDIAN_STATES — prefer that). */
export const INDIAN_STATE_NAMES = INDIAN_STATES;
