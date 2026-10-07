/**
 * City → Indian state lookup used to auto-fill the State field on debtor
 * addresses. Covers major cities plus common spelling / alias variants. The
 * field stays manually editable, so an unknown city is simply left untouched.
 */

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

/** Canonical Indian state / UT names, so typing a state is left as-is. */
const STATE_NAMES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat",
  "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh",
  "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab",
  "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand",
  "West Bengal", "Delhi", "Chandigarh", "Puducherry", "Jammu and Kashmir", "Ladakh",
  "Andaman and Nicobar Islands",
];

function normalize(v: string): string {
  return v.trim().toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Resolve an Indian state name from a city. Returns null when the city is
 * unknown (the caller leaves the user's State value untouched).
 */
export function stateForCity(city: string | null | undefined): string | null {
  const key = normalize(String(city ?? ""));
  if (!key) return null;
  const hit = CITY_TO_STATE[key];
  if (hit) return hit;
  const state = STATE_NAMES.find((s) => normalize(s) === key);
  return state ?? null;
}

export const INDIAN_STATE_NAMES = STATE_NAMES;
