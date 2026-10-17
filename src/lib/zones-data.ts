/**
 * Static IANA zone catalog + major-city / alias index for Day-1 search.
 * Not exhaustive of every IANA id — covers common meeting zones and cities.
 * Unknown ids are still accepted if Intl validates them (isValidIanaZone).
 */

export interface ZoneRecord {
  id: string;
  /** Display name */
  name: string;
  /** Search aliases: city, country, common nicknames (lowercase match) */
  aliases: string[];
  region: string;
}

export const ZONE_CATALOG: ZoneRecord[] = [
  // Americas
  { id: "America/New_York", name: "Eastern Time (US)", aliases: ["new york", "nyc", "eastern", "et", "est", "edt", "boston", "washington", "miami", "toronto", "montreal"], region: "America" },
  { id: "America/Chicago", name: "Central Time (US)", aliases: ["chicago", "central", "ct", "cst", "cdt", "dallas", "houston", "minneapolis", "mexico city"], region: "America" },
  { id: "America/Denver", name: "Mountain Time (US)", aliases: ["denver", "mountain", "mt", "mst", "mdt", "salt lake", "albuquerque", "calgary", "edmonton"], region: "America" },
  { id: "America/Phoenix", name: "Arizona (no DST)", aliases: ["phoenix", "arizona", "az"], region: "America" },
  { id: "America/Los_Angeles", name: "Pacific Time (US)", aliases: ["los angeles", "la", "pacific", "pt", "pst", "pdt", "seattle", "san francisco", "sf", "vancouver", "portland"], region: "America" },
  { id: "America/Anchorage", name: "Alaska Time", aliases: ["anchorage", "alaska", "akt"], region: "America" },
  { id: "Pacific/Honolulu", name: "Hawaii Time", aliases: ["honolulu", "hawaii", "hst"], region: "Pacific" },
  { id: "America/Sao_Paulo", name: "Brasilia Time", aliases: ["sao paulo", "são paulo", "brazil", "brasilia", "rio"], region: "America" },
  { id: "America/Argentina/Buenos_Aires", name: "Argentina Time", aliases: ["buenos aires", "argentina"], region: "America" },
  { id: "America/Mexico_City", name: "Mexico City", aliases: ["mexico city", "ciudad de mexico", "cdmx"], region: "America" },
  { id: "America/Bogota", name: "Colombia Time", aliases: ["bogota", "bogotá", "colombia"], region: "America" },
  { id: "America/Lima", name: "Peru Time", aliases: ["lima", "peru"], region: "America" },
  { id: "America/Santiago", name: "Chile Time", aliases: ["santiago", "chile"], region: "America" },
  // Europe
  { id: "Europe/London", name: "UK Time", aliases: ["london", "uk", "britain", "gmt", "bst", "united kingdom"], region: "Europe" },
  { id: "Europe/Dublin", name: "Ireland Time", aliases: ["dublin", "ireland"], region: "Europe" },
  { id: "Europe/Paris", name: "Central European Time (Paris)", aliases: ["paris", "france", "cet", "cest"], region: "Europe" },
  { id: "Europe/Berlin", name: "Central European Time (Berlin)", aliases: ["berlin", "germany", "munich", "frankfurt"], region: "Europe" },
  { id: "Europe/Amsterdam", name: "Central European Time (Amsterdam)", aliases: ["amsterdam", "netherlands", "holland"], region: "Europe" },
  { id: "Europe/Brussels", name: "Central European Time (Brussels)", aliases: ["brussels", "belgium"], region: "Europe" },
  { id: "Europe/Madrid", name: "Central European Time (Madrid)", aliases: ["madrid", "spain", "barcelona"], region: "Europe" },
  { id: "Europe/Rome", name: "Central European Time (Rome)", aliases: ["rome", "italy", "milan"], region: "Europe" },
  { id: "Europe/Zurich", name: "Central European Time (Zurich)", aliases: ["zurich", "zürich", "switzerland", "geneva"], region: "Europe" },
  { id: "Europe/Stockholm", name: "Central European Time (Stockholm)", aliases: ["stockholm", "sweden"], region: "Europe" },
  { id: "Europe/Oslo", name: "Central European Time (Oslo)", aliases: ["oslo", "norway"], region: "Europe" },
  { id: "Europe/Copenhagen", name: "Central European Time (Copenhagen)", aliases: ["copenhagen", "denmark"], region: "Europe" },
  { id: "Europe/Warsaw", name: "Central European Time (Warsaw)", aliases: ["warsaw", "poland"], region: "Europe" },
  { id: "Europe/Prague", name: "Central European Time (Prague)", aliases: ["prague", "czechia", "czech"], region: "Europe" },
  { id: "Europe/Vienna", name: "Central European Time (Vienna)", aliases: ["vienna", "austria"], region: "Europe" },
  { id: "Europe/Athens", name: "Eastern European Time (Athens)", aliases: ["athens", "greece", "eet", "eest"], region: "Europe" },
  { id: "Europe/Bucharest", name: "Eastern European Time (Bucharest)", aliases: ["bucharest", "romania"], region: "Europe" },
  { id: "Europe/Helsinki", name: "Eastern European Time (Helsinki)", aliases: ["helsinki", "finland"], region: "Europe" },
  { id: "Europe/Istanbul", name: "Turkey Time", aliases: ["istanbul", "turkey", "türkiye"], region: "Europe" },
  { id: "Europe/Moscow", name: "Moscow Time", aliases: ["moscow", "russia", "msk"], region: "Europe" },
  { id: "Europe/Kyiv", name: "Kyiv Time", aliases: ["kyiv", "kiev", "ukraine"], region: "Europe" },
  { id: "Atlantic/Reykjavik", name: "Iceland Time", aliases: ["reykjavik", "iceland"], region: "Atlantic" },
  // Africa / Middle East
  { id: "Africa/Cairo", name: "Egypt Time", aliases: ["cairo", "egypt"], region: "Africa" },
  { id: "Africa/Johannesburg", name: "South Africa Time", aliases: ["johannesburg", "south africa", "cape town", "sast"], region: "Africa" },
  { id: "Africa/Lagos", name: "West Africa Time (Lagos)", aliases: ["lagos", "nigeria"], region: "Africa" },
  { id: "Africa/Nairobi", name: "East Africa Time", aliases: ["nairobi", "kenya"], region: "Africa" },
  { id: "Asia/Dubai", name: "Gulf Standard Time", aliases: ["dubai", "uae", "abu dhabi", "gst"], region: "Asia" },
  { id: "Asia/Riyadh", name: "Arabia Standard Time", aliases: ["riyadh", "saudi", "saudi arabia"], region: "Asia" },
  { id: "Asia/Jerusalem", name: "Israel Time", aliases: ["jerusalem", "tel aviv", "israel"], region: "Asia" },
  { id: "Asia/Tehran", name: "Iran Time", aliases: ["tehran", "iran"], region: "Asia" },
  // Asia / Pacific
  { id: "Asia/Kolkata", name: "India Standard Time", aliases: ["kolkata", "calcutta", "india", "mumbai", "delhi", "bangalore", "bengaluru", "ist"], region: "Asia" },
  { id: "Asia/Karachi", name: "Pakistan Time", aliases: ["karachi", "pakistan"], region: "Asia" },
  { id: "Asia/Dhaka", name: "Bangladesh Time", aliases: ["dhaka", "bangladesh"], region: "Asia" },
  { id: "Asia/Bangkok", name: "Indochina Time (Bangkok)", aliases: ["bangkok", "thailand"], region: "Asia" },
  { id: "Asia/Jakarta", name: "Western Indonesia Time", aliases: ["jakarta", "indonesia"], region: "Asia" },
  { id: "Asia/Singapore", name: "Singapore Time", aliases: ["singapore", "sgt"], region: "Asia" },
  { id: "Asia/Kuala_Lumpur", name: "Malaysia Time", aliases: ["kuala lumpur", "malaysia"], region: "Asia" },
  { id: "Asia/Hong_Kong", name: "Hong Kong Time", aliases: ["hong kong", "hk"], region: "Asia" },
  { id: "Asia/Shanghai", name: "China Standard Time", aliases: ["shanghai", "beijing", "china", "cst china"], region: "Asia" },
  { id: "Asia/Taipei", name: "Taipei Time", aliases: ["taipei", "taiwan"], region: "Asia" },
  { id: "Asia/Seoul", name: "Korea Time", aliases: ["seoul", "korea", "south korea", "kst"], region: "Asia" },
  { id: "Asia/Tokyo", name: "Japan Standard Time", aliases: ["tokyo", "japan", "jst", "osaka"], region: "Asia" },
  { id: "Asia/Manila", name: "Philippines Time", aliases: ["manila", "philippines"], region: "Asia" },
  { id: "Australia/Perth", name: "Australian Western Time", aliases: ["perth", "awt"], region: "Australia" },
  { id: "Australia/Adelaide", name: "Australian Central Time", aliases: ["adelaide", "act australia"], region: "Australia" },
  { id: "Australia/Sydney", name: "Australian Eastern Time (Sydney)", aliases: ["sydney", "melbourne", "aest", "aedt", "australia"], region: "Australia" },
  { id: "Australia/Brisbane", name: "Australian Eastern Time (Brisbane, no DST)", aliases: ["brisbane", "queensland"], region: "Australia" },
  { id: "Pacific/Auckland", name: "New Zealand Time", aliases: ["auckland", "wellington", "new zealand", "nzst", "nzdt"], region: "Pacific" },
  { id: "Pacific/Fiji", name: "Fiji Time", aliases: ["fiji", "suva"], region: "Pacific" },
  // UTC
  { id: "UTC", name: "Coordinated Universal Time", aliases: ["utc", "zulu", "gmt+0", "universal"], region: "Etc" },
  { id: "Etc/UTC", name: "Etc/UTC", aliases: ["etc/utc"], region: "Etc" },
];

const byId = new Map(ZONE_CATALOG.map((z) => [z.id, z]));

export function getCatalogZone(id: string): ZoneRecord | undefined {
  return byId.get(id);
}

export function searchZones(q: string, limit = 20): ZoneRecord[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return ZONE_CATALOG.slice(0, limit);

  const scored: { z: ZoneRecord; score: number }[] = [];
  for (const z of ZONE_CATALOG) {
    const idLower = z.id.toLowerCase();
    const nameLower = z.name.toLowerCase();
    let score = 0;
    if (idLower === needle) score = 100;
    else if (idLower.endsWith("/" + needle.replace(/\s+/g, "_"))) score = 90;
    else if (idLower.includes(needle.replace(/\s+/g, "_"))) score = 70;
    else if (nameLower.includes(needle)) score = 60;
    else if (z.aliases.some((a) => a === needle)) score = 95;
    else if (z.aliases.some((a) => a.startsWith(needle))) score = 80;
    else if (z.aliases.some((a) => a.includes(needle))) score = 50;
    if (score > 0) scored.push({ z, score });
  }
  scored.sort((a, b) => b.score - a.score || a.z.id.localeCompare(b.z.id));
  return scored.slice(0, limit).map((s) => s.z);
}
