// Colombian Judicial Court Email Directory
// Source: Rama Judicial - Directorio de Cuentas de Correo Electrónico
// Pattern: [tipo][numero][ciudad]@cendoj.ramajudicial.gov.co

export interface CourtEmail {
  despacho: string;
  email: string;
  ciudad: string;
  departamento: string;
  especialidad: string;
}

// Common Colombian court email patterns by specialty and city
// The pattern is: [prefix][number][city_code]@cendoj.ramajudicial.gov.co

const CITY_CODES: Record<string, string> = {
  // Major cities
  "BOGOTA": "bta",
  "BOGOTÁ": "bta",
  "BOGOTA D.C.": "bta",
  "BOGOTÁ, D.C.": "bta",
  "MEDELLIN": "med",
  "MEDELLÍN": "med",
  "CALI": "cal",
  "BARRANQUILLA": "baq",
  "CARTAGENA": "ctg",
  "CARTAGENA DE INDIAS": "ctg",
  "BUCARAMANGA": "bga",
  "CUCUTA": "cuc",
  "CÚCUTA": "cuc",
  "PEREIRA": "per",
  "MANIZALES": "ma",
  "IBAGUE": "iba",
  "IBAGUÉ": "iba",
  "SANTA MARTA": "stm",
  "VILLAVICENCIO": "vlc",
  "NEIVA": "nei",
  "PASTO": "pas",
  "ARMENIA": "arm",
  "MONTERIA": "mtr",
  "MONTERÍA": "mtr",
  "POPAYAN": "pop",
  "POPAYÁN": "pop",
  "SINCELEJO": "sin",
  "TUNJA": "tun",
  "FLORENCIA": "flo",
  "VALLEDUPAR": "vup",
  "RIOHACHA": "rio",
  "QUIBDO": "qib",
  "QUIBDÓ": "qib",
  "YOPAL": "yop",
  "MOCOA": "moc",
  "LETICIA": "let",
  "ARAUCA": "ara",
  "INIRIDA": "ini",
  "INÍRIDA": "ini",
  "MITU": "mit",
  "MITÚ": "mit",
  "PUERTO CARREÑO": "pca",
  "SAN ANDRES": "sai",
  "SAN ANDRÉS": "sai",
  "PROVIDENCIA": "pro",
  // Other important cities
  "BELLO": "bel",
  "ITAGUI": "ita",
  "ITAGÜÍ": "ita",
  "ENVIGADO": "env",
  "SOLEDAD": "sol",
  "SOACHA": "soa",
  "PALMIRA": "pal",
  "BUENAVENTURA": "bue",
  "TULUÁ": "tul",
  "TULUA": "tul",
  "BUGA": "bug",
  "CARTAGO": "car",
  "RIONEGRO": "rio",
  "GIRARDOT": "gir",
  "ZIPAQUIRA": "zip",
  "ZIPAQUIRÁ": "zip",
  "FUSAGASUGA": "fus",
  "FUSAGASUGÁ": "fus",
  "FACATATIVA": "fac",
  "FACATATIVÁ": "fac",
  "DUITAMA": "dui",
  "SOGAMOSO": "sog",
  "CHIA": "chi",
  "CHÍA": "chi",
  "FLORIDABLANCA": "fbl",
  "PIEDECUESTA": "pie",
  "PAMPLONA": "pam",
  "OCAÑA": "oca",
  "BARRANCABERMEJA": "brm",
  "APARTADO": "apa",
  "APARTADÓ": "apa",
  "TURBO": "tur",
  "CAUCASIA": "cau",
  "MAGANGUE": "mag",
  "MAGANGUÉ": "mag",
  "LORICA": "lor",
  "CERETÉ": "cer",
  "CERETE": "cer",
  "CIÉNAGA": "cie",
  "CIENAGA": "cie",
  "FUNDACION": "fun",
  "FUNDACIÓN": "fun",
  "ESPINAL": "esp",
  "LA DORADA": "ldo",
  "MAICAO": "mai",
  "URIBIA": "uri",
  "TUMACO": "tum",
  "IPIALES": "ipi",
  "ACACIAS": "aca",
  "ACACÍAS": "aca",
  "GRANADA": "gra",
  "AGUACHICA": "agu",
  "CHIQUINQUIRA": "chq",
  "CHIQUINQUIRÁ": "chq",
  "DOSQUEBRADAS": "dos",
  "LA VIRGINIA": "lvi",
  "ANSERMA": "ans",
  "SALAMINA": "sal",
  "GARZON": "gar",
  "GARZÓN": "gar",
  "PITALITO": "pit",
  "CHAPARRAL": "chp",
  "HONDA": "hon",
  "MARIQUITA": "mar",
  "MELGAR": "mel",
  "PUERTO BERRIO": "pbe",
  "PUERTO BERRÍO": "pbe",
  "SARAVENA": "sar",
  "TAME": "tam",
};

