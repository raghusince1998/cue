/**
 * Cities, for telling "meeting in Pune" (a journey) from "meeting at the
 * office" (a room). A plan in a city that is not home is part of a trip there.
 *
 * Indian cities in depth, the cities Indian professionals most often fly to,
 * and the old names people still say. Left out on purpose: places that are
 * also common names or words — Anand, Hassan, Sagar, Puri, Erode, Male — where
 * reading a person or a verb as a destination would be worse than missing one.
 */

const INDIA = [
  'Agartala', 'Agra', 'Ahmedabad', 'Ahmednagar', 'Aizawl', 'Ajmer', 'Akola', 'Alappuzha', 'Aligarh',
  'Allahabad', 'Alwar', 'Ambala', 'Amravati', 'Amritsar', 'Anantapur', 'Asansol', 'Aurangabad',
  'Ayodhya', 'Ballari', 'Bangalore', 'Bareilly', 'Baroda', 'Bathinda', 'Belagavi', 'Belgaum',
  'Bengaluru', 'Berhampur', 'Bhagalpur', 'Bharatpur', 'Bharuch', 'Bhavnagar', 'Bhilai', 'Bhilwara',
  'Bhimavaram', 'Bhopal', 'Bhubaneswar', 'Bidar', 'Bijapur', 'Bikaner', 'Bilaspur', 'Bokaro',
  'Bombay', 'Burhanpur', 'Calcutta', 'Calicut', 'Chandigarh', 'Chennai', 'Cochin', 'Coimbatore',
  'Cuttack', 'Darbhanga', 'Darjeeling', 'Davanagere', 'Dehradun', 'Delhi', 'Dewas', 'Dhanbad',
  'Dharamshala', 'Dharwad', 'Dibrugarh', 'Dimapur', 'Durg', 'Durgapur', 'Eluru', 'Faridabad',
  'Firozabad', 'Gandhinagar', 'Gangtok', 'Ghaziabad', 'Goa', 'Gorakhpur', 'Greater Noida', 'Gulbarga',
  'Guntur', 'Gurgaon', 'Gurugram', 'Guwahati', 'Gwalior', 'Hampi', 'Haridwar', 'Hazaribagh',
  'Hisar', 'Hosur', 'Howrah', 'Hubli', 'Hyderabad', 'Imphal', 'Indore', 'Itanagar', 'Jabalpur',
  'Jaipur', 'Jaisalmer', 'Jalandhar', 'Jalgaon', 'Jammu', 'Jamnagar', 'Jamshedpur', 'Jhansi',
  'Jodhpur', 'Jorhat', 'Junagadh', 'Kadapa', 'Kakinada', 'Kalaburagi', 'Kannur', 'Kanpur',
  'Kanyakumari', 'Karimnagar', 'Karnal', 'Karwar', 'Kathgodam', 'Khammam', 'Kharagpur', 'Kochi',
  'Kodaikanal', 'Kohima', 'Kolhapur', 'Kolkata', 'Kollam', 'Korba', 'Kota', 'Kozhikode', 'Kullu',
  'Kumbakonam', 'Kurnool', 'Kurukshetra', 'Latur', 'Leh', 'Lucknow', 'Ludhiana', 'Madras', 'Madurai',
  'Manali', 'Mangalore', 'Mangaluru', 'Manipal', 'Margao', 'Mathura', 'Meerut', 'Mohali',
  'Moradabad', 'Mount Abu', 'Mumbai', 'Munnar', 'Muzaffarnagar', 'Muzaffarpur', 'Mysore', 'Mysuru',
  'Nagercoil', 'Nagpur', 'Nanded', 'Nashik', 'Navi Mumbai', 'Nellore', 'New Delhi', 'Nizamabad',
  'Noida', 'Ongole', 'Ooty', 'Panaji', 'Panchkula', 'Panipat', 'Pathankot', 'Patiala', 'Patna',
  'Pondicherry', 'Port Blair', 'Prayagraj', 'Puducherry', 'Pune', 'Purnia', 'Pushkar', 'Raipur',
  'Rajahmundry', 'Rajkot', 'Rameswaram', 'Ranchi', 'Ratlam', 'Rishikesh', 'Rohtak', 'Rourkela',
  'Saharanpur', 'Salem', 'Sambalpur', 'Sangli', 'Satara', 'Satna', 'Secunderabad', 'Shillong',
  'Shimla', 'Shimoga', 'Shivamogga', 'Siliguri', 'Silchar', 'Silvassa', 'Sirsi', 'Solapur',
  'Sonipat', 'Srikakulam', 'Srinagar', 'Surat', 'Tezpur', 'Thane', 'Thanjavur', 'Thiruvananthapuram',
  'Thrissur', 'Tiruchirappalli', 'Tirunelveli', 'Tirupati', 'Trichy', 'Trivandrum', 'Udaipur',
  'Udupi', 'Ujjain', 'Vadodara', 'Valsad', 'Vapi', 'Varanasi', 'Vellore', 'Vijayawada',
  'Visakhapatnam', 'Vizag', 'Vrindavan', 'Warangal',
]

