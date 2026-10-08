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

// ─── Cities per State/UT (major + tier-2/3 cities; searchable in the dropdown) ─
export const CITIES_BY_STATE: Record<string, string[]> = {
  "Andhra Pradesh": ["Visakhapatnam", "Vijayawada", "Guntur", "Tirupati", "Nellore", "Kurnool", "Rajahmundry", "Kakinada", "Anantapur", "Chittoor", "Eluru", "Ongole", "Vizianagaram", "Srikakulam", "Kadapa", "Nandyal", "Machilipatnam", "Hindupur", "Bhimavaram", "Proddatur", "Tadepalligudem", "Chilakaluripet"],
  "Arunachal Pradesh": ["Itanagar", "Naharlagun", "Tawang", "Pasighat", "Ziro", "Bomdila", "Along", "Tezu"],
  Assam: ["Guwahati", "Silchar", "Dibrugarh", "Jorhat", "Nagaon", "Tinsukia", "Tezpur", "Dispur", "Barpeta", "Dhubri", "Karimganj", "Goalpara", "Nalbari", "North Lakhimpur", "Bongaigaon"],
  Bihar: ["Patna", "Gaya", "Bhagalpur", "Muzaffarpur", "Darbhanga", "Purnia", "Arrah", "Begusarai", "Katihar", "Munger", "Chapra", "Hajipur", "Sasaram", "Siwan", "Motihari", "Bettiah", "Kishanganj", "Nalanda", "Saharsa"],
  Chhattisgarh: ["Raipur", "Bhilai", "Bilaspur", "Korba", "Durg", "Rajnandgaon", "Jagdalpur", "Raigarh", "Ambikapur", "Dhamtari", "Mahasamund", "Bhatapara", "Chirmiri"],
  Goa: ["Panaji", "Margao", "Vasco da Gama", "Mapusa", "Ponda", "Bicholim", "Curchorem", "Quepem", "Sanguem"],
  Gujarat: ["Ahmedabad", "Surat", "Vadodara", "Rajkot", "Gandhinagar", "Bhavnagar", "Jamnagar", "Junagadh", "Anand", "Morbi", "Nadiad", "Gandhidham", "Porbandar", "Vapi", "Navsari", "Veraval", "Godhra", "Mehsana", "Bharuch", "Ankleshwar", "Patan", "Dahod", "Botad", "Palanpur"],
  Haryana: ["Gurugram", "Faridabad", "Panipat", "Ambala", "Rohtak", "Hisar", "Karnal", "Sonipat", "Yamunanagar", "Bhiwani", "Sirsa", "Jind", "Kaithal", "Rewari", "Fatehabad", "Kurukshetra", "Bahadurgarh"],
  "Himachal Pradesh": ["Shimla", "Manali", "Dharamshala", "Solan", "Mandi", "Kullu", "Bilaspur", "Una", "Hamirpur", "Palampur", "Kangra", "Chamba", "Sundernagar", "Nahan"],
  Jharkhand: ["Ranchi", "Jamshedpur", "Dhanbad", "Bokaro", "Hazaribagh", "Deoghar", "Daltonganj", "Giridih", "Phusro", "Chaibasa", "Dumka", "Sahibganj", "Gumla"],
  Karnataka: ["Bengaluru", "Mysuru", "Mangaluru", "Hubballi", "Belagavi", "Davanagere", "Shivamogga", "Kalaburagi", "Tumakuru", "Udupi", "Bidar", "Hospet", "Gadag", "Raichur", "Bagalkot", "Mandya", "Hassan", "Dharwad", "Kolar", "Chitradurga", "Vijayapura", "Sirsi"],
  Kerala: ["Thiruvananthapuram", "Kochi", "Kozhikode", "Thrissur", "Kollam", "Alappuzha", "Palakkad", "Kannur", "Ernakulam", "Kasaragod", "Kottayam", "Malappuram", "Pathanamthitta", "Idukki", "Wayanad", "Chalakudy"],
  "Madhya Pradesh": ["Indore", "Bhopal", "Jabalpur", "Gwalior", "Ujjain", "Sagar", "Satna", "Ratlam", "Rewa", "Dewas", "Khandwa", "Chhindwara", "Morena", "Shivpuri", "Vidisha", "Hoshangabad", "Itarsi", "Neemuch", "Mandsaur", "Burhanpur", "Khargone"],
  Maharashtra: ["Mumbai", "Pune", "Nagpur", "Nashik", "Aurangabad", "Solapur", "Kolhapur", "Thane", "Navi Mumbai", "Amravati", "Sangli", "Jalgaon", "Latur", "Nanded", "Akola", "Ahmednagar", "Dhule", "Parbhani", "Beed", "Osmanabad", "Wardha", "Chandrapur", "Yavatmal", "Satara", "Ratnagiri", "Palghar", "Vasai", "Bhiwandi", "Malegaon", "Jalna", "Baramati", "Gondia", "Bhandara"],
  Manipur: ["Imphal", "Thoubal", "Bishnupur", "Churachandpur", "Kakching", "Ukhrul", "Senapati"],
  Meghalaya: ["Shillong", "Tura", "Nongstoin", "Jowai", "Williamnagar", "Baghmara"],
  Mizoram: ["Aizawl", "Lunglei", "Saiha", "Champhai", "Kolasib", "Serchhip"],
  Nagaland: ["Kohima", "Dimapur", "Mokokchung", "Tuensang", "Wokha", "Zunheboto", "Phek"],
  Odisha: ["Bhubaneswar", "Cuttack", "Rourkela", "Berhampur", "Sambalpur", "Puri", "Balasore", "Bhadrak", "Baripada", "Jharsuguda", "Angul", "Dhenkanal", "Keonjhar", "Koraput", "Paradip", "Jagatsinghpur"],
  Punjab: ["Ludhiana", "Amritsar", "Jalandhar", "Patiala", "Bathinda", "Mohali", "Pathankot", "Batala", "Moga", "Abohar", "Hoshiarpur", "Phagwara", "Muktsar", "Firozpur", "Gurdaspur", "Sangrur", "Barnala", "Khanna"],
  Rajasthan: ["Jaipur", "Jodhpur", "Udaipur", "Kota", "Ajmer", "Bikaner", "Bhilwara", "Alwar", "Sikar", "Pali", "Nagaur", "Tonk", "Churu", "Jhunjhunu", "Bharatpur", "Sawai Madhopur", "Chittorgarh", "Barmer", "Jaisalmer", "Hanumangarh", "Sri Ganganagar", "Bundi", "Banswara", "Dausa"],
  Sikkim: ["Gangtok", "Namchi", "Gyalshing", "Mangan", "Rangpo", "Jorethang", "Singtam"],
  "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Salem", "Tirunelveli", "Tiruppur", "Erode", "Vellore", "Thoothukudi", "Hosur", "Kanchipuram", "Cuddalore", "Dindigul", "Thanjavur", "Namakkal", "Krishnagiri", "Dharmapuri", "Kanyakumari", "Sivakasi", "Karur", "Tiruvannamalai", "Nagapattinam"],
  Telangana: ["Hyderabad", "Secunderabad", "Warangal", "Nizamabad", "Karimnagar", "Khammam", "Nalgonda", "Mahbubnagar", "Adilabad", "Medak", "Sangareddy", "Siddipet", "Suryapet", "Jagtial", "Mancherial"],
  Tripura: ["Agartala", "Udaipur", "Dharmanagar", "Kailashahar", "Belonia", "Khowai", "Sonamura"],
  "Uttar Pradesh": ["Lucknow", "Kanpur", "Ghaziabad", "Agra", "Varanasi", "Noida", "Meerut", "Prayagraj", "Bareilly", "Aligarh", "Moradabad", "Gorakhpur", "Greater Noida", "Mathura", "Ayodhya", "Jaunpur", "Azamgarh", "Etawah", "Firozabad", "Hapur", "Unnao", "Sitapur", "Mirzapur", "Jhansi", "Shahjahanpur", "Rampur", "Bijnor", "Muzaffarnagar", "Saharanpur", "Deoria", "Mau", "Ghazipur", "Ballia", "Sultanpur", "Bulandshahr"],
  Uttarakhand: ["Dehradun", "Haridwar", "Roorkee", "Haldwani", "Nainital", "Rudrapur", "Rishikesh", "Almora", "Pithoragarh", "Kashipur", "Kotdwar", "Tehri", "Pauri"],
  "West Bengal": ["Kolkata", "Howrah", "Siliguri", "Durgapur", "Asansol", "Darjeeling", "Haldia", "Kharagpur", "Bardhaman", "Malda", "Jalpaiguri", "Cooch Behar", "Bankura", "Purulia", "Hooghly", "Barasat", "Barrackpore", "Medinipur", "Krishnanagar", "Raiganj"],
  "Andaman and Nicobar Islands": ["Port Blair", "Diglipur", "Mayabunder", "Rangat", "Hut Bay", "Car Nicobar"],
  Chandigarh: ["Chandigarh"],
  "Dadra and Nagar Haveli and Daman and Diu": ["Silvassa", "Daman", "Diu", "Dadra", "Khanvel"],
  Delhi: ["New Delhi", "Delhi", "Dwarka", "Rohini", "Saket", "Karol Bagh", "Laxmi Nagar", "Pitampura", "Janakpuri", "Uttam Nagar", "Narela", "Najafgarh", "Mehrauli", "Okhla", "Shahdara", "Mayur Vihar"],
  "Jammu and Kashmir": ["Srinagar", "Jammu", "Anantnag", "Baramulla", "Kathua", "Udhampur", "Rajouri", "Poonch", "Kupwara", "Sopore", "Pulwama", "Doda"],
  Ladakh: ["Leh", "Kargil", "Nubra", "Drass"],
  Lakshadweep: ["Kavaratti", "Agatti", "Minicoy", "Andrott", "Kiltan"],
  Puducherry: ["Puducherry", "Karaikal", "Mahe", "Yanam", "Oulgaret", "Bahour"],
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
  // Fallback: scan the expanded CITIES_BY_STATE so newly added cities
  // resolve without maintaining the manual map above.
  for (const [state, cities] of Object.entries(CITIES_BY_STATE)) {
    if (cities.some((c) => normalize(c) === key)) return state;
  }
  const state = INDIAN_STATES.find((s) => normalize(s) === key);
  return state ?? null;
}

/** Canonical Indian state / UT names (alias of INDIAN_STATES — prefer that). */
export const INDIAN_STATE_NAMES = INDIAN_STATES;