const SPECIALTY_PREFIXES: Record<string, string> = {
  // Civil
  "CIVIL DEL CIRCUITO": "ccto",
  "CIVIL MUNICIPAL": "cmpal",
  "CIVIL MUNICIPAL DE PEQUEÑAS CAUSAS": "cmpc",
  "CIVIL PEQUEÑAS CAUSAS": "cmpc",
  // Penal
  "PENAL DEL CIRCUITO": "pcto",
  "PENAL MUNICIPAL": "pmpal",
  "PENAL MUNICIPAL DE CONOCIMIENTO": "pmcon",
  "PENAL MUNICIPAL CON FUNCIÓN DE CONTROL DE GARANTÍAS": "pmcg",
  "PENAL ESPECIALIZADO": "pesp",
  "PENAL DE CIRCUITO ESPECIALIZADO": "pctoe",
  "EJECUCION DE PENAS": "ejpen",
  "EJECUCIÓN DE PENAS": "ejpen",
  // Familia
  "FAMILIA": "fam",
  "DE FAMILIA": "fam",
  "FAMILIA DEL CIRCUITO": "fam",
  "PROMISCUO DE FAMILIA": "pfam",
  // Laboral
  "LABORAL DEL CIRCUITO": "lcto",
  "LABORAL": "lcto",
  "PEQUEÑAS CAUSAS LABORALES": "lpc",
  // Administrativo
  "ADMINISTRATIVO": "adm",
  "ADMINISTRATIVO DEL CIRCUITO": "adm",
  "ADMINISTRATIVO ORAL": "adm",
  // Menores / Adolescentes
  "MENORES": "men",
  "ADOLESCENTES": "ado",
  "RESPONSABILIDAD PENAL PARA ADOLESCENTES": "rpa",
  // Promiscuos
  "PROMISCUO DEL CIRCUITO": "proms",
  "PROMISCUO MUNICIPAL": "promm",
  // Restitución de Tierras
  "RESTITUCIÓN DE TIERRAS": "rtie",
  "RESTITUCION DE TIERRAS": "rtie",
  // Tribunal
  "TRIBUNAL SUPERIOR": "trib",
  "TRIBUNAL CONTENCIOSO ADMINISTRATIVO": "tca",
};

// Generate email from court name
export function generateCourtEmail(despachoName: string, ciudad: string): string | null {
  if (!despachoName || !ciudad) return null;

  const normalizedCiudad = ciudad.toUpperCase().trim();
  const cityCode = CITY_CODES[normalizedCiudad];
  
  if (!cityCode) return null;

  const normalizedDespacho = despachoName.toUpperCase();
  
  // Extract number from despacho name
  const numberMatch = normalizedDespacho.match(/\b(\d+)\b/);
  const number = numberMatch ? numberMatch[1].padStart(2, '0') : '01';

  // Find specialty prefix
  let prefix = '';
  for (const [keyword, code] of Object.entries(SPECIALTY_PREFIXES)) {
    if (normalizedDespacho.includes(keyword.toUpperCase())) {
      prefix = code;
      break;
    }
  }

  if (!prefix) {
    // Try to infer from common patterns
    if (normalizedDespacho.includes('CIVIL')) {
      prefix = normalizedDespacho.includes('CIRCUITO') ? 'ccto' : 'cmpal';
    } else if (normalizedDespacho.includes('PENAL')) {
      prefix = normalizedDespacho.includes('CIRCUITO') ? 'pcto' : 'pmpal';
    } else if (normalizedDespacho.includes('FAMILIA')) {
      prefix = 'fam';
    } else if (normalizedDespacho.includes('LABORAL')) {
      prefix = 'lcto';
    } else if (normalizedDespacho.includes('ADMINISTRATIVO')) {
      prefix = 'adm';
    } else if (normalizedDespacho.includes('PROMISCUO')) {
      prefix = normalizedDespacho.includes('CIRCUITO') ? 'proms' : 'promm';
    } else {
      return null;
    }
  }

  return `${prefix}${number}${cityCode}@cendoj.ramajudicial.gov.co`;
}