const WORLD = [
  'Abu Dhabi', 'Amsterdam', 'Atlanta', 'Auckland', 'Austin', 'Bangkok', 'Barcelona', 'Beijing',
  'Berlin', 'Boston', 'Brisbane', 'Brussels', 'Cairo', 'Cape Town', 'Chicago', 'Colombo',
  'Copenhagen', 'Dallas', 'Dhaka', 'Doha', 'Dubai', 'Dublin', 'Edinburgh', 'Frankfurt', 'Geneva',
  'Helsinki', 'Ho Chi Minh City', 'Hong Kong', 'Houston', 'Istanbul', 'Jakarta', 'Jeddah',
  'Johannesburg', 'Kathmandu', 'Kuala Lumpur', 'Lagos', 'Lisbon', 'London', 'Los Angeles', 'Madrid',
  'Manchester', 'Manila', 'Melbourne', 'Miami', 'Milan', 'Montreal', 'Moscow', 'Munich', 'Muscat',
  'Nairobi', 'New York', 'Osaka', 'Oslo', 'Paris', 'Perth', 'Phuket', 'Prague', 'Riyadh', 'Rome',
  'San Francisco', 'Seattle', 'Seoul', 'Shanghai', 'Sharjah', 'Shenzhen', 'Singapore', 'Stockholm',
  'Sydney', 'Taipei', 'Tokyo', 'Toronto', 'Vancouver', 'Vienna', 'Zurich',
]

export const CITIES: readonly string[] = [...INDIA, ...WORLD]

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The city a sentence is about, if any: from the list, or from `known` —
 * places this person has already planned trips to, which count whatever they
 * are called. Whole words only ("Kota" is not in "Dakota"), longest first
 * ("Navi Mumbai" before "Mumbai"). Returned as written in the list or as the
 * person wrote it before.
 */
export function findCity(text: string, known: readonly string[] = []): string | null {
  // One spelling per place: the list's when it has one ("Pune", not the
  // "pune" a trip was once typed as), otherwise as the person wrote it.
  const byKey = new Map<string, string>()
  for (const c of CITIES) byKey.set(c.toLowerCase(), c)
  for (const k of known) {
    const clean = k.trim().replace(/\s+/g, ' ')
    if (clean.length >= 3 && !byKey.has(clean.toLowerCase())) byKey.set(clean.toLowerCase(), clean)
  }
  const names = [...byKey.values()].sort((a, b) => b.length - a.length)
  for (const name of names) {
    const re = new RegExp(`(^|[^\\p{L}])${escape(name)}($|[^\\p{L}])`, 'iu')
    if (re.test(text)) return name
  }
  return null
}

/** The same place, however it was capitalised or spaced. */
export function samePlace(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
  return Boolean(a && b && norm(a) === norm(b))
}