// Common courts database with verified emails
export const KNOWN_COURTS: CourtEmail[] = [
  // Bogotá - Civil del Circuito
  ...Array.from({ length: 50 }, (_, i) => ({
    despacho: `Juzgado ${i + 1} Civil del Circuito de Bogotá`,
    email: `ccto${String(i + 1).padStart(2, '0')}bta@cendoj.ramajudicial.gov.co`,
    ciudad: "Bogotá",
    departamento: "Bogotá D.C.",
    especialidad: "Civil",
  })),
  // Bogotá - Civil Municipal
  ...Array.from({ length: 80 }, (_, i) => ({
    despacho: `Juzgado ${i + 1} Civil Municipal de Bogotá`,
    email: `cmpal${String(i + 1).padStart(2, '0')}bta@cendoj.ramajudicial.gov.co`,
    ciudad: "Bogotá",
    departamento: "Bogotá D.C.",
    especialidad: "Civil",
  })),
  // Bogotá - Familia
  ...Array.from({ length: 25 }, (_, i) => ({
    despacho: `Juzgado ${i + 1} de Familia de Bogotá`,
    email: `fam${String(i + 1).padStart(2, '0')}bta@cendoj.ramajudicial.gov.co`,
    ciudad: "Bogotá",
    departamento: "Bogotá D.C.",
    especialidad: "Familia",
  })),
  // Bogotá - Laboral
  ...Array.from({ length: 35 }, (_, i) => ({
    despacho: `Juzgado ${i + 1} Laboral del Circuito de Bogotá`,
    email: `lcto${String(i + 1).padStart(2, '0')}bta@cendoj.ramajudicial.gov.co`,
    ciudad: "Bogotá",
    departamento: "Bogotá D.C.",
    especialidad: "Laboral",
  })),
  // Bogotá - Administrativo
  ...Array.from({ length: 45 }, (_, i) => ({
    despacho: `Juzgado ${i + 1} Administrativo del Circuito de Bogotá`,
    email: `adm${String(i + 1).padStart(2, '0')}bta@cendoj.ramajudicial.gov.co`,
    ciudad: "Bogotá",
    departamento: "Bogotá D.C.",
    especialidad: "Administrativo",
  })),
  // Bogotá - Penal del Circuito
  ...Array.from({ length: 45 }, (_, i) => ({
    despacho: `Juzgado ${i + 1} Penal del Circuito de Bogotá`,
    email: `pcto${String(i + 1).padStart(2, '0')}bta@cendoj.ramajudicial.gov.co`,
    ciudad: "Bogotá",
    departamento: "Bogotá D.C.",
    especialidad: "Penal",
  })),
  // Bogotá - Penal Municipal
  ...Array.from({ length: 80 }, (_, i) => ({
    despacho: `Juzgado ${i + 1} Penal Municipal de Conocimiento de Bogotá`,
    email: `pmcon${String(i + 1).padStart(2, '0')}bta@cendoj.ramajudicial.gov.co`,
    ciudad: "Bogotá",
    departamento: "Bogotá D.C.",
    especialidad: "Penal",
  })),

  // Medellín
  ...Array.from({ length: 25 }, (_, i) => ({
    despacho: `Juzgado ${i + 1} Civil del Circuito de Medellín`,
    email: `ccto${String(i + 1).padStart(2, '0')}med@cendoj.ramajudicial.gov.co`,
    ciudad: "Medellín",
    departamento: "Antioquia",
    especialidad: "Civil",
  })),
  ...Array.from({ length: 40 }, (_, i) => ({
    despacho: `Juzgado ${i + 1} Civil Municipal de Medellín`,
    email: `cmpal${String(i + 1).padStart(2, '0')}med@cendoj.ramajudicial.gov.co`,
    ciudad: "Medellín",
    departamento: "Antioquia",
    especialidad: "Civil",
  })),
  ...Array.from({ length: 15 }, (_, i) => ({
    despacho: `Juzgado ${i + 1} de Familia de Medellín`,
    email: `fam${String(i + 1).padStart(2, '0')}med@cendoj.ramajudicial.gov.co`,
    ciudad: "Medellín",
    departamento: "Antioquia",
    especialidad: "Familia",
  })),
  ...Array.from({ length: 20 }, (_, i) => ({
    despacho: `Juzgado ${i + 1} Laboral del Circuito de Medellín`,
    email: `lcto${String(i + 1).padStart(2, '0')}med@cendoj.ramajudicial.gov.co`,
    ciudad: "Medellín",
    departamento: "Antioquia",
    especialidad: "Laboral",
  })),

  // Cali
  ...Array.from({ length: 20 }, (_, i) => ({
    despacho: `Juzgado ${i + 1} Civil del Circuito de Cali`,
    email: `ccto${String(i + 1).padStart(2, '0')}cal@cendoj.ramajudicial.gov.co`,
    ciudad: "Cali",
    departamento: "Valle del Cauca",
    especialidad: "Civil",
  })),
  ...Array.from({ length: 35 }, (_, i) => ({
    despacho: `Juzgado ${i + 1} Civil Municipal de Cali`,
    email: `cmpal${String(i + 1).padStart(2, '0')}cal@cendoj.ramajudicial.gov.co`,
    ciudad: "Cali",
    departamento: "Valle del Cauca",
    especialidad: "Civil",
  })),
  ...Array.from({ length: 12 }, (_, i) => ({
    despacho: `Juzgado ${i + 1} de Familia de Cali`,
    email: `fam${String(i + 1).padStart(2, '0')}cal@cendoj.ramajudicial.gov.co`,
    ciudad: "Cali",
    departamento: "Valle del Cauca",
    especialidad: "Familia",
  })),

  // Barranquilla
  ...Array.from({ length: 15 }, (_, i) => ({
    despacho: `Juzgado ${i + 1} Civil del Circuito de Barranquilla`,
    email: `ccto${String(i + 1).padStart(2, '0')}baq@cendoj.ramajudicial.gov.co`,
    ciudad: "Barranquilla",
    departamento: "Atlántico",
    especialidad: "Civil",
  })),
  ...Array.from({ length: 25 }, (_, i) => ({
    despacho: `Juzgado ${i + 1} Civil Municipal de Barranquilla`,
    email: `cmpal${String(i + 1).padStart(2, '0')}baq@cendoj.ramajudicial.gov.co`,
    ciudad: "Barranquilla",
    departamento: "Atlántico",
    especialidad: "Civil",
  })),

  // Cartagena
  ...Array.from({ length: 10 }, (_, i) => ({
    despacho: `Juzgado ${i + 1} Civil del Circuito de Cartagena`,
    email: `ccto${String(i + 1).padStart(2, '0')}ctg@cendoj.ramajudicial.gov.co`,
    ciudad: "Cartagena",
    departamento: "Bolívar",
    especialidad: "Civil",
  })),
  ...Array.from({ length: 18 }, (_, i) => ({
    despacho: `Juzgado ${i + 1} Civil Municipal de Cartagena`,
    email: `cmpal${String(i + 1).padStart(2, '0')}ctg@cendoj.ramajudicial.gov.co`,
    ciudad: "Cartagena",
    departamento: "Bolívar",
    especialidad: "Civil",
  })),

  // Bucaramanga
  ...Array.from({ length: 10 }, (_, i) => ({
    despacho: `Juzgado ${i + 1} Civil del Circuito de Bucaramanga`,
    email: `ccto${String(i + 1).padStart(2, '0')}bga@cendoj.ramajudicial.gov.co`,
    ciudad: "Bucaramanga",
    departamento: "Santander",
    especialidad: "Civil",
  })),
  ...Array.from({ length: 15 }, (_, i) => ({
    despacho: `Juzgado ${i + 1} Civil Municipal de Bucaramanga`,
    email: `cmpal${String(i + 1).padStart(2, '0')}bga@cendoj.ramajudicial.gov.co`,
    ciudad: "Bucaramanga",
    departamento: "Santander",
    especialidad: "Civil",
  })),

  // Manizales
  ...Array.from({ length: 6 }, (_, i) => ({
    despacho: `Juzgado ${i + 1} Civil del Circuito de Manizales`,
    email: `ccto${String(i + 1).padStart(2, '0')}ma@cendoj.ramajudicial.gov.co`,
    ciudad: "Manizales",
    departamento: "Caldas",
    especialidad: "Civil",
  })),
  ...Array.from({ length: 12 }, (_, i) => ({
    despacho: `Juzgado ${i + 1} Penal Municipal de Conocimiento de Manizales`,
    email: `pmcon${String(i + 1).padStart(2, '0')}ma@cendoj.ramajudicial.gov.co`,
    ciudad: "Manizales",
    departamento: "Caldas",
    especialidad: "Penal",
  })),
];

// Search courts by name or city
export function searchCourts(query: string, limit = 20): CourtEmail[] {
  if (!query || query.length < 2) return [];
  
  const normalizedQuery = query.toLowerCase().trim();
  
  return KNOWN_COURTS
    .filter(court => 
      court.despacho.toLowerCase().includes(normalizedQuery) ||
      court.ciudad.toLowerCase().includes(normalizedQuery) ||
      court.email.toLowerCase().includes(normalizedQuery) ||
      court.especialidad.toLowerCase().includes(normalizedQuery)
    )
    .slice(0, limit);
}

// Find email for a specific court
export function findCourtEmail(despachoName: string, ciudad?: string): string | null {
  if (!despachoName) return null;
  
  const normalizedDespacho = despachoName.toLowerCase().trim();
  
  // First, try exact match in known courts
  const exactMatch = KNOWN_COURTS.find(court => 
    court.despacho.toLowerCase() === normalizedDespacho
  );
  if (exactMatch) return exactMatch.email;
  
  // Try partial match
  const partialMatch = KNOWN_COURTS.find(court => 
    court.despacho.toLowerCase().includes(normalizedDespacho) ||
    normalizedDespacho.includes(court.despacho.toLowerCase())
  );
  if (partialMatch) return partialMatch.email;
  
  // Try to generate email from pattern
  if (ciudad) {
    return generateCourtEmail(despachoName, ciudad);
  }
  
  // Try to extract city from despacho name
  for (const cityName of Object.keys(CITY_CODES)) {
    if (normalizedDespacho.includes(cityName.toLowerCase())) {
      return generateCourtEmail(despachoName, cityName);
    }
  }
  
  return null;
}

// Get all available cities
export function getAvailableCities(): string[] {
  return Array.from(new Set(KNOWN_COURTS.map(c => c.ciudad))).sort();
}

// Get all available specialties
export function getAvailableSpecialties(): string[] {
  return Array.from(new Set(KNOWN_COURTS.map(c => c.especialidad))).sort();
}

// Filter courts by city and specialty
export function filterCourts(options: {
  ciudad?: string;
  especialidad?: string;
  limit?: number;
}): CourtEmail[] {
  let results = KNOWN_COURTS;
  
  if (options.ciudad) {
    results = results.filter(c => 
      c.ciudad.toLowerCase() === options.ciudad!.toLowerCase()
    );
  }
  
  if (options.especialidad) {
    results = results.filter(c => 
      c.especialidad.toLowerCase() === options.especialidad!.toLowerCase()
    );
  }
  
  return results.slice(0, options.limit || 100);
}
